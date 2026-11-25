/**
 * LocatorGenerator when given a semantic similarity per element.
 *
 * Similarities here are chosen by hand; the real model's scores were measured
 * separately (see MIN_SEMANTIC_SIMILARITY). What is under test is how the
 * generator combines them with keyword overlap.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LocatorGenerator, MIN_SEMANTIC_SIMILARITY } from "../../build/locator-generator.js";

function muted(fn) {
  const saved = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = saved;
  }
}

const dom = (overrides = {}) => ({ tag: "button", isVisible: true, attributes: {}, ...overrides });
const generator = new LocatorGenerator();
const locate = (description, elements, similarities) =>
  muted(() => generator.generateLocator(description, elements, similarities));

describe("LocatorGenerator with semantic similarities", () => {
  const page = [
    dom({ id: "pay", text: "Proceed to payment" }),
    dom({ id: "home", text: "Home" }),
  ];

  it("finds an element that shares no word with the description", () => {
    // Keyword matching alone finds nothing for this description.
    assert.equal(locate("checkout button", page).confidence, 0);

    const result = locate("checkout button", page, [0.6, 0.1]);
    assert.equal(result.selector, "#pay");
    assert.equal(result.matchedBy, "semantic");
    assert.equal(result.similarity, 0.6);
    assert.match(result.reason, /similarity 0\.60/);
  });

  it("ranks by meaning before keyword overlap", () => {
    // "account" appears in the wrong element's text; the right one is a paraphrase.
    const elements = [
      dom({ id: "account-settings", text: "Account settings" }),
      dom({ id: "delete", text: "Delete my profile" }),
    ];
    const result = locate("remove account", elements, [0.3, 0.7]);
    assert.equal(result.selector, "#delete");
  });

  it("lets a keyword match break a near-tie in similarity", () => {
    const elements = [
      dom({ id: "a", text: "Continue" }),
      dom({ id: "b", text: "Submit order" }),
    ];
    const result = locate("submit", elements, [0.5, 0.48]);
    assert.equal(result.selector, "#b");
    assert.equal(result.matchedBy, "keyword+semantic");
  });

  it("gives no keyword boost for generic control words like 'link'", () => {
    // "link" appears in the cart link's id, but says nothing about which link.
    const elements = [
      dom({ tag: "a", id: "dashboard-cart-link", text: "View Cart" }),
      dom({ tag: "a", id: "hero-deals", text: "View Deals" }),
    ];
    const result = locate("discounts link", elements, [0.25, 0.35]);
    assert.equal(result.selector, "#hero-deals");
    assert.equal(result.matchedBy, "semantic");
  });

  it("still accepts a keyword match whose similarity is low", () => {
    const result = locate("home", page, [0.05, 0.1]);
    assert.equal(result.selector, "#home");
    assert.equal(result.matchedBy, "keyword+semantic");
  });

  it("reports no match when nothing is similar enough or shares a keyword", () => {
    const result = locate("quantum flux capacitor", page, [0.08, 0.05]);
    assert.equal(result.confidence, 0);
    assert.equal(result.selector, "*");
    assert.match(result.reason, /best similarity 0\.08/);
    assert.equal(result.matchedBy, undefined);
  });

  it("uses the threshold it exports", () => {
    const just = [MIN_SEMANTIC_SIMILARITY, 0];
    const under = [MIN_SEMANTIC_SIMILARITY - 0.01, 0];
    assert.equal(locate("checkout", page, just).selector, "#pay");
    assert.equal(locate("checkout", page, under).confidence, 0);
  });

  it("works for a description with no usable keywords", () => {
    // "OK" is too short to be a keyword, but the model can still match it.
    const elements = [dom({ id: "ok", text: "Okay" }), dom({ id: "no", text: "Cancel" })];
    const result = locate("OK", elements, [0.8, 0.1]);
    assert.equal(result.selector, "#ok");
  });

  it("treats a missing similarity as zero", () => {
    const result = locate("checkout", page, [Number.NaN, 0.3]);
    assert.equal(result.selector, "#home");
  });

  it("handles an empty element list", () => {
    const result = locate("anything", [], []);
    assert.equal(result.confidence, 0);
  });

  it("falls back to keywords when the similarities do not line up with the elements", () => {
    const result = locate("home", page, [0.9]);
    assert.equal(result.selector, "#home");
    assert.equal(result.matchedBy, "keyword");
  });

  it("marks keyword-only results as such", () => {
    assert.equal(locate("home", page).matchedBy, "keyword");
    assert.equal(locate("home", page, null).matchedBy, "keyword");
  });
});

describe("LocatorGenerator minSimilarity option", () => {
  const page = [
    dom({ id: "pay", text: "Proceed to payment" }),
    dom({ id: "home", text: "Home" }),
  ];
  const locateWith = (options, similarities) =>
    muted(() => new LocatorGenerator(options).generateLocator("checkout", page, similarities));

  it("accepts a match the default threshold would reject", () => {
    assert.equal(locateWith({}, [0.17, 0]).confidence, 0);
    assert.equal(locateWith({ minSimilarity: 0.15 }, [0.17, 0]).selector, "#pay");
  });

  it("rejects a match the default threshold would accept", () => {
    assert.equal(locateWith({}, [0.3, 0]).selector, "#pay");
    const result = locateWith({ minSimilarity: 0.4 }, [0.3, 0]);
    assert.equal(result.confidence, 0);
    assert.match(result.reason, /need 0\.4/);
  });

  it("falls back to the default for a missing or non-numeric value", () => {
    for (const minSimilarity of [undefined, Number.NaN, "0.1"]) {
      assert.equal(locateWith({ minSimilarity }, [MIN_SEMANTIC_SIMILARITY - 0.01, 0]).confidence, 0);
    }
  });
});
