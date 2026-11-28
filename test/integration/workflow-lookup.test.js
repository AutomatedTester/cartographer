/**
 * get_workflow_by_name against a real crawl session.
 *
 * mcp-handlers.test.js covers this tool's error paths, but nothing there can
 * populate a session, so a successful lookup was never exercised. This crawls
 * the in-repo BenchmarkShop fixture through the MCP tool surface, the way an
 * agent would, then checks that every workflow the crawl reports can be
 * fetched back, by ID and by name. The fixture does not reliably produce two
 * workflows with the same name, so that case is pinned down in
 * test/unit/workflow-lookup.test.js; the name check here still covers it if a
 * crawl does produce one.
 *
 * Needs Chrome; skipped otherwise (REQUIRE_BROWSER=1 makes that a failure).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { browserGate } from "../helpers/browser-availability.js";
import { startBenchmarkApp } from "../helpers/benchmark-app.js";
import { startInProcessServer, textOf } from "../helpers/mcp-harness.js";

const gate = await browserGate();

describe("get_workflow_by_name on a real crawl", { skip: gate.skip }, () => {
  let app;
  let server;
  let sessionId;
  let workflows = [];

  before(async () => {
    app = await startBenchmarkApp();
    server = await startInProcessServer();

    const crawl = await server.client.callTool(
      {
        name: "crawl_multi_page",
        arguments: {
          startUrl: `${app.baseUrl}/`,
          maxPages: 8,
          maxDepth: 2,
          pageLoadTimeout: 20000,
          // Short budget: fall back to heuristics instead of downloading a model.
          modelLoadTimeoutMs: 2000,
          analysisTimeoutMs: 30000,
          detectWorkflows: true,
          enableAutoLogin: false,
          format: "json",
        },
      },
      undefined,
      { timeout: 600000 }
    );

    assert.notEqual(crawl.isError, true, `crawl failed: ${textOf(crawl)}`);
    const result = JSON.parse(textOf(crawl));
    sessionId = result.session.sessionId;
    workflows = result.detectedWorkflows;
  });

  after(async () => {
    await server?.close();
    await app?.stop();
  });

  /** Call the tool; returns the result plus the workflow parsed from its first part. */
  async function lookup(workflowName) {
    const result = await server.client.callTool({
      name: "get_workflow_by_name",
      arguments: { sessionId, workflowName },
    });
    const first = result.content[0]?.text ?? "";
    let workflow = null;
    if (!result.isError) workflow = JSON.parse(first);
    return { result, workflow };
  }

  it("detects at least one workflow to look up", () => {
    assert.ok(workflows.length > 0, "the crawl reported no workflows, so nothing below is tested");
  });

  it("returns each workflow by its ID", async () => {
    for (const expected of workflows) {
      const { result, workflow } = await lookup(expected.id);
      assert.notEqual(result.isError, true, `lookup by id ${expected.id}: ${textOf(result)}`);
      assert.deepEqual(workflow, expected);
      assert.equal(result.content.length, 1, "an ID is unique, so no ambiguity note");
    }
  });

  it("returns the highest-confidence workflow for a name, and lists the others", async () => {
    const names = [...new Set(workflows.map((w) => w.name))];
    for (const name of names) {
      const sameName = workflows
        .filter((w) => w.name === name)
        .sort((a, b) => b.confidence - a.confidence);

      const { result, workflow } = await lookup(name);
      assert.notEqual(result.isError, true, `lookup by name ${name}: ${textOf(result)}`);
      assert.equal(workflow.name, name);
      assert.equal(workflow.confidence, sameName[0].confidence);

      if (sameName.length === 1) {
        assert.equal(result.content.length, 1);
      } else {
        const note = result.content[1]?.text ?? "";
        for (const other of sameName.filter((w) => w.id !== workflow.id)) {
          assert.ok(note.includes(other.id), `note does not mention ${other.id}: ${note}`);
        }
      }
    }
  });

  it("reports an unknown workflow with the names and IDs it does have", async () => {
    const { result } = await lookup("no_such_workflow");
    assert.equal(result.isError, true);
    for (const w of workflows) {
      assert.match(textOf(result), new RegExp(w.id));
    }
  });
});
