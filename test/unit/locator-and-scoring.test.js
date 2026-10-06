/**
 * LocatorGenerator and HeuristicScorer.
 *
 * Both are on the no-ML fallback path, so they decide what the tool reports
 * whenever the model is unavailable — which is the common case in CI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LocatorGenerator } from "../../build/locator-generator.js";
import { HeuristicScorer } from "../../build/heuristic-scorer.js";

/** Quieten the modules' progress logging. */
function muted(fn) {
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, saved);
  }
}

function dom(overrides = {}) {
  return {
    tag: "button",
    text: "Submit",
    isVisible: true,
    attributes: {},
    ...overrides,
  };
}

describe("LocatorGenerator selector strategy", () => {
  const generator = new LocatorGenerator();

  it("prefers an id when one is available", () => {
    const result = muted(() =>
      generator.generateLocator("the submit button", [
        dom({ id: "login-submit", text: "Submit" }),
      ])
    );

    assert.equal(result.selector, "#login-submit");
    assert.equal(result.type, "css");
    assert.ok(result.confidence > 0.9, `low confidence for an id: ${result.confidence}`);
  });

  it("falls back to data-testid when there is no id", () => {
    const result = muted(() =>
      generator.generateLocator("submit button", [
        dom({ text: "Submit", attributes: { "data-testid": "submit-btn" } }),
      ])
    );

    assert.equal(result.selector, '[data-testid="submit-btn"]');
  });

  it("reports zero confidence when the description has no usable keywords", () => {
    const result = muted(() => generator.generateLocator("the a of", [dom({ id: "x" })]));
    assert.equal(result.confidence, 0);
  });

  it("reports zero confidence when nothing matches", () => {
    const result = muted(() =>
      generator.generateLocator("quantum flux capacitor", [
        dom({ id: "login-submit", text: "Submit" }),
      ])
    );

    assert.equal(result.confidence, 0);
    assert.match(result.reason, /No elements matched/);
  });

  it("handles an empty element list", () => {
    const result = muted(() => generator.generateLocator("submit button", []));
    assert.equal(result.confidence, 0);
  });

  it("picks the better of two candidates", () => {
    const result = muted(() =>
      generator.generateLocator("newsletter subscribe", [
        dom({ id: "unrelated", text: "Home" }),
        dom({ id: "newsletter-subscribe", text: "Subscribe to newsletter" }),
      ])
    );

    assert.equal(result.selector, "#newsletter-subscribe");
  });

  it("always explains its choice", () => {
    const result = muted(() =>
      generator.generateLocator("submit button", [dom({ id: "login-submit" })])
    );
    assert.ok(result.reason.length > 0);
  });

  it("escapes an id that is not a bare identifier", () => {
    const result = muted(() =>
      generator.generateLocator("submit button", [dom({ id: "form:submit", text: "Submit" })])
    );

    // The selector must be usable; a raw colon would be parsed as a pseudo-class.
    assert.ok(
      !/#form:submit$/.test(result.selector),
      `unescaped id produced an invalid selector: ${result.selector}`
    );
  });
});

describe("HeuristicScorer.scoreElement", () => {
  const scorer = new HeuristicScorer();

  it("scores a submit button above inert text", () => {
    const button = scorer.scoreElement(
      dom({ tag: "button", text: "Sign In", attributes: { type: "submit" } })
    );
    const paragraph = scorer.scoreElement(dom({ tag: "p", text: "Lorem ipsum" }));

    assert.ok(
      button.score > paragraph.score,
      `button ${button.score} should outscore paragraph ${paragraph.score}`
    );
  });

  it("scores a password field highly", () => {
    const { score } = scorer.scoreElement(
      dom({ tag: "input", text: "Password", attributes: { type: "password" } })
    );
    assert.ok(score >= 50, `password field scored only ${score}`);
  });

  it("explains every score it gives", () => {
    const { score, reasons } = scorer.scoreElement(
      dom({ tag: "button", text: "Add to Cart" })
    );
    assert.ok(score > 0);
    assert.ok(Array.isArray(reasons) && reasons.length > 0, "a score needs reasons");
  });

  it("never returns a negative score", () => {
    const samples = [
      dom({ tag: "div", text: "" }),
      dom({ tag: "span", text: "x", isVisible: false }),
      dom({ tag: "p" }),
    ];
    for (const el of samples) {
      assert.ok(scorer.scoreElement(el).score >= 0);
    }
  });

  it("is deterministic", () => {
    const el = dom({ tag: "button", text: "Checkout" });
    assert.deepEqual(scorer.scoreElement(el), scorer.scoreElement(el));
  });
});

describe("HeuristicScorer.scoreElements", () => {
  const scorer = new HeuristicScorer();

  function highIntent(overrides = {}) {
    return {
      path: "body > button",
      tag: "button",
      locator: "#x",
      text: "Click",
      intentScore: 0,
      intentReasons: [],
      attributes: {},
      ...overrides,
    };
  }

  it("drops elements below the minimum threshold of 25", () => {
    const scored = scorer.scoreElements([
      highIntent({ tag: "button", text: "Checkout", locator: "#checkout" }),
      highIntent({ tag: "p", text: "Lorem ipsum", locator: "p" }),
    ]);

    assert.ok(scored.every((el) => el.intentScore >= 25));
    assert.ok(!scored.some((el) => el.locator === "p"), "inert text should be dropped");
  });

  it("returns results sorted by descending score", () => {
    const scored = scorer.scoreElements([
      highIntent({ tag: "a", text: "About", locator: "#about" }),
      highIntent({ tag: "button", text: "Checkout", locator: "#checkout", attributes: { type: "submit" } }),
      highIntent({ tag: "input", text: "Password", locator: "#pw", attributes: { type: "password" } }),
    ]);

    const scores = scored.map((el) => el.intentScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it("overwrites the incoming intent score rather than trusting it", () => {
    const [scored] = scorer.scoreElements([
      highIntent({ tag: "button", text: "Checkout", locator: "#c", intentScore: 999 }),
    ]);

    assert.notEqual(scored.intentScore, 999);
    assert.ok(scored.intentScore <= 100);
  });

  it("preserves the locator and tag of each element", () => {
    const scored = scorer.scoreElements([
      highIntent({ tag: "button", text: "Checkout", locator: "#checkout" }),
    ]);

    assert.equal(scored[0].locator, "#checkout");
    assert.equal(scored[0].tag, "button");
  });

  it("handles an empty list", () => {
    assert.deepEqual(scorer.scoreElements([]), []);
  });

  it("attaches reasons to every surviving element", () => {
    const scored = scorer.scoreElements([
      highIntent({ tag: "button", text: "Checkout", locator: "#checkout" }),
      highIntent({ tag: "input", text: "Email", locator: "#email", attributes: { type: "email" } }),
    ]);

    for (const el of scored) {
      assert.ok(el.intentReasons.length > 0, `${el.locator} has no reasons`);
    }
  });
});

describe("HeuristicScorer.getExplanation", () => {
  it("documents the scoring model", () => {
    const text = HeuristicScorer.getExplanation();
    assert.ok(typeof text === "string" && text.length > 0);
  });
});
