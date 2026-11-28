import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TestExecutor, HANDLER_NOT_ATTACHED } from "../../build/test-executor.js";

/**
 * Minimal WebDriver stand-in that models one browser tab.
 *
 * TestExecutor reloads the start URL and injects handlers before each test,
 * tags the document, calls the tool, and then checks whether the document
 * was replaced. The double handles the bookkeeping scripts itself and only
 * records (and asks `respond` about) the actual tool invocations, so `calls`
 * is the list of tools that ran. `respond` receives a `page` object whose
 * navigate() simulates the tool's action replacing the document.
 */
function fakeDriver(respond, { failGet = false } = {}) {
  const calls = [];
  const gets = [];
  const injected = [];
  let docToken = null;
  let url = "about:blank";
  const page = {
    navigate(to = "https://example.test/next") {
      docToken = null;
      url = to;
    },
  };
  return {
    calls,
    gets,
    injected,
    async get(to) {
      if (failGet) throw new Error("net::ERR_CONNECTION_REFUSED");
      gets.push(to);
      docToken = null;
      url = to;
    },
    async getCurrentUrl() {
      return url;
    },
    async executeScript(script, ...args) {
      if (script.includes("__cartographerDocToken = arguments[0]")) {
        docToken = args[0];
        return undefined;
      }
      if (script.includes("__cartographerDocToken")) return docToken;
      if (script.includes("Register semantic tool handlers")) {
        injected.push(script);
        return undefined;
      }
      calls.push({ script, args });
      return respond(args[0], calls.length, page);
    },
  };
}

function testCase(overrides = {}) {
  return {
    id: "TC-1",
    name: "Click submit",
    description: "Clicks the submit button",
    priority: "critical",
    actionType: "click",
    locator: "#submit",
    preconditions: [],
    steps: ["click"],
    expectedResults: ["ok"],
    intentScore: 90,
    tags: [],
    sourceElement: { path: "", tag: "button", locator: "#submit", intentScore: 90, intentReasons: [] },
    semanticTool: "submit",
    ...overrides,
  };
}

const okResult = { success: true, message: "Tool executed successfully", duration: 5 };
const notFound = (tool) => ({
  success: false,
  message: "Tool not found: " + tool,
  duration: 0,
  error: HANDLER_NOT_ATTACHED,
});

describe("TestExecutor.executeTests selection", () => {
  it("runs only critical tests that have a semantic tool", async () => {
    const driver = fakeDriver(() => okResult);
    const executor = new TestExecutor(driver);

    const summary = await executor.executeTests(
      [
        testCase({ id: "TC-1", semanticTool: "alpha" }),
        testCase({ id: "TC-2", priority: "high", semanticTool: "beta" }),
        testCase({ id: "TC-3", semanticTool: undefined }),
        testCase({ id: "TC-4", semanticTool: "delta" }),
      ],
      [],
      "https://example.test"
    );

    assert.equal(summary.totalTests, 2);
    assert.deepEqual(
      summary.results.map((r) => r.testId),
      ["TC-1", "TC-4"]
    );
    assert.deepEqual(
      driver.calls.map((c) => c.args[0]),
      ["alpha", "delta"]
    );
  });

  it("retries a failing test up to retryCount more times", async () => {
    const fail = { success: false, message: "nope", duration: 1 };
    const driver = fakeDriver((_tool, n) => (n < 3 ? fail : okResult));
    const summary = await new TestExecutor(driver).executeTests(
      [testCase()],
      [],
      "https://example.test",
      2
    );

    assert.equal(driver.calls.length, 3);
    assert.equal(summary.passedTests, 1);
    assert.equal(summary.failedTests, 0);
  });

  it("does not retry by default, and stops retrying at retryCount", async () => {
    const fail = { success: false, message: "nope", duration: 1 };
    const once = fakeDriver(() => fail);
    await new TestExecutor(once).executeTests([testCase()], [], "https://example.test");
    assert.equal(once.calls.length, 1);

    const capped = fakeDriver(() => fail);
    const summary = await new TestExecutor(capped).executeTests([testCase()], [], "https://example.test", 2);
    assert.equal(capped.calls.length, 3);
    assert.equal(summary.failedTests, 1);
  });

  it("returns an empty summary when nothing is runnable", async () => {
    const driver = fakeDriver(() => okResult);
    const summary = await new TestExecutor(driver).executeTests(
      [testCase({ priority: "low", semanticTool: undefined })],
      [],
      "https://example.test"
    );

    assert.equal(summary.totalTests, 0);
    assert.equal(summary.passedTests, 0);
    assert.equal(summary.failedTests, 0);
    assert.equal(driver.calls.length, 0);
    assert.equal(driver.gets.length, 0);
  });

  it("echoes the url and semantic tool schemas into the summary", async () => {
    const tools = [{ name: "submit", description: "", actionType: "click", inputSchema: {}, returnType: "" }];
    const summary = await new TestExecutor(fakeDriver(() => okResult)).executeTests(
      [testCase()],
      tools,
      "https://example.test/cart"
    );

    assert.equal(summary.url, "https://example.test/cart");
    assert.deepEqual(summary.semanticTools, tools);
    assert.equal(typeof summary.totalDuration, "number");
  });
});

describe("TestExecutor page reset between tests", () => {
  it("reloads the start URL and re-registers handlers before every test", async () => {
    const driver = fakeDriver(() => okResult);
    await new TestExecutor(driver).executeTests(
      [
        testCase({ id: "TC-1", semanticTool: "alpha" }),
        testCase({ id: "TC-2", semanticTool: "beta" }),
      ],
      [],
      "https://example.test/"
    );

    assert.deepEqual(driver.gets, ["https://example.test/", "https://example.test/"]);
    assert.equal(driver.injected.length, 2);
    // Handlers are registered under the names the test cases reference.
    for (const script of driver.injected) {
      assert.match(script, /navigator\.webmcp\.tools\["alpha"\]/);
      assert.match(script, /navigator\.webmcp\.tools\["beta"\]/);
    }
  });

  it("keeps later tests passing after an earlier test navigates away", async () => {
    // Simulates the BenchmarkShop bug: the first tool submits a form, which
    // replaced the page and wiped every handler for the tests after it.
    let handlersPresent = true;
    const driver = fakeDriver((tool, _n, page) => {
      if (!handlersPresent) return notFound(tool);
      if (tool === "submitSearch") {
        page.navigate("https://example.test/search");
        handlersPresent = false;
        throw new Error("javascript error: document unloaded while waiting for result");
      }
      return okResult;
    });
    const originalGet = driver.get;
    driver.get = async (to) => {
      handlersPresent = true;
      return originalGet(to);
    };

    const summary = await new TestExecutor(driver).executeTests(
      [
        testCase({ id: "TC-1", semanticTool: "submitSearch", actionType: "submit" }),
        testCase({ id: "TC-2", semanticTool: "addToCart" }),
        testCase({ id: "TC-3", semanticTool: "products" }),
      ],
      [],
      "https://example.test/"
    );

    assert.equal(summary.passedTests, 3);
    assert.equal(summary.failedTests, 0);
    assert.match(summary.results[0].message, /navigated to https:\/\/example\.test\/search/);
  });

  it("counts a tool whose page was replaced mid-call as passed, not 'tool not found'", async () => {
    // Selenium can re-evaluate the call on the new document, where the
    // handler does not exist; that must not be reported as a missing tool.
    const driver = fakeDriver((tool, _n, page) => {
      page.navigate("https://example.test/products/1");
      return notFound(tool);
    });
    const summary = await new TestExecutor(driver).executeTests(
      [testCase({ semanticTool: "viewDetails", actionType: "navigate" })],
      [],
      "https://example.test/"
    );

    const [result] = summary.results;
    assert.equal(result.status, "passed");
    assert.equal(result.success, true);
    assert.equal(summary.handlerErrors, 0);
  });

  it("can be turned off", async () => {
    const driver = fakeDriver(() => okResult);
    await new TestExecutor(driver, { resetBetweenTests: false }).executeTests(
      [testCase()],
      [],
      "https://example.test/"
    );
    assert.equal(driver.gets.length, 0);
    assert.equal(driver.injected.length, 0);
    assert.equal(driver.calls.length, 1);
  });

  it("reports a failed reset as a Cartographer problem, not a site failure", async () => {
    const driver = fakeDriver(() => okResult, { failGet: true });
    const summary = await new TestExecutor(driver).executeTests([testCase()], [], "https://example.test/");

    assert.equal(summary.failedTests, 0);
    assert.equal(summary.handlerErrors, 1);
    assert.equal(summary.results[0].status, "handler-error");
    assert.equal(driver.calls.length, 0);
  });
});

describe("TestExecutor destructive tests", () => {
  it("skips tests tagged destructive and reports why", async () => {
    const driver = fakeDriver(() => okResult);
    const summary = await new TestExecutor(driver).executeTests(
      [
        testCase({ id: "TC-1", semanticTool: "deleteItem", actionType: "delete", tags: ["delete", "destructive"] }),
        testCase({ id: "TC-2", semanticTool: "removeAll", tags: ["destructive"] }),
        testCase({ id: "TC-3", semanticTool: "save" }),
      ],
      [],
      "https://example.test/"
    );

    assert.deepEqual(driver.calls.map((c) => c.args[0]), ["save"]);
    assert.equal(summary.skippedTests, 2);
    assert.equal(summary.passedTests, 1);
    assert.equal(summary.failedTests, 0);
    const skipped = summary.results.filter((r) => r.status === "skipped");
    assert.deepEqual(skipped.map((r) => r.testId), ["TC-1", "TC-2"]);
    for (const r of skipped) assert.match(r.message, /destructive/i);
    // Skipped tools are not even registered in the page.
    assert.doesNotMatch(driver.injected[0], /deleteItem|removeAll/);
  });

  it("runs destructive tests when explicitly allowed", async () => {
    const driver = fakeDriver(() => okResult);
    const summary = await new TestExecutor(driver, { includeDestructive: true }).executeTests(
      [testCase({ semanticTool: "deleteItem", actionType: "delete", tags: ["destructive"] })],
      [],
      "https://example.test/"
    );
    assert.equal(summary.skippedTests, 0);
    assert.equal(summary.passedTests, 1);
  });
});

describe("TestExecutor result tallying", () => {
  it("counts passes and failures separately", async () => {
    const driver = fakeDriver((toolName) =>
      toolName === "bad"
        ? { success: false, message: "Element not found", duration: 1, error: "not found" }
        : okResult
    );

    const summary = await new TestExecutor(driver).executeTests(
      [
        testCase({ id: "TC-1", semanticTool: "good" }),
        testCase({ id: "TC-2", semanticTool: "bad" }),
        testCase({ id: "TC-3", semanticTool: "good" }),
      ],
      [],
      "https://example.test"
    );

    assert.equal(summary.totalTests, 3);
    assert.equal(summary.passedTests, 2);
    assert.equal(summary.failedTests, 1);
    assert.equal(summary.passedTests + summary.failedTests, summary.totalTests);
  });

  it("propagates the failure message and error from the browser", async () => {
    const driver = fakeDriver(() => ({
      success: false,
      message: "Element not found: #submit",
      duration: 0,
      error: "Error: Element not found: #submit",
    }));

    const summary = await new TestExecutor(driver).executeTests(
      [testCase({ semanticTool: "ghost" })],
      [],
      "https://example.test"
    );

    const [result] = summary.results;
    assert.equal(result.success, false);
    assert.equal(result.status, "failed");
    assert.equal(result.message, "Element not found: #submit");
    assert.equal(result.error, "Error: Element not found: #submit");
    assert.equal(result.toolName, "ghost");
  });

  it("reports a missing handler distinctly from a site failure", async () => {
    const driver = fakeDriver((tool) => notFound(tool));
    const summary = await new TestExecutor(driver).executeTests(
      [testCase({ semanticTool: "ghost", locator: "#ghost" })],
      [],
      "https://example.test"
    );

    const [result] = summary.results;
    assert.equal(result.status, "handler-error");
    assert.equal(result.success, false);
    assert.equal(result.error, HANDLER_NOT_ATTACHED);
    assert.match(result.message, /Cartographer could not attach a handler for this element/);
    assert.match(result.message, /#ghost/);
    assert.equal(summary.failedTests, 0);
    assert.equal(summary.handlerErrors, 1);
  });

  it("turns a driver exception into a failed result rather than throwing", async () => {
    const driver = fakeDriver(() => {
      throw new Error("session deleted because of page crash");
    });

    const summary = await new TestExecutor(driver).executeTests(
      [testCase()],
      [],
      "https://example.test"
    );

    assert.equal(summary.failedTests, 1);
    assert.match(summary.results[0].message, /Test execution failed/);
    assert.match(summary.results[0].message, /page crash/);
  });

  it("keeps running after one test throws", async () => {
    const driver = fakeDriver((_tool, n) => {
      if (n === 1) throw new Error("transient");
      return okResult;
    });

    const summary = await new TestExecutor(driver).executeTests(
      [
        testCase({ id: "TC-1", semanticTool: "a" }),
        testCase({ id: "TC-2", semanticTool: "b" }),
      ],
      [],
      "https://example.test"
    );

    assert.equal(summary.totalTests, 2);
    assert.equal(summary.failedTests, 1);
    assert.equal(summary.passedTests, 1);
  });

  it("reports a non-negative duration for every result", async () => {
    const summary = await new TestExecutor(fakeDriver(() => okResult)).executeTests(
      [testCase({ id: "TC-1", semanticTool: "a" }), testCase({ id: "TC-2", semanticTool: "b" })],
      [],
      "https://example.test"
    );

    for (const result of summary.results) {
      assert.ok(result.duration >= 0, `negative duration: ${result.duration}`);
    }
    assert.ok(summary.totalDuration >= 0);
  });
});

describe("TestExecutor.verifyToolsRegistered", () => {
  it("returns the tool names the page reports", async () => {
    const driver = fakeDriver(() => ["search", "addToCart"]);
    const tools = await new TestExecutor(driver).verifyToolsRegistered();
    assert.deepEqual(tools, ["search", "addToCart"]);
  });

  it("returns an empty array when the page reports nothing", async () => {
    const driver = fakeDriver(() => null);
    assert.deepEqual(await new TestExecutor(driver).verifyToolsRegistered(), []);
  });

  it("returns an empty array instead of throwing when the driver fails", async () => {
    const driver = {
      async executeScript() {
        throw new Error("no such session");
      },
    };
    assert.deepEqual(await new TestExecutor(driver).verifyToolsRegistered(), []);
  });
});
