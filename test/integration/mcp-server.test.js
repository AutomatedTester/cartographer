/**
 * Protocol-level tests for the MCP server in src/index.ts.
 *
 * These cover handshake, tool advertisement, argument validation and the
 * handlers that do not require a browser. Anything needing Chrome lives in
 * benchmark-crawl.test.js.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { startServer, textOf } from "../helpers/mcp-harness.js";

const EXPECTED_TOOLS = [
  "audit_aria",
  "crawl_and_analyze",
  "crawl_multi_page",
  "export_workflow_visualization",
  "get_element_locator",
  "get_workflow_by_name",
  "run_critical_tests",
];

describe("MCP server protocol", () => {
  let server;
  let client;

  before(async () => {
    server = await startServer();
    client = server.client;
  });

  after(async () => {
    await server?.close();
  });

  it("completes the initialize handshake and reports server info", () => {
    const info = client.getServerVersion();
    assert.equal(info.name, "Cartographer");
    assert.ok(info.version, "server should report a version");
  });

  it("declares the tools capability", () => {
    const caps = client.getServerCapabilities();
    assert.ok(caps.tools, "server must advertise tools capability");
  });

  it("advertises exactly the documented tool set", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
  });

  it("gives every tool a description and an object input schema", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.ok(tool.description?.length > 0, `${tool.name} has no description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type`);
      assert.ok(tool.inputSchema.properties, `${tool.name} has no properties`);
    }
  });

  it("marks url as required on the crawling tools", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    assert.deepEqual(byName.crawl_and_analyze.inputSchema.required, ["url"]);
    assert.ok(byName.run_critical_tests.inputSchema.required.includes("url"));
    // crawl_multi_page takes startUrl or its alias url; the handler requires
    // one of them, so the schema lists both and requires neither.
    assert.ok("startUrl" in byName.crawl_multi_page.inputSchema.properties);
    assert.ok("url" in byName.crawl_multi_page.inputSchema.properties);
  });

  it("reports an unknown tool name as a tool error, not a protocol crash", async () => {
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /Unknown tool: no_such_tool/);
  });

  it("reports a call that omits a required argument as a tool error", async () => {
    const result = await client.callTool({ name: "crawl_and_analyze", arguments: {} });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /^Invalid arguments: url: /);
  });

  it("reports an argument of the wrong type as a tool error", async () => {
    const result = await client.callTool({ name: "crawl_and_analyze", arguments: { url: 42 } });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /^Invalid arguments: url: /);
  });
});

describe("MCP tools that need no browser", () => {
  let server;
  let client;

  before(async () => {
    server = await startServer();
    client = server.client;
  });

  after(async () => {
    await server?.close();
  });

  it("get_element_locator reports missing crawl data as an error result", async () => {
    const result = await client.callTool({
      name: "get_element_locator",
      arguments: { description: "the submit button" },
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /crawl_and_analyze/);
  });

  it("get_workflow_by_name reports an unknown session rather than throwing", async () => {
    const result = await client.callTool({
      name: "get_workflow_by_name",
      arguments: { sessionId: "does-not-exist", workflowName: "checkout" },
    });

    assert.ok(result.content.length > 0, "should return a message, not an empty body");
    assert.match(textOf(result), /session|crawl|not found|No /i);
  });

  it("get_workflow_by_name requires both sessionId and workflowName", async () => {
    const result = await client.callTool({
      name: "get_workflow_by_name",
      arguments: { sessionId: "does-not-exist" },
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /workflowName/);
  });

  it("export_workflow_visualization reports an unknown session rather than throwing", async () => {
    const result = await client.callTool({
      name: "export_workflow_visualization",
      arguments: { sessionId: "does-not-exist" },
    });

    assert.ok(result.content.length > 0);
    assert.match(textOf(result), /session|crawl|not found|No /i);
  });

  it("export_workflow_visualization rejects a format outside the documented enum", async () => {
    const result = await client.callTool({
      name: "export_workflow_visualization",
      arguments: { sessionId: "does-not-exist", format: "not-a-format" },
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /format/);
  });

  it("stays responsive after a failed call", async () => {
    await client.callTool({ name: "crawl_and_analyze", arguments: {} });

    const { tools } = await client.listTools();
    assert.equal(tools.length, EXPECTED_TOOLS.length);
  });
});
