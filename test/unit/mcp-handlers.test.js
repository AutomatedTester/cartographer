/**
 * The MCP request handlers in src/index.ts, driven in-process.
 *
 * mcp-server.test.js spawns the real binary and proves the stdio entry point
 * boots and speaks the protocol. It cannot, however, see inside: a child
 * process contributes nothing to coverage, so index.ts's ~840 lines of
 * argument coercion, session lookup, formatting and error shaping showed as
 * entirely untested while being run on every integration pass.
 *
 * These drive the same server object over an in-memory transport. Nothing here
 * needs a browser or a network: every case is either rejected before a crawl
 * starts, or reads session state that no crawl has populated. That is why this
 * lives in unit/ despite testing the server surface — and it is also what puts
 * index.js inside the coverage floor, so the handler coverage below cannot
 * quietly regress.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { startInProcessServer, textOf } from "../helpers/mcp-harness.js";

let server;
let client;

before(async () => {
  server = await startInProcessServer();
  client = server.client;
});

after(async () => {
  await server?.close();
});

/** Call a tool and return its text payload. */
async function call(name, args) {
  return client.callTool({ name, arguments: args });
}

describe("MCP handlers: tool advertisement", () => {
  it("describes every tool with a non-empty schema", async () => {
    const { tools } = await client.listTools();

    assert.ok(tools.length > 0);
    for (const tool of tools) {
      assert.ok(tool.description?.length > 0, `${tool.name} has no description`);
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(
        Object.keys(tool.inputSchema.properties).length > 0,
        `${tool.name} declares no properties`
      );
    }
  });

  it("documents the optional crawl tuning parameters", async () => {
    const { tools } = await client.listTools();
    const multi = tools.find((t) => t.name === "crawl_multi_page");

    for (const option of [
      "maxPages",
      "maxDepth",
      "pageLoadTimeout",
      "detectWorkflows",
      "workflowStrategy",
      "credentials",
    ]) {
      assert.ok(
        option in multi.inputSchema.properties,
        `crawl_multi_page should accept ${option}`
      );
    }
  });

  // The crawler and MultiPageCrawler both take an intentThreshold — it is the
  // knob that decides how much of a page gets reported — but no tool schema
  // exposes it, so an MCP client is stuck with the default. Pinned so that
  // adding it is a deliberate change rather than an accident.
  it("exposes no intent threshold on any tool", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      assert.ok(
        !("intentThreshold" in tool.inputSchema.properties),
        `${tool.name} now exposes intentThreshold; update this test`
      );
    }
  });

  it("offers the documented output formats on the single-page crawl", async () => {
    const { tools } = await client.listTools();
    const format = tools.find((t) => t.name === "crawl_and_analyze").inputSchema
      .properties.format;

    assert.deepEqual(format.enum, ["json", "markdown", "markdown-summary"]);
    assert.equal(format.default, "markdown");
  });

  it("requires a username and password together when credentials are given", async () => {
    const { tools } = await client.listTools();
    const credentials = tools.find((t) => t.name === "crawl_multi_page").inputSchema
      .properties.credentials;

    assert.deepEqual(credentials.required, ["username", "password"]);
  });
});

describe("MCP handlers: ARIA advisory is opt-in", () => {
  it("offers audit_aria as its own tool, described as advice", async () => {
    const { tools } = await client.listTools();
    const audit = tools.find((t) => t.name === "audit_aria");

    assert.ok(audit, "audit_aria should be advertised");
    assert.deepEqual(audit.inputSchema.required, ["url"]);
    assert.deepEqual(audit.inputSchema.properties.format.enum, ["json", "markdown"]);
    assert.match(audit.description, /No ARIA is better than bad ARIA/);
    assert.match(audit.description, /what would be lost/);
    assert.match(audit.description, /never reports a failure/);
  });

  it("leaves the ARIA advisory off crawl_and_analyze unless asked for", async () => {
    const { tools } = await client.listTools();
    const flag = tools.find((t) => t.name === "crawl_and_analyze").inputSchema
      .properties.ariaAudit;

    assert.equal(flag.type, "boolean");
    assert.equal(flag.default, false);
  });

  it("validates audit_aria arguments before starting a browser", async () => {
    await assert.rejects(() => call("audit_aria", {}));
    await assert.rejects(() => call("audit_aria", { url: "not a url" }));
    await assert.rejects(() => call("audit_aria", { url: "https://x.test/", format: "pdf" }));
    await assert.rejects(() => call("crawl_and_analyze", { url: "https://x.test/", ariaAudit: "yes" }));
  });
});

describe("MCP handlers: argument validation", () => {
  it("rejects an unknown tool as an error result, not a crash", async () => {
    const result = await call("definitely_not_a_tool", {});

    assert.equal(result.isError, true);
    assert.match(textOf(result), /Unknown tool/);
  });

  it("rejects a missing required argument", async () => {
    await assert.rejects(() => call("crawl_and_analyze", {}));
  });

  it("rejects an argument of the wrong type", async () => {
    await assert.rejects(() => call("crawl_and_analyze", { url: 42 }));
    await assert.rejects(() => call("crawl_multi_page", { startUrl: ["a"] }));
  });

  it("rejects an out-of-enum format", async () => {
    await assert.rejects(() =>
      call("export_workflow_visualization", { sessionId: "x", format: "pdf" })
    );
  });

  it("accepts every documented format value", async () => {
    const { tools } = await client.listTools();
    const formats =
      tools.find((t) => t.name === "export_workflow_visualization").inputSchema
        .properties.format.enum ?? [];

    assert.ok(formats.length > 0, "format should be an enum");

    for (const format of formats) {
      const result = await call("export_workflow_visualization", {
        sessionId: "no-such-session",
        format,
      });
      // The session does not exist, so this must be a clean miss rather than
      // a schema rejection — which is what proves the value was accepted.
      assert.ok(result.content.length > 0, `format ${format} was rejected`);
    }
  });
});

describe("MCP handlers: state-dependent tools before any crawl", () => {
  it("get_element_locator explains that a crawl is needed", async () => {
    const result = await call("get_element_locator", {
      description: "the submit button",
    });

    assert.equal(result.isError, true);
    assert.match(textOf(result), /crawl_and_analyze/);
  });

  it("get_workflow_by_name reports an unknown session", async () => {
    const result = await call("get_workflow_by_name", {
      sessionId: "no-such-session",
      workflowName: "checkout",
    });

    assert.ok(result.content.length > 0);
    assert.match(textOf(result), /session|not found|No /i);
  });

  it("get_workflow_by_name requires both arguments", async () => {
    await assert.rejects(() => call("get_workflow_by_name", { sessionId: "x" }));
    await assert.rejects(() => call("get_workflow_by_name", { workflowName: "x" }));
  });

  it("export_workflow_visualization reports an unknown session", async () => {
    const result = await call("export_workflow_visualization", {
      sessionId: "no-such-session",
    });

    assert.ok(result.content.length > 0);
    assert.match(textOf(result), /session|not found|No /i);
  });

  it("names the session it could not find, so the caller can tell which", async () => {
    const result = await call("export_workflow_visualization", {
      sessionId: "session-abc-123",
    });

    assert.match(textOf(result), /session-abc-123/);
  });
});

describe("MCP handlers: resilience", () => {
  it("stays responsive after a rejected call", async () => {
    await call("crawl_and_analyze", {}).catch(() => {});

    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, "server still answers after a bad request");
  });

  it("stays responsive after an unknown-tool call", async () => {
    await call("nope", {});

    const result = await call("get_element_locator", { description: "x" });
    assert.equal(result.isError, true);
  });

  it("handles concurrent requests without interleaving responses", async () => {
    const results = await Promise.all([
      call("get_element_locator", { description: "alpha" }),
      call("get_workflow_by_name", { sessionId: "s1", workflowName: "beta" }),
      call("export_workflow_visualization", { sessionId: "s2" }),
      client.listTools(),
    ]);

    assert.equal(results.length, 4);
    assert.match(textOf(results[0]), /crawl_and_analyze/);
    assert.ok(results[3].tools.length > 0);
  });

  it("returns text content parts for every tool result", async () => {
    const result = await call("get_workflow_by_name", {
      sessionId: "s",
      workflowName: "w",
    });

    for (const part of result.content) {
      assert.equal(part.type, "text");
      assert.equal(typeof part.text, "string");
    }
  });
});
