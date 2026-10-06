import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TestCaseGenerator } from "../../build/test-case-generator.js";
import { SemanticToolGenerator } from "../../build/webmcp-semantic-tools.js";

function element(overrides = {}) {
  return {
    path: "body > form > button",
    tag: "button",
    text: "Submit",
    locator: "#submit",
    intentScore: 60,
    intentReasons: ["button tag"],
    ...overrides,
  };
}

describe("TestCaseGenerator priorities", () => {
  const cases = [
    { score: 100, expected: "critical" },
    { score: 50, expected: "critical" },
    { score: 49, expected: "high" },
    { score: 40, expected: "high" },
    { score: 39, expected: "medium" },
    { score: 30, expected: "medium" },
    { score: 29, expected: "low" },
    { score: 0, expected: "low" },
  ];

  for (const { score, expected } of cases) {
    it(`maps intent score ${score} to ${expected}`, () => {
      const [test] = TestCaseGenerator.generate([element({ intentScore: score })], "Page");
      assert.equal(test.priority, expected);
    });
  }
});

describe("TestCaseGenerator output", () => {
  it("produces one test case per element", () => {
    const tests = TestCaseGenerator.generate(
      [
        element({ locator: "#a", text: "A" }),
        element({ locator: "#b", text: "B" }),
        element({ locator: "#c", text: "C" }),
      ],
      "Page"
    );
    assert.equal(tests.length, 3);
  });

  it("returns an empty array for no elements", () => {
    assert.deepEqual(TestCaseGenerator.generate([], "Page"), []);
  });

  it("gives every test case a unique id", () => {
    const tests = TestCaseGenerator.generate(
      Array.from({ length: 10 }, (_, i) =>
        element({ locator: `#el-${i}`, text: `Element ${i}` })
      ),
      "Page"
    );
    assert.equal(new Set(tests.map((t) => t.id)).size, tests.length);
  });

  it("fills in the fields downstream consumers rely on", () => {
    const [test] = TestCaseGenerator.generate(
      [element({ text: "Add to Cart", locator: "#add", intentScore: 90 })],
      "Product Page"
    );

    assert.ok(test.name, "name");
    assert.ok(test.description, "description");
    assert.equal(test.locator, "#add");
    assert.equal(test.intentScore, 90);
    assert.ok(Array.isArray(test.steps) && test.steps.length > 0, "steps");
    assert.ok(
      Array.isArray(test.expectedResults) && test.expectedResults.length > 0,
      "expectedResults"
    );
    assert.ok(Array.isArray(test.preconditions), "preconditions");
    assert.ok(Array.isArray(test.tags), "tags");
    assert.equal(test.sourceElement.locator, "#add");
  });

  it("carries the action type through from the element", () => {
    const expectations = [
      [{ tag: "input", attributes: { type: "email" } }, "input"],
      [{ tag: "select" }, "select"],
      [{ tag: "textarea" }, "input"],
      [{ tag: "a" }, "navigate"],
      [{ tag: "button", ariaLabel: "Delete row" }, "delete"],
      [{ tag: "button" }, "click"],
    ];

    for (const [overrides, expected] of expectations) {
      const [test] = TestCaseGenerator.generate([element(overrides)], "Page");
      assert.equal(test.actionType, expected, JSON.stringify(overrides));
    }
  });
});

describe("TestCaseGenerator semantic tool wiring", () => {
  it("attaches a semantic tool and executable code to critical tests", () => {
    const [test] = TestCaseGenerator.generate(
      [element({ text: "Checkout", locator: "#checkout", intentScore: 95 })],
      "Cart"
    );

    assert.equal(test.semanticTool, "checkout");
    assert.ok(test.testCode, "critical tests need executable code");
    assert.match(test.testCode, /navigator\.webmcp\.tools/);
    assert.match(test.testCode, /checkout/);
  });

  it("leaves non-critical tests without a semantic tool", () => {
    const [test] = TestCaseGenerator.generate(
      [element({ text: "Minor", locator: "#minor", intentScore: 30 })],
      "Page"
    );

    assert.equal(test.semanticTool, undefined);
    assert.equal(test.testCode, undefined);
  });

  it("references tool names that are actually registered", () => {
    // Two elements reduce to the same base name, so registration suffixes one.
    // A test case naming the unsuffixed tool would fail at run time.
    const elements = [
      element({ text: "Login", locator: "#login-top", intentScore: 90 }),
      element({ text: "Login", locator: "#login-bottom", intentScore: 85 }),
    ];

    const registered = SemanticToolGenerator.generate(elements).map((s) => s.name);
    const referenced = TestCaseGenerator.generate(elements, "Page")
      .filter((t) => t.semanticTool)
      .map((t) => t.semanticTool);

    assert.deepEqual(referenced, registered);
    assert.equal(new Set(referenced).size, 2, "both tools must be addressable");
  });

  it("emits test code that is syntactically valid JavaScript", () => {
    const [test] = TestCaseGenerator.generate(
      [element({ text: "Buy now — 50% off!", locator: "#buy", intentScore: 95 })],
      "Page"
    );

    assert.doesNotThrow(
      () => new Function(test.testCode),
      `generated test code does not parse:\n${test.testCode}`
    );
  });
});
