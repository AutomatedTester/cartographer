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

// ===========================================================================
// The rest of the selector ladder, and keyword scoring.
//
// generateSelector picks between seven strategies in a fixed order, and only
// the first two were covered. The ones below it are what gets emitted for the
// majority of real elements — a selector that looks plausible but matches
// nothing is worse than no selector, because it is reported with confidence.
// ===========================================================================

describe("LocatorGenerator: the selector ladder", () => {
  const generator = new LocatorGenerator();

  /** Locator for a single element, described so it is certain to match. */
  function locatorFor(overrides, description = "submit") {
    return muted(() => generator.generateLocator(description, [dom(overrides)]));
  }

  it("prefers aria-label over text", () => {
    const result = locatorFor({ ariaLabel: "Submit the form", text: "Submit" });

    assert.equal(result.type, "xpath");
    assert.equal(result.selector, '//button[@aria-label="Submit the form"]');
    assert.equal(result.confidence, 0.85);
  });

  it("matches short text exactly", () => {
    const result = locatorFor({ text: "Submit" });

    assert.equal(result.type, "xpath");
    assert.equal(result.selector, '//button[text()="Submit"]');
    assert.equal(result.confidence, 0.9);
  });

  // 30 characters is the cut-off between an exact and a contains() match.
  it("switches to a partial text match at 30 characters", () => {
    const long = "Submit this unusually long button label";
    const result = locatorFor({ text: long });

    assert.equal(result.selector, '//button[contains(text(), "Submit this unusuall")]');
    assert.equal(result.confidence, 0.75);
    assert.match(result.reason, /partial text/);
  });

  it("treats a 29-character label as short", () => {
    const text = "Submit" + "x".repeat(23);
    assert.equal(text.length, 29);
    assert.match(locatorFor({ text }).selector, /text\(\)=/);
  });

  // A `name` attribute is not something calculateScore looks at, so the
  // element needs a scoreable hook (here a class) to be a candidate at all.
  // The class is deliberately lower in the ladder than the input type, so it
  // decides matching without deciding the selector.
  it("falls back to input type with a name", () => {
    const result = locatorFor(
      {
        tag: "input",
        text: "",
        classes: ["login"],
        attributes: { type: "email", name: "login" },
      },
      "login"
    );

    assert.equal(result.selector, 'input[type="email"][name="login"]');
    assert.equal(result.type, "css");
    assert.equal(result.confidence, 0.7);
  });

  it("uses a placeholder when the input has no name", () => {
    const result = locatorFor(
      { tag: "input", text: "", attributes: { type: "email", placeholder: "your login" } },
      "login"
    );

    assert.equal(result.selector, 'input[type="email"][placeholder*="your login"]');
  });

  it("uses the bare input type when there is neither name nor placeholder", () => {
    const result = locatorFor(
      { tag: "input", text: "", classes: ["login"], attributes: { type: "email" } },
      "login"
    );

    assert.equal(result.selector, 'input[type="email"]');
  });

  it("falls back to tag and classes", () => {
    const result = locatorFor(
      { tag: "button", text: "", classes: ["btn", "btn-login"] },
      "login"
    );

    assert.equal(result.selector, "button.btn.btn-login");
    assert.equal(result.confidence, 0.6);
  });

  // Placeholder is the one thing calculateScore reads that generateSelector
  // has no strategy for on its own, so it is the only way to reach the bottom
  // of the ladder: the element matches, but carries nothing selectable.
  it("falls back to the bare tag as a last resort", () => {
    const result = locatorFor(
      { tag: "button", text: "", id: "", classes: [], attributes: { placeholder: "login" } },
      "login"
    );

    assert.equal(result.selector, "button");
    assert.equal(result.confidence, 0.3);
    assert.match(result.reason, /low specificity/);
  });

  it("orders the ladder: id beats testid beats aria beats text", () => {
    const all = {
      id: "the-id",
      ariaLabel: "the aria",
      text: "submit",
      attributes: { "data-testid": "the-testid" },
    };
    assert.match(locatorFor(all).selector, /^#the-id$/);

    const { id, ...noId } = all;
    assert.match(locatorFor(noId).selector, /data-testid/);

    const { attributes, ...noTestId } = noId;
    assert.match(locatorFor({ ...noTestId, attributes: {} }).selector, /@aria-label/);
  });
});

describe("LocatorGenerator: escaping", () => {
  const generator = new LocatorGenerator();

  // A double quote inside an XPath string literal would terminate the literal
  // and produce a syntactically invalid expression, which fails at the driver
  // rather than at generation time.
  it("neutralises a double quote in aria-label", () => {
    const result = muted(() =>
      generator.generateLocator("submit", [
        dom({ ariaLabel: 'Submit "now"', text: "submit" }),
      ])
    );

    assert.equal(result.selector, "//button[@aria-label=\"Submit 'now'\"]");
    assert.equal(
      result.selector.split('"').length - 1,
      2,
      "exactly one pair of delimiting quotes, or the xpath will not parse"
    );
  });

  it("neutralises a double quote in text", () => {
    const result = muted(() =>
      generator.generateLocator("said", [dom({ text: 'He said "go"', id: "" })])
    );

    assert.equal(result.selector, "//button[text()=\"He said 'go'\"]");
    assert.equal(result.selector.split('"').length - 1, 2);
  });

  it("escapes css-significant characters in an id", () => {
    const result = muted(() =>
      generator.generateLocator("submit", [dom({ id: "form:submit.btn", text: "submit" })])
    );

    assert.equal(result.selector, "#form\\:submit\\.btn");
  });

  it("leaves a plain id untouched", () => {
    const result = muted(() =>
      generator.generateLocator("submit", [dom({ id: "submit-btn", text: "submit" })])
    );

    assert.equal(result.selector, "#submit-btn");
  });
});

describe("LocatorGenerator: keyword matching", () => {
  const generator = new LocatorGenerator();

  function best(description, elements) {
    return muted(() => generator.generateLocator(description, elements));
  }

  it("discards stop words and short tokens", () => {
    const result = best("the a of in", [dom({ text: "Submit" })]);
    assert.equal(result.confidence, 0);
    assert.match(result.reason, /No searchable keywords/);
  });

  it("ignores punctuation when extracting keywords", () => {
    const result = best("the 'submit' button!", [dom({ id: "submit", text: "Submit" })]);
    assert.equal(result.selector, "#submit");
  });

  it("is case insensitive", () => {
    const result = best("SUBMIT", [dom({ id: "submit", text: "Submit" })]);
    assert.equal(result.selector, "#submit");
  });

  it("scores a text match above a class match", () => {
    const result = best("checkout", [
      dom({ tag: "div", text: "", classes: ["checkout"], id: "by-class" }),
      dom({ tag: "button", text: "Checkout", id: "by-text" }),
    ]);

    assert.equal(result.selector, "#by-text");
  });

  it("matches on placeholder text", () => {
    const result = best("email address", [
      dom({ tag: "input", text: "", id: "field", attributes: { placeholder: "Email address" } }),
    ]);

    assert.equal(result.selector, "#field");
  });

  it("matches on aria-label when there is no text", () => {
    const result = best("close dialog", [
      dom({ tag: "button", text: "", ariaLabel: "Close dialog", id: "x" }),
    ]);

    assert.equal(result.selector, "#x");
  });

  it("accumulates score across several matching keywords", () => {
    const result = best("submit login form", [
      dom({ tag: "button", text: "Submit", id: "one-hit" }),
      dom({ tag: "button", text: "Submit login", id: "two-hits" }),
    ]);

    assert.equal(result.selector, "#two-hits");
  });

  // Without this, every visible element scored above zero and an unrelated
  // description came back with a confident-looking selector for the wrong
  // element — far worse than admitting no match.
  it("refuses to match an element no keyword touched", () => {
    const result = best("nonexistent widget", [
      dom({ tag: "button", text: "Submit", id: "submit", attributes: { "data-testid": "s" } }),
    ]);

    assert.equal(result.confidence, 0);
    assert.equal(result.selector, "*");
  });

  it("prefers a visible element over a hidden one with the same text", () => {
    const result = best("submit", [
      dom({ text: "Submit", id: "hidden", isVisible: false }),
      dom({ text: "Submit", id: "shown", isVisible: true }),
    ]);

    assert.equal(result.selector, "#shown");
  });

  it("prefers an element carrying a test id when scores otherwise tie", () => {
    const result = best("submit", [
      dom({ text: "Submit", id: "plain" }),
      dom({ text: "Submit", id: "hooked", attributes: { "data-testid": "submit" } }),
    ]);

    assert.equal(result.selector, "#hooked");
  });
});

// ===========================================================================
// HeuristicScorer: one test per rule
//
// The suite above reached 97% of lines but 90% of branches, and the dark
// branches were the individual scoring rules — the arms of the `if` ladder
// that each add a specific number of points. Those numbers *are* the product:
// they decide which elements get reported and in what order, and a regression
// in one of them changes every recommendation the tool makes without failing
// anything.
//
// Each rule is asserted through the reason string it emits, because that is
// what a user is shown as justification, and through the exact point value,
// because that is what orders the output.
// ===========================================================================

describe("HeuristicScorer: tag rules", () => {
  const scorer = new HeuristicScorer();

  // Four-character text scores no label bonus and matches no text pattern, so
  // the tag score is the whole score.
  const inert = { text: "wxyz", isVisible: true, attributes: {} };

  const tagScores = [
    ["button", 50],
    ["input", 45],
    ["select", 45],
    ["a", 40],
    ["textarea", 40],
    ["form", 35],
  ];

  for (const [tag, points] of tagScores) {
    it(`scores a <${tag}> at ${points}`, () => {
      const { score, reasons } = scorer.scoreElement({ ...inert, tag });
      assert.equal(score, points);
      assert.ok(reasons.includes(`${tag} element (+${points})`), `${reasons}`);
    });
  }

  it("scores an unrecognised tag at zero", () => {
    assert.equal(scorer.scoreElement({ ...inert, tag: "div" }).score, 0);
    assert.equal(scorer.scoreElement({ ...inert, tag: "span" }).score, 0);
  });
});

describe("HeuristicScorer: text pattern rules", () => {
  const scorer = new HeuristicScorer();

  /** Score a tagless element carrying only `text`. */
  function rulesFor(text) {
    return scorer.scoreElement({ tag: "div", text, isVisible: true, attributes: {} });
  }

  const destructive = [
    "delete",
    "remove",
    "destroy",
    "uninstall",
    "cancel",
    "abort",
    "reset",
    "confirm deletion",
    "are you sure",
    "permanent",
    "irreversible",
    "cannot be undone",
    "close account",
    "deactivate",
  ];

  for (const text of destructive) {
    it(`treats "${text}" as a destructive action`, () => {
      assert.ok(
        rulesFor(text).reasons.includes("Destructive action (+35)"),
        `"${text}" should score as destructive`
      );
    });
  }

  const submission = [
    "Submit",
    "Save",
    "Confirm",
    "Send",
    "Publish",
    "Sign in",
    "Login",
    "Log in",
    "Authenticate",
    "Signin",
    "Checkout",
    "Purchase",
    "Buy",
    "Place order",
    "Pay",
    "Create account",
    "Register",
    "Signup",
    "Sign up",
    "Subscribe",
    "Join",
    "Enroll",
  ];

  for (const text of submission) {
    it(`treats "${text}" as a form submission`, () => {
      assert.ok(
        rulesFor(text).reasons.includes("Form submission (+30)"),
        `"${text}" should score as submission`
      );
    });
  }

  // The submit patterns anchor on ^...$ for the single-word verbs, so these
  // must NOT match — otherwise any sentence containing "save" scores as a
  // submission.
  it("does not treat an embedded verb as a submission", () => {
    assert.ok(!rulesFor("Save your work for later").reasons.includes("Form submission (+30)"));
    assert.ok(!rulesFor("Please confirm the details").reasons.includes("Form submission (+30)"));
  });

  for (const text of ["Search", "Filter", "Query", "Find"]) {
    it(`treats "${text}" as a search interaction`, () => {
      assert.ok(rulesFor(text).reasons.includes("Search interaction (+25)"));
    });
  }

  for (const text of ["Next", "Previous", "Back", "Forward", "Continue", "Proceed", "Home", "Back to top", "Return"]) {
    it(`treats "${text}" as a navigation control`, () => {
      assert.ok(rulesFor(text).reasons.includes("Navigation control (+20)"));
    });
  }

  const topLevel = [
    "Find a doctor",
    "Browse all",
    "Search for items",
    "Specialties",
    "Categories",
    "Doctors",
    "Services",
    "Products",
    "Features",
    "Explore",
    "Discover",
    "Shop",
    "View all",
    "Book now",
    "Schedule",
    "Reserve",
    "Compare",
    "Profile",
    "Settings",
    "My account",
    "Account",
    "Organizations",
    "Team",
    "Help",
    "FAQ",
    "Support",
    "About",
    "Contact",
    "Feedback",
    "Blog",
    "Docs",
    "Tutorial",
    "Pricing",
    "Plans",
    "Enterprise",
    "Careers",
    "Newsletter",
    "Community",
    "Resources",
  ];

  for (const text of topLevel) {
    it(`treats "${text}" as top-level navigation intent`, () => {
      assert.ok(
        rulesFor(text).reasons.includes("Top-level navigation intent (+28)"),
        `"${text}" should score as top-level nav`
      );
    });
  }

  // These patterns anchor on ^, so the word has to start the label.
  it("requires a top-level nav word to start the label", () => {
    assert.ok(
      !rulesFor("Our pricing page").reasons.includes("Top-level navigation intent (+28)")
    );
  });

  it("stacks several text rules on one element", () => {
    // 'Cancel Subscribe' is destructive (+35, 'cancel') and a submission
    // (+30, 'subscribe'), plus a good label length (+5).
    const { score, reasons } = rulesFor("Cancel Subscribe");

    assert.ok(reasons.includes("Destructive action (+35)"));
    assert.ok(reasons.includes("Form submission (+30)"));
    assert.equal(score, 70);
  });

  // 'subscription' does not contain 'subscribe', so the submission rule does
  // not fire on it. Pinned because it is exactly the kind of near-miss that
  // looks like it should match.
  it("does not treat 'subscription' as the verb 'subscribe'", () => {
    assert.ok(!rulesFor("Cancel subscription").reasons.includes("Form submission (+30)"));
  });

  it("scores wording that matches nothing at zero", () => {
    assert.equal(rulesFor("wxyz").score, 0);
  });
});

describe("HeuristicScorer: attribute rules", () => {
  const scorer = new HeuristicScorer();

  function scoreOf(overrides) {
    return scorer.scoreElement({ tag: "div", text: "wxyz", isVisible: true, attributes: {}, ...overrides });
  }

  it("adds 10 for an ARIA role", () => {
    const { score, reasons } = scoreOf({ role: "button" });
    assert.equal(score, 10);
    assert.ok(reasons.includes("ARIA role: button (+10)"));
  });

  it("adds 8 for an aria-label", () => {
    // ariaLabel is also the text fallback, so a 4-character label keeps the
    // label-length bonus out of the way.
    const { score, reasons } = scoreOf({ text: "", ariaLabel: "wxyz" });
    assert.equal(score, 8);
    assert.ok(reasons.includes("Has aria-label (+8)"));
  });

  it("adds 5 for an id", () => {
    const { score, reasons } = scoreOf({ id: "go" });
    assert.equal(score, 5);
    assert.ok(reasons.includes('Has id: "go" (+5)'));
  });

  it("adds 8 for a data-testid", () => {
    const { score, reasons } = scoreOf({ attributes: { "data-testid": "go" } });
    assert.equal(score, 8);
    assert.ok(reasons.includes("Has data-testid (+8)"));
  });

  it("adds 5 for data-qa or data-test", () => {
    assert.equal(scoreOf({ attributes: { "data-qa": "go" } }).score, 5);
    assert.equal(scoreOf({ attributes: { "data-test": "go" } }).score, 5);
  });

  it("counts data-testid and data-qa separately", () => {
    assert.equal(scoreOf({ attributes: { "data-testid": "a", "data-qa": "b" } }).score, 13);
  });

  const inputTypes = [
    ["submit", 35],
    ["button", 30],
    ["email", 25],
    ["password", 25],
    ["search", 25],
    ["text", 20],
    ["file", 20],
    ["checkbox", 15],
    ["radio", 15],
  ];

  for (const [type, points] of inputTypes) {
    it(`adds ${points} for input[type="${type}"]`, () => {
      const { score, reasons } = scoreOf({ attributes: { type } });
      assert.equal(score, points);
      assert.ok(reasons.includes(`input[type="${type}"] (+${points})`));
    });
  }

  it("adds nothing for an unscored input type", () => {
    assert.equal(scoreOf({ attributes: { type: "hidden" } }).score, 0);
  });

  it("adds 15 for a link in a navigation context", () => {
    const { score, reasons } = scoreOf({ tag: "a", path: "body nav a" });
    assert.equal(score, 40 + 15);
    assert.ok(reasons.includes("Link in navigation context (+15)"));
  });

  it("recognises a header context and a leading nav path", () => {
    assert.equal(scoreOf({ tag: "a", path: "body header a" }).score, 55);
    assert.equal(scoreOf({ tag: "a", path: "nav ul a" }).score, 55);
    assert.equal(scoreOf({ tag: "a", path: "header div a" }).score, 55);
  });

  it("does not credit navigation context to a non-link", () => {
    assert.equal(scoreOf({ tag: "button", path: "body nav button" }).score, 50);
  });

  it("does not credit a path with no navigation context", () => {
    assert.equal(scoreOf({ tag: "a", path: "body main a" }).score, 40);
  });

  it("treats a missing path as no navigation context", () => {
    assert.equal(scoreOf({ tag: "a" }).score, 40);
  });
});

describe("HeuristicScorer: label length and visibility", () => {
  const scorer = new HeuristicScorer();

  function scoreOf(overrides) {
    return scorer.scoreElement({ tag: "div", isVisible: true, attributes: {}, ...overrides });
  }

  it("adds nothing for a label under 5 characters", () => {
    assert.equal(scoreOf({ text: "OK" }).score, 0);
  });

  it("adds 5 for a label between 5 and 19 characters", () => {
    const { score, reasons } = scoreOf({ text: "Add to basket" });
    assert.equal(score, 5);
    assert.ok(reasons.includes("Good label length (+5)"));
  });

  it("adds nothing for a label of 20 characters or more", () => {
    assert.equal(scoreOf({ text: "x".repeat(20) }).score, 0);
  });

  it("treats exactly 5 characters as a good label", () => {
    assert.equal(scoreOf({ text: "wxyza" }).score, 5);
  });

  it("caps the final score at 100", () => {
    const { score } = scorer.scoreElement({
      tag: "button",
      text: "Delete my account permanently",
      ariaLabel: "Delete my account permanently",
      role: "button",
      id: "danger",
      isVisible: true,
      attributes: { type: "submit", "data-testid": "x", "data-qa": "y" },
    });
    assert.equal(score, 100);
  });

  it("never returns a score below zero", () => {
    assert.ok(scoreOf({ text: "" }).score >= 0);
  });

  it("zeroes a hidden element's tag and pattern score", () => {
    const visible = scoreOf({ tag: "button", text: "Delete" });
    const hidden = scoreOf({ tag: "button", text: "Delete", isVisible: false });

    assert.equal(visible.score, 90);
    assert.ok(hidden.score < visible.score);
    assert.ok(hidden.reasons.includes("Element not visible (score zeroed)"));
  });

  // The zeroing happens before the label-length bonus is applied, so a hidden
  // element with a 5-19 character label still scores 5 rather than 0. Below
  // the minimum threshold of 25, so it changes no outcome today — but
  // "score zeroed" is not quite what the code does.
  it("still awards the label bonus after zeroing a hidden element", () => {
    assert.equal(scoreOf({ tag: "button", text: "Delete", isVisible: false }).score, 5);
  });

  it("scores a hidden element with a short label at zero", () => {
    assert.equal(scoreOf({ tag: "button", text: "OK", isVisible: false }).score, 0);
  });

  it("only zeroes on an explicit false, not on a missing flag", () => {
    const element = { tag: "button", text: "Delete", attributes: {} };
    assert.equal(scorer.scoreElement(element).score, 90, "undefined is not hidden");
  });
});
