import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TestExecutor } from "../../build/test-executor.js";

/**
 * Minimal WebDriver stand-in. TestExecutor only calls executeScript, so the
 * double records the calls and replays whatever the test queues up.
 */
function fakeDriver(respond) {
  const calls = [];
  return {
    calls,
    async executeScript(script, ...args) {
      calls.push({ script, args });
      return respond(args[0], calls.length);
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
      message: "Tool not found: ghost",
      duration: 0,
      error: "Tool not registered",
    }));

    const summary = await new TestExecutor(driver).executeTests(
      [testCase({ semanticTool: "ghost" })],
      [],
      "https://example.test"
    );

    const [result] = summary.results;
    assert.equal(result.success, false);
    assert.equal(result.message, "Tool not found: ghost");
    assert.equal(result.error, "Tool not registered");
    assert.equal(result.toolName, "ghost");
  });

  it("turns a driver exception into a failed result rather than throwing", async () => {
    const driver = {
      async executeScript() {
        throw new Error("session deleted because of page crash");
      },
    };

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
    let call = 0;
    const driver = {
      async executeScript() {
        call += 1;
        if (call === 1) throw new Error("transient");
        return okResult;
      },
    };

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
