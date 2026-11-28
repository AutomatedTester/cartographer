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

// ===========================================================================
// Action-type dispatch and tagging
//
// generate() ran at 85% of lines but 74% of branches: the seven action types
// each select a different test template, and only a few arms were taken. The
// action type decides what a tester is actually told to do, so dispatching to
// the wrong template produces a confident, well-formed, wrong instruction.
// ===========================================================================

describe("TestCaseGenerator: action type dispatch", () => {
  function actionFor(overrides) {
    return TestCaseGenerator.generate([element(overrides)], "Page")[0].actionType;
  }

  it("routes an aria-label mentioning delete to the delete template", () => {
    assert.equal(actionFor({ ariaLabel: "Delete this item" }), "delete");
  });

  it("lets delete win over every other signal", () => {
    assert.equal(
      actionFor({ tag: "a", ariaLabel: "Delete item", navigationTarget: "/x" }),
      "delete"
    );
  });

  for (const type of ["email", "text", "password", "search"]) {
    it(`routes input[type="${type}"] to the input template`, () => {
      assert.equal(actionFor({ tag: "input", attributes: { type } }), "input");
    });
  }

  it("does not route a checkbox input to the input template", () => {
    assert.equal(actionFor({ tag: "input", attributes: { type: "checkbox" } }), "click");
  });

  it("routes a select to the select template", () => {
    assert.equal(actionFor({ tag: "select" }), "select");
  });

  it("routes a textarea to the input template", () => {
    assert.equal(actionFor({ tag: "textarea" }), "input");
  });

  it("routes a submit button inside a form to the submit template", () => {
    assert.equal(
      actionFor({ tag: "button", attributes: { type: "submit" }, path: "body > form > button" }),
      "submit"
    );
  });

  // All three conditions are required, so a submit button outside a form is
  // just a click.
  it("does not route a submit button outside a form to submit", () => {
    assert.equal(
      actionFor({ tag: "button", attributes: { type: "submit" }, path: "body > div > button" }),
      "click"
    );
  });

  it("routes a link to the navigation template", () => {
    assert.equal(actionFor({ tag: "a", path: "body > a" }), "navigate");
  });

  it("routes a non-button with a navigation target to navigation", () => {
    assert.equal(
      actionFor({ tag: "div", navigationTarget: "/next", path: "body > div" }),
      "navigate"
    );
  });

  // A button that navigates is still a click: buttons are excluded from the
  // navigation rule so that form buttons are not described as links.
  it("does not route a navigating button to navigation", () => {
    assert.equal(
      actionFor({ tag: "button", navigationTarget: "/next", path: "body > div > button" }),
      "click"
    );
  });

  for (const role of ["checkbox", "radio"]) {
    it(`routes role="${role}" to the click template`, () => {
      assert.equal(actionFor({ tag: "div", role, path: "body > div" }), "click");
    });
  }

  it("routes an aria-label mentioning hover to the hover template", () => {
    assert.equal(actionFor({ tag: "div", ariaLabel: "Hover for details", path: "body > div" }), "hover");
  });

  it("routes role=\"menuitem\" to the hover template", () => {
    assert.equal(actionFor({ tag: "div", role: "menuitem", path: "body > div" }), "hover");
  });

  it("falls back to click for anything unrecognised", () => {
    assert.equal(actionFor({ tag: "div", path: "body > div" }), "click");
  });
});

describe("TestCaseGenerator: per-template content", () => {
  function testCaseFor(overrides) {
    return TestCaseGenerator.generate([element(overrides)], "Page")[0];
  }

  const templates = [
    ["navigate", { tag: "a", text: "Catalog", path: "body > a" }],
    ["submit", { tag: "button", attributes: { type: "submit" }, path: "body > form > button" }],
    ["input", { tag: "input", attributes: { type: "email" } }],
    ["select", { tag: "select" }],
    ["delete", { ariaLabel: "Delete item" }],
    ["hover", { tag: "div", role: "menuitem", path: "body > div" }],
    ["click", { tag: "button", path: "body > div > button" }],
  ];

  for (const [action, overrides] of templates) {
    it(`gives the ${action} template a name, steps and expected results`, () => {
      const testCase = testCaseFor(overrides);

      assert.equal(testCase.actionType, action);
      assert.ok(testCase.name.length > 0, "needs a name");
      assert.ok(testCase.description.length > 0, "needs a description");
      assert.ok(testCase.steps.length > 0, "needs at least one step");
      assert.ok(testCase.expectedResults.length > 0, "needs an expected result");
      assert.ok(Array.isArray(testCase.preconditions), "needs preconditions");
    });

    it(`names the locator in the ${action} template's steps`, () => {
      const testCase = testCaseFor(overrides);
      assert.ok(
        testCase.steps.some((step) => step.includes(testCase.locator)),
        `no step names ${testCase.locator}: ${JSON.stringify(testCase.steps)}`
      );
    });
  }

  it("distinguishes the templates from one another", () => {
    const names = templates.map(([, overrides]) => testCaseFor(overrides).name);
    assert.equal(new Set(names).size, names.length, `templates overlap: ${names}`);
  });
});

describe("TestCaseGenerator: tags", () => {
  function tagsFor(overrides) {
    return TestCaseGenerator.generate([element(overrides)], "Page")[0].tags;
  }

  it("always tags with the action type and the tag name", () => {
    const tags = tagsFor({ tag: "button", path: "body > div > button" });
    assert.ok(tags.includes("click"));
    assert.ok(tags.includes("button"));
  });

  it("tags a navigating element as navigation and others as interaction", () => {
    assert.ok(tagsFor({ navigates: true }).includes("navigation"));
    assert.ok(tagsFor({ navigates: false }).includes("interaction"));
  });

  it("tags a high score as high-priority", () => {
    assert.ok(tagsFor({ intentScore: 50 }).includes("high-priority"));
    assert.ok(!tagsFor({ intentScore: 49 }).includes("high-priority"));
  });

  it("tags an aria role", () => {
    assert.ok(tagsFor({ role: "checkbox" }).includes("aria:checkbox"));
  });

  it("tags destructive, search and form wording from the aria-label", () => {
    assert.ok(tagsFor({ ariaLabel: "Delete item" }).includes("destructive"));
    assert.ok(tagsFor({ ariaLabel: "Search products" }).includes("search"));
    assert.ok(tagsFor({ ariaLabel: "Submit form" }).includes("form"));
  });

  it("tags the input type", () => {
    assert.ok(
      tagsFor({ tag: "input", attributes: { type: "password" } }).includes("input:password")
    );
  });

  it("does not repeat a tag", () => {
    // actionType 'select' and tag 'select' would otherwise appear twice.
    const tags = tagsFor({ tag: "select" });
    assert.equal(new Set(tags).size, tags.length, `duplicate tag in ${tags}`);
  });

  it("omits optional tags when the element carries no such signal", () => {
    const tags = tagsFor({ tag: "button", intentScore: 10, path: "body > div > button" });

    assert.ok(!tags.some((t) => t.startsWith("aria:")));
    assert.ok(!tags.some((t) => t.startsWith("input:")));
    assert.ok(!tags.includes("destructive"));
    assert.ok(!tags.includes("high-priority"));
  });
});

describe("TestCaseGenerator: identifiers", () => {
  it("builds an id from the page title, tag and position", () => {
    const [first, second] = TestCaseGenerator.generate(
      [element({ tag: "button" }), element({ tag: "a", locator: "#link", path: "body > a" })],
      "Cart Page"
    );

    assert.equal(first.id, "TC_CART_PAGE_BUTTON_1");
    assert.equal(second.id, "TC_CART_PAGE_A_2");
  });

  it("collapses whitespace in a page title", () => {
    const [testCase] = TestCaseGenerator.generate([element()], "My   Long  Title");
    assert.equal(testCase.id, "TC_MY_LONG_TITLE_BUTTON_1");
  });

  it("copes with an empty page title", () => {
    const [testCase] = TestCaseGenerator.generate([element()], "");
    assert.equal(testCase.id, "TC_BUTTON_1");
  });

  it("keeps only [A-Z0-9_] and drops a repeated site name", () => {
    const [testCase] = TestCaseGenerator.generate(
      [element(), element(), element()],
      "BenchmarkShop | BenchmarkShop"
    ).slice(2);
    assert.equal(testCase.id, "TC_BENCHMARKSHOP_BUTTON_3");
  });

  it("strips punctuation and collapses separators", () => {
    const [testCase] = TestCaseGenerator.generate(
      [element()],
      "  Cart — Items (2) | Shop!  "
    );
    assert.equal(testCase.id, "TC_CART_ITEMS_2_SHOP_BUTTON_1");
    assert.match(testCase.id, /^[A-Z0-9_]+$/);
    assert.doesNotMatch(testCase.id, /__|^_|_$/);
  });
});

describe("TestCaseGenerator: forms", () => {
  it("treats a <form> as a submit action, not a navigation", () => {
    const [testCase] = TestCaseGenerator.generate(
      [element({ tag: "form", locator: "#search-form", navigationTarget: "/search" })],
      "Home"
    );
    assert.equal(testCase.actionType, "submit");
  });
});
