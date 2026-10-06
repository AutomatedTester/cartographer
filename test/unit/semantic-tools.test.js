import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SemanticToolGenerator } from "../../build/webmcp-semantic-tools.js";

/** Build a HighIntentElement with sensible defaults. */
function element(overrides = {}) {
  return {
    path: "body > button",
    tag: "button",
    text: "Click me",
    locator: "button",
    intentScore: 60,
    intentReasons: ["button tag"],
    ...overrides,
  };
}

describe("SemanticToolGenerator.generate", () => {
  it("keeps only elements scoring at or above the critical threshold of 50", () => {
    const schemas = SemanticToolGenerator.generate([
      element({ text: "Keep high", locator: "#a", intentScore: 95 }),
      element({ text: "Keep boundary", locator: "#b", intentScore: 50 }),
      element({ text: "Drop just below", locator: "#c", intentScore: 49 }),
      element({ text: "Drop low", locator: "#d", intentScore: 5 }),
    ]);

    assert.deepEqual(
      schemas.map((s) => s.name),
      ["keepHigh", "keepBoundary"]
    );
  });

  it("returns an empty array when nothing clears the threshold", () => {
    const schemas = SemanticToolGenerator.generate([
      element({ intentScore: 10 }),
      element({ intentScore: 49 }),
    ]);
    assert.deepEqual(schemas, []);
  });

  it("returns an empty array for no input", () => {
    assert.deepEqual(SemanticToolGenerator.generate([]), []);
  });

  it("produces a fully populated schema for each surviving element", () => {
    const [schema] = SemanticToolGenerator.generate([
      element({ ariaLabel: "Search button", locator: "button.search" }),
    ]);

    assert.equal(schema.name, "search");
    assert.equal(schema.actionType, "click");
    assert.match(schema.description, /click/);
    assert.match(schema.description, /Search button/);
    assert.equal(
      schema.returnType,
      "{ success: boolean; message: string; payload?: any }"
    );
    assert.equal(schema.inputSchema.type, "object");
  });
});

describe("SemanticToolGenerator.generateToolName", () => {
  const cases = [
    { desc: "prefers aria-label over text", el: { ariaLabel: "Search button", text: "ignored" }, expected: "search" },
    { desc: "camelCases multi-word labels", el: { ariaLabel: "Subscribe to Newsletter button" }, expected: "subscribeToNewsletter" },
    { desc: "falls back to text when aria-label is absent", el: { text: "Favorites" }, expected: "favorites" },
    { desc: "falls back to id when aria-label and text are absent", el: { tag: "div", text: undefined, id: "checkout" }, expected: "checkout" },
    { desc: "falls back to tag as a last resort", el: { tag: "section", text: undefined }, expected: "section" },
    { desc: "strips the word link", el: { text: "Careers link" }, expected: "careers" },
    { desc: "strips the word field", el: { text: "Email field" }, expected: "email" },
    { desc: "drops punctuation", el: { text: "Forgot Password?" }, expected: "forgotPassword" },
    { desc: "collapses repeated whitespace", el: { text: "  Add   to   Cart  " }, expected: "addToCart" },
  ];

  for (const { desc, el, expected } of cases) {
    it(desc, () => {
      assert.equal(SemanticToolGenerator.generateToolName(element(el)), expected);
    });
  }

  it("always yields an identifier safe to use as a property name", () => {
    const names = [
      "Buy now — 50% off!",
      "Sign in / Register",
      "Save & continue",
      "héllo wörld",
    ].map((text) => SemanticToolGenerator.generateToolName(element({ text })));

    for (const name of names) {
      assert.match(name, /^[a-zA-Z0-9]*$/, `"${name}" is not identifier-safe`);
    }
  });
});

describe("SemanticToolGenerator action type inference", () => {
  /** generate() is the only public path to actionType, so go through it. */
  function actionTypeOf(overrides) {
    const [schema] = SemanticToolGenerator.generate([element({ intentScore: 80, ...overrides })]);
    return schema.actionType;
  }

  const cases = [
    { desc: "aria-label mentioning delete wins over everything else", el: { tag: "a", ariaLabel: "Delete item" }, expected: "delete" },
    { desc: "text input", el: { tag: "input", attributes: { type: "text" } }, expected: "input" },
    { desc: "email input", el: { tag: "input", attributes: { type: "email" } }, expected: "input" },
    { desc: "password input", el: { tag: "input", attributes: { type: "password" } }, expected: "input" },
    { desc: "search input", el: { tag: "input", attributes: { type: "search" } }, expected: "input" },
    { desc: "textarea", el: { tag: "textarea" }, expected: "input" },
    { desc: "select", el: { tag: "select" }, expected: "select" },
    { desc: "submit button", el: { tag: "button", attributes: { type: "submit" } }, expected: "submit" },
    { desc: "anchor", el: { tag: "a" }, expected: "navigate" },
    { desc: "any element with a navigation target", el: { tag: "div", navigationTarget: "/next" }, expected: "navigate" },
    { desc: "checkbox role", el: { tag: "div", role: "checkbox" }, expected: "click" },
    { desc: "radio role", el: { tag: "div", role: "radio" }, expected: "click" },
    { desc: "menuitem role", el: { tag: "div", role: "menuitem" }, expected: "hover" },
    { desc: "plain button defaults to click", el: { tag: "button" }, expected: "click" },
    { desc: "checkbox input is not treated as a text input", el: { tag: "input", attributes: { type: "checkbox" } }, expected: "click" },
  ];

  for (const { desc, el, expected } of cases) {
    it(`infers ${expected} for ${desc}`, () => {
      assert.equal(actionTypeOf(el), expected);
    });
  }
});

describe("SemanticToolGenerator input schemas", () => {
  function schemaFor(overrides) {
    const [schema] = SemanticToolGenerator.generate([element({ intentScore: 80, ...overrides })]);
    return schema.inputSchema;
  }

  it("exposes a value parameter for input actions", () => {
    const schema = schemaFor({ tag: "input", attributes: { type: "text" } });
    assert.equal(schema.properties.value.type, "string");
    assert.deepEqual(schema.required, []);
  });

  it("exposes an optionValue parameter for select actions", () => {
    const schema = schemaFor({ tag: "select" });
    assert.equal(schema.properties.optionValue.type, "string");
  });

  it("exposes a timeout parameter defaulting to 5000ms for navigate actions", () => {
    const schema = schemaFor({ tag: "a" });
    assert.equal(schema.properties.timeout.type, "number");
    assert.equal(schema.properties.timeout.default, 5000);
  });

  it("exposes no parameters for plain click actions", () => {
    const schema = schemaFor({ tag: "button" });
    assert.deepEqual(schema.properties, {});
  });

  it("never shares a mutable schema object between two generated tools", () => {
    const [a, b] = SemanticToolGenerator.generate([
      element({ text: "One", locator: "#one", intentScore: 80 }),
      element({ text: "Two", locator: "#two", intentScore: 80 }),
    ]);
    assert.notEqual(a.inputSchema, b.inputSchema, "click schemas are the same object");
  });
});
