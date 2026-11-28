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

// Keyword matching only: no embedding model download in a unit test. The
// server reads this when build/index.js is first imported, in before() below.
process.env.CARTOGRAPHER_SEMANTIC_LOCATOR = "off";

let server;
let client;
let testing;

before(async () => {
  server = await startInProcessServer();
  client = server.client;
  ({ __testing: testing } = await import("../../build/index.js"));
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
    for (const args of [{}, { url: "not a url" }, { url: "https://x.test/", format: "pdf" }]) {
      const result = await call("audit_aria", args);
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.match(textOf(result), /^Invalid arguments: /);
    }
    const result = await call("crawl_and_analyze", { url: "https://x.test/", ariaAudit: "yes" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /ariaAudit/);
  });
});

describe("MCP handlers: argument validation", () => {
  it("rejects an unknown tool as an error result, not a crash", async () => {
    const result = await call("definitely_not_a_tool", {});

    assert.equal(result.isError, true);
    assert.match(textOf(result), /Unknown tool/);
  });

  it("rejects a missing required argument as an error result", async () => {
    const result = await call("crawl_and_analyze", {});
    assert.equal(result.isError, true);
    assert.match(textOf(result), /^Invalid arguments: url: /);
  });

  it("rejects an argument of the wrong type as an error result", async () => {
    for (const [tool, args] of [
      ["crawl_and_analyze", { url: 42 }],
      ["crawl_multi_page", { startUrl: ["a"] }],
      ["run_critical_tests", { url: "https://x.test/", retryCount: "two" }],
      ["get_element_locator", { description: "" }],
    ]) {
      const result = await call(tool, args);
      assert.equal(result.isError, true, `${tool} ${JSON.stringify(args)}`);
      assert.match(textOf(result), /^Invalid arguments: /);
    }
  });

  it("gives a one-line, readable validation message rather than raw Zod JSON", async () => {
    const result = await call("audit_aria", { url: "not a url" });

    assert.equal(textOf(result), "Invalid arguments: url: A valid URL is required.");
  });

  it("rejects an out-of-enum format as an error result", async () => {
    const result = await call("export_workflow_visualization", { sessionId: "x", format: "pdf" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /format/);
  });

  it("requires startUrl or url on crawl_multi_page", async () => {
    const result = await call("crawl_multi_page", {});
    assert.equal(result.isError, true);
    assert.match(textOf(result), /startUrl or url/);
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
    for (const args of [{ sessionId: "x" }, { workflowName: "x" }]) {
      const result = await call("get_workflow_by_name", args);
      assert.equal(result.isError, true);
      assert.match(textOf(result), /^Invalid arguments: /);
    }
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

describe("MCP handlers: schemas agents can rely on", () => {
  async function schemaOf(name) {
    const { tools } = await client.listTools();
    return tools.find((t) => t.name === name);
  }

  it("defaults every format to markdown", async () => {
    for (const name of ["crawl_and_analyze", "audit_aria", "run_critical_tests", "crawl_multi_page"]) {
      const tool = await schemaOf(name);
      assert.equal(tool.inputSchema.properties.format.default, "markdown", name);
      assert.ok(tool.inputSchema.properties.format.enum.includes("json"), `${name} keeps json`);
    }
  });

  it("declares integer parameters as integers with the enforced bounds", async () => {
    const multi = (await schemaOf("crawl_multi_page")).inputSchema.properties;
    const expected = {
      maxPages: [2, 50],
      maxDepth: [1, 5],
      pageLoadTimeout: [5000, 180000],
      scriptTimeoutMs: [10000, 300000],
      analysisTimeoutMs: [5000, 240000],
      modelLoadTimeoutMs: [1000, 120000],
    };
    for (const [key, [min, max]] of Object.entries(expected)) {
      assert.equal(multi[key].type, "integer", key);
      assert.equal(multi[key].minimum, min, `${key} minimum`);
      assert.equal(multi[key].maximum, max, `${key} maximum`);
    }

    const retry = (await schemaOf("run_critical_tests")).inputSchema.properties.retryCount;
    assert.equal(retry.type, "integer");
    assert.equal(retry.minimum, 0);
  });

  it("accepts url as an alias for startUrl on crawl_multi_page", async () => {
    const tool = await schemaOf("crawl_multi_page");
    assert.ok("url" in tool.inputSchema.properties);
    assert.ok("startUrl" in tool.inputSchema.properties);
  });

  it("offers excludeUrlPatterns on crawl_multi_page", async () => {
    const prop = (await schemaOf("crawl_multi_page")).inputSchema.properties.excludeUrlPatterns;
    assert.equal(prop.type, "array");
    assert.equal(prop.items.type, "string");
    assert.match(prop.description, /never visited/);
  });

  it("rejects an excludeUrlPatterns entry that is not a valid regular expression", async () => {
    const result = await call("crawl_multi_page", { url: "https://x.test/", excludeUrlPatterns: ["("] });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /^Invalid arguments: excludeUrlPatterns/);
  });

  it("states side effects and cost in the descriptions", async () => {
    assert.match((await schemaOf("crawl_and_analyze")).description, /headless Chrome/);
    assert.match((await schemaOf("run_critical_tests")).description, /staging/);
    const multi = await schemaOf("crawl_multi_page");
    assert.match(multi.description, /test account/);
    assert.match(multi.description, /minutes/);
    assert.match(multi.inputSchema.properties.credentials.description, /not returned in the output/);
  });

  it("says get_element_locator uses only the last crawl_and_analyze page", async () => {
    const tool = await schemaOf("get_element_locator");
    assert.match(tool.description, /crawl_and_analyze/);
    assert.match(tool.description, /not crawl_multi_page/);
  });
});

describe("MCP handlers: get_element_locator results", () => {
  const page = {
    url: "https://shop.test/login",
    title: "Login",
    consoleLogs: [],
    highIntentElements: [
      {
        path: "form > button",
        tag: "button",
        id: "login-submit",
        text: "Sign in",
        locator: "#login-submit",
        intentReasons: ["submit"],
        intentScore: 80,
        attributes: { type: "submit" },
      },
    ],
  };

  after(() => testing.setLastAnalysis(null));

  it("reports no match as an error naming the page and description, without returning *", async () => {
    testing.setLastAnalysis(page);
    const result = await call("get_element_locator", { description: "zebra giraffe" });

    assert.equal(result.isError, true);
    assert.equal(textOf(result), 'No element on https://shop.test/login matched "zebra giraffe".');
  });

  it("names the page the locator came from", async () => {
    testing.setLastAnalysis(page);
    const result = await call("get_element_locator", { description: "sign in button" });

    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /Page: https:\/\/shop\.test\/login/);
    assert.match(textOf(result), /login-submit/);
  });
});

describe("MCP handlers: workflows by name or ID", () => {
  const workflow = (id, name, confidence) => ({
    id,
    name,
    pageSequence: ["https://x.test/"],
    actionSequence: [],
    stateTransitions: [],
    confidence,
    tags: ["form"],
  });

  before(() => {
    testing.storeSession("seeded", {
      sessionId: "seeded",
      startUrl: "https://x.test/",
      pages: [],
      metadata: { startTime: 0, totalPages: 0, totalElementsAnalyzed: 0, totalHighIntentElements: 0 },
      sessionState: {},
      workflows: [workflow("wf_a", "checkout_flow", 80), workflow("wf_b", "login_flow", 70)],
    });
  });

  it("get_workflow_by_name finds a workflow by ID", async () => {
    const result = await call("get_workflow_by_name", { sessionId: "seeded", workflowName: "wf_b" });
    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /login_flow/);
  });

  it("export_workflow_visualization accepts workflow names as well as IDs", async () => {
    const result = await call("export_workflow_visualization", {
      sessionId: "seeded",
      workflowIds: ["checkout_flow"],
      format: "individual",
    });
    assert.notEqual(result.isError, true);
    assert.match(textOf(result), /checkout_flow/);
    assert.doesNotMatch(textOf(result), /login_flow/);
  });

  it("export_workflow_visualization lists what is available when nothing matches", async () => {
    const result = await call("export_workflow_visualization", {
      sessionId: "seeded",
      workflowIds: ["nope"],
    });
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, /nope/);
    assert.match(text, /checkout_flow \(wf_a\)/);
    assert.match(text, /login_flow \(wf_b\)/);
  });
});

describe("MCP handlers: resilience", () => {
  it("stays responsive after a rejected call", async () => {
    await call("crawl_and_analyze", {});

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

describe("run_critical_tests Markdown report", () => {
  it("reports skipped tests and handler errors apart from failures", async () => {
    const { __testing } = await import("../../build/index.js");
    const md = __testing.formatTestResultsMarkdown({
      url: "https://shop.test/",
      totalTests: 4,
      passedTests: 1,
      failedTests: 1,
      skippedTests: 1,
      handlerErrors: 1,
      totalDuration: 10,
      semanticTools: [],
      results: [
        { testId: "TC_A", toolName: "a", success: true, status: "passed", message: "ok", duration: 1 },
        { testId: "TC_B", toolName: "b", success: false, status: "failed", message: "boom", duration: 1 },
        { testId: "TC_C", toolName: "c", success: false, status: "skipped", message: "destructive", duration: 0 },
        { testId: "TC_D", toolName: "d", success: false, status: "handler-error", message: "no handler", duration: 0 },
      ],
    });

    assert.match(md, /\| Skipped \| 1 \|/);
    assert.match(md, /\| Handler errors \| 1 \|/);
    assert.match(md, /\| Pass Rate \| 50\.0% \|/, "pass rate counts only tests that ran");
    assert.match(md, /SKIPPED - TC_C/);
    assert.match(md, /HANDLER ERROR - TC_D/);
    assert.equal((md.match(/FAIL - /g) || []).length, 1, "only the real failure is marked FAIL");
  });
});
