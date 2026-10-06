/**
 * Asserted replacement for the phase3/phase4/phase6 detector scripts.
 *
 * Those scripts printed "Workflows detected: N" and recorded PASS when N > 0,
 * which could not tell a correct detection from a wrong one. These tests name
 * the workflow they expect each fixture to produce.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  WorkflowDetector,
  WORKFLOW_PATTERNS,
} from "../../build/advanced-workflow-detector.js";
import {
  deleteConfirmPage,
  ecommerceProductPage,
  largePage,
  multiStepCheckoutPage,
  searchResultsPage,
  spaAuthPage,
} from "../fixtures/pages.js";

const detector = new WorkflowDetector();

/** Names of workflows detected on a page. */
function typesFor(elements) {
  return detector.detectWorkflows(elements).map((w) => w.workflowType);
}

describe("WorkflowDetector pattern recognition", () => {
  it("recognises authentication on an SPA login page", () => {
    const types = typesFor(spaAuthPage);
    assert.ok(
      types.includes("LOGIN"),
      `expected LOGIN, got ${JSON.stringify(types)}`
    );
  });

  it("recognises product browsing on an e-commerce product page", () => {
    const types = typesFor(ecommerceProductPage);
    assert.ok(
      types.includes("PRODUCT_BROWSING"),
      `expected product browsing, got ${JSON.stringify(types)}`
    );
  });

  it("recognises a purchase flow on a multi-step checkout", () => {
    const types = typesFor(multiStepCheckoutPage);
    assert.ok(
      types.includes("CHECKOUT"),
      `expected checkout, got ${JSON.stringify(types)}`
    );
  });

  it("recognises delete confirmation", () => {
    const types = typesFor(deleteConfirmPage);
    assert.ok(
      types.includes("DELETE_CONFIRM"),
      `expected delete confirmation, got ${JSON.stringify(types)}`
    );
  });

  it("recognises search", () => {
    const types = typesFor(searchResultsPage);
    assert.ok(
      types.includes("SEARCH"),
      `expected search, got ${JSON.stringify(types)}`
    );
  });

  it("does not claim a login flow on a page with no credential fields", () => {
    const types = typesFor(ecommerceProductPage);
    assert.ok(
      !types.includes("LOGIN"),
      "product page should not look like authentication"
    );
  });

  it("does not claim a checkout flow on a bare search page", () => {
    const types = typesFor(searchResultsPage);
    assert.ok(
      !types.includes("CHECKOUT"),
      `search page should not look like checkout, got ${JSON.stringify(types)}`
    );
  });

  it("only ever reports workflow types that exist in WORKFLOW_PATTERNS", () => {
    const known = new Set(Object.keys(WORKFLOW_PATTERNS));
    const pages = [
      spaAuthPage,
      ecommerceProductPage,
      multiStepCheckoutPage,
      deleteConfirmPage,
      searchResultsPage,
    ];

    for (const type of pages.flatMap(typesFor)) {
      assert.ok(known.has(type), `unknown workflow type reported: ${type}`);
    }
  });

  it("reports the confidence declared for each pattern", () => {
    for (const workflow of detector.detectWorkflows(spaAuthPage)) {
      assert.equal(
        workflow.confidence,
        WORKFLOW_PATTERNS[workflow.workflowType].confidence,
        `confidence drifted from the declared value for ${workflow.workflowType}`
      );
    }
  });

  it("finds nothing in an empty page", () => {
    assert.deepEqual(detector.detectWorkflows([]), []);
  });

  it("finds nothing in a page of inert text", () => {
    const inert = [
      { path: "p", tag: "p", locator: "p", text: "Lorem ipsum", intentScore: 5, intentReasons: [] },
      { path: "h2", tag: "h2", locator: "h2", text: "About us", intentScore: 8, intentReasons: [] },
    ];
    assert.deepEqual(detector.detectWorkflows(inert), []);
  });
});

describe("WorkflowDetector result shape", () => {
  it("reports confidence in the unit interval with supporting steps", () => {
    for (const workflow of detector.detectWorkflows(spaAuthPage)) {
      assert.ok(
        workflow.confidence > 0 && workflow.confidence <= 1,
        `confidence ${workflow.confidence} outside (0,1] for ${workflow.workflowType}`
      );
      assert.ok(workflow.description, "workflow needs a description");
      assert.ok(Array.isArray(workflow.steps), "workflow needs steps");
      assert.ok(workflow.steps.length > 0, "workflow needs at least one step");
      assert.ok(workflow.estimatedPages >= 1, "estimatedPages should be at least 1");
    }
  });

  it("only cites steps that came from the input", () => {
    const locators = new Set(spaAuthPage.map((e) => e.locator));
    for (const workflow of detector.detectWorkflows(spaAuthPage)) {
      for (const step of workflow.steps) {
        assert.ok(locators.has(step.locator), `invented step ${step.locator}`);
      }
    }
  });

  it("is deterministic", () => {
    assert.deepEqual(typesFor(spaAuthPage), typesFor(spaAuthPage));
  });
});

describe("WorkflowDetector navigation chains", () => {
  it("picks up navigating links on the SPA page", () => {
    const chains = detector.detectNavigationChains(spaAuthPage);
    assert.ok(chains.length >= 2, `expected navigation links, got ${chains.length}`);
  });

  it("returns nothing when no element navigates", () => {
    assert.deepEqual(detector.detectNavigationChains(deleteConfirmPage), []);
  });
});

describe("WorkflowDetector form state transitions", () => {
  it("tracks the fields of a multi-step checkout", () => {
    const transitions = detector.analyzeFormStateTransitions(multiStepCheckoutPage);
    assert.ok(
      transitions.length > 0,
      "expected form state transitions for a checkout form"
    );
  });
});

describe("WorkflowDetector scaling", () => {
  it("handles a 1000-element page without throwing", () => {
    assert.doesNotThrow(() => detector.detectWorkflows(largePage(1000)));
  });

  it("stays roughly linear from 250 to 1000 elements", () => {
    const time = (n) => {
      const page = largePage(n);
      const start = process.hrtime.bigint();
      detector.detectWorkflows(page);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };

    time(250); // warm up
    const small = Math.max(time(250), 0.5);
    const large = time(1000);

    // 4x the input should not cost more than 20x the time. Loose on purpose:
    // this catches accidental quadratic blowup, not small regressions.
    assert.ok(
      large < small * 20,
      `1000 elements took ${large.toFixed(1)}ms vs ${small.toFixed(1)}ms for 250`
    );
  });
});

// ===========================================================================
// Per-rule branch coverage
//
// The suite above reached 96% of lines but only 59% of branches: it walked
// every function while leaving most individual decisions untaken. These are
// the decisions — one case per branch, each with the opposing case — for the
// classifiers that turn an element into a navigation type, a field type, a
// validation list and a page estimate.
// ===========================================================================

function el(overrides = {}) {
  return {
    path: "body > input",
    tag: "input",
    locator: "#f",
    intentScore: 70,
    intentReasons: [],
    ...overrides,
  };
}

describe("WorkflowDetector: navigation classification", () => {
  function chainFor(overrides) {
    return detector.detectNavigationChains([el({ navigates: true, ...overrides })])[0];
  }

  it("calls an absolute http target external", () => {
    assert.equal(chainFor({ navigationTarget: "https://other.test/x" }).type, "external");
  });

  it("calls a relative target internal", () => {
    assert.equal(chainFor({ navigationTarget: "/cart" }).type, "internal");
  });

  it("calls a navigating element with no target a modal", () => {
    assert.equal(chainFor({}).type, "modal");
    assert.equal(chainFor({ navigationTarget: "" }).type, "modal");
  });

  it("carries the target through onto the chain", () => {
    assert.equal(chainFor({ navigationTarget: "/cart" }).target, "/cart");
  });

  it("ignores elements that do not navigate", () => {
    assert.deepEqual(detector.detectNavigationChains([el({ navigates: false })]), []);
  });
});

describe("WorkflowDetector: navigation confidence", () => {
  function confidenceFor(overrides) {
    return detector.detectNavigationChains([el({ navigates: true, ...overrides })])[0]
      .confidence;
  }

  it("starts at 0.5 for a bare navigating element", () => {
    assert.equal(confidenceFor({}), 0.5);
  });

  it("adds 0.2 for an explicit target", () => {
    assert.equal(confidenceFor({ navigationTarget: "/next" }), 0.7);
  });

  it("adds 0.1 for an aria-label saying next", () => {
    assert.equal(confidenceFor({ ariaLabel: "Next page" }), 0.6);
  });

  it("adds 0.1 for text saying continue", () => {
    assert.equal(confidenceFor({ text: "Continue" }), 0.6);
  });

  it("adds 0.05 for a next or continue class", () => {
    assert.equal(confidenceFor({ classes: ["btn-next"] }), 0.55);
    assert.equal(confidenceFor({ classes: ["continue-link"] }), 0.55);
  });

  it("accumulates every signal", () => {
    const confidence = confidenceFor({
      navigationTarget: "/next",
      ariaLabel: "Next page",
      text: "Continue",
      classes: ["btn-next"],
    });
    assert.ok(Math.abs(confidence - 0.95) < 1e-9, `got ${confidence}`);
  });

  it("caps confidence at 0.95", () => {
    const confidence = confidenceFor({
      navigationTarget: "https://x.test/next",
      ariaLabel: "next next",
      text: "continue continue",
      classes: ["next", "continue"],
    });
    assert.ok(confidence <= 0.95, `got ${confidence}`);
  });

  it("is case insensitive about the wording", () => {
    assert.equal(confidenceFor({ ariaLabel: "NEXT" }), 0.6);
    assert.equal(confidenceFor({ text: "CONTINUE" }), 0.6);
  });

  it("does not credit unrelated wording", () => {
    assert.equal(confidenceFor({ ariaLabel: "Back", text: "Back", classes: ["prev"] }), 0.5);
  });
});

describe("WorkflowDetector: form field classification", () => {
  function fieldTypeFor(overrides) {
    return detector.analyzeFormStateTransitions([el(overrides)])[0].fieldType;
  }

  it("classifies by input type first", () => {
    assert.equal(fieldTypeFor({ attributes: { type: "email" } }), "email");
    assert.equal(fieldTypeFor({ attributes: { type: "password" } }), "password");
    assert.equal(fieldTypeFor({ attributes: { type: "checkbox" } }), "checkbox");
    assert.equal(fieldTypeFor({ attributes: { type: "text" } }), "text");
  });

  it("falls back to wording when there is no type", () => {
    assert.equal(fieldTypeFor({ text: "Email address" }), "email");
    assert.equal(fieldTypeFor({ text: "Password" }), "password");
    assert.equal(fieldTypeFor({ text: "I agree to the terms" }), "checkbox");
  });

  it("reads the aria-label when there is no text", () => {
    assert.equal(fieldTypeFor({ ariaLabel: "Email" }), "email");
  });

  it("is case insensitive about the type attribute", () => {
    assert.equal(fieldTypeFor({ attributes: { type: "EMAIL" } }), "email");
  });

  it("treats an untyped input as text", () => {
    assert.equal(fieldTypeFor({ tag: "input" }), "text");
  });

  it("ranks email above password when both words appear", () => {
    assert.equal(fieldTypeFor({ text: "email and password" }), "email");
  });

  // analyzeFormStateTransitions only looks at input and form tags, so a
  // <select> never reaches the classifier through the public method — the
  // 'select' branch is unreachable in practice.
  it("only considers input and form elements", () => {
    assert.deepEqual(detector.analyzeFormStateTransitions([el({ tag: "select" })]), []);
    assert.deepEqual(detector.analyzeFormStateTransitions([el({ tag: "button" })]), []);
  });

  it("classifies a form element as other when nothing else matches", () => {
    assert.equal(fieldTypeFor({ tag: "form", text: "Contact us" }), "other");
  });
});

describe("WorkflowDetector: validation detection", () => {
  function validationFor(overrides) {
    return detector.analyzeFormStateTransitions([el(overrides)])[0].validation;
  }

  it("reports no validation for a bare field", () => {
    assert.deepEqual(validationFor({}), []);
  });

  it("detects each supported attribute", () => {
    assert.deepEqual(validationFor({ attributes: { required: "" } }), ["required"]);
    assert.deepEqual(validationFor({ attributes: { pattern: "\\d+" } }), ["pattern"]);
    assert.deepEqual(validationFor({ attributes: { minlength: "3" } }), ["minlength"]);
    assert.deepEqual(validationFor({ attributes: { maxlength: "9" } }), ["maxlength"]);
  });

  it("detects a required aria-label", () => {
    assert.deepEqual(validationFor({ ariaLabel: "Name (required)" }), ["aria-required"]);
  });

  it("reports several validations in declaration order", () => {
    assert.deepEqual(
      validationFor({
        ariaLabel: "required",
        attributes: { required: "", pattern: "x", minlength: "1", maxlength: "2" },
      }),
      ["required", "pattern", "minlength", "maxlength", "aria-required"]
    );
  });

  it("marks a field required from its aria-label", () => {
    const [state] = detector.analyzeFormStateTransitions([
      el({ ariaLabel: "Email (required)" }),
    ]);
    assert.equal(state.required, true);
  });

  it("marks a field not required when the label says nothing", () => {
    const [state] = detector.analyzeFormStateTransitions([el({ ariaLabel: "Email" })]);
    assert.equal(state.required, false);
  });

  it("treats a missing aria-label as not required", () => {
    assert.equal(detector.analyzeFormStateTransitions([el({})])[0].required, false);
  });
});

describe("WorkflowDetector: form state sequencing", () => {
  it("returns a single state for a single field", () => {
    const states = detector.analyzeFormStateTransitions([el({ text: "Name" })]);
    assert.equal(states.length, 1);
    assert.equal(states[0].sequence, 1);
  });

  it("opens a new state at a next or continue control", () => {
    const states = detector.analyzeFormStateTransitions([
      el({ text: "Name" }),
      el({ text: "Continue" }),
      el({ text: "Card number" }),
    ]);

    assert.equal(states.length, 2, "one state per step");
    assert.equal(states[0].sequence, 1);
    assert.equal(states[1].sequence, 2);
  });

  it("does not open a new state for an ordinary field", () => {
    const states = detector.analyzeFormStateTransitions([
      el({ text: "First name" }),
      el({ text: "Last name" }),
    ]);
    assert.equal(states.length, 1);
  });

  it("returns nothing for a page with no form fields", () => {
    assert.deepEqual(detector.analyzeFormStateTransitions([]), []);
    assert.deepEqual(detector.analyzeFormStateTransitions([el({ tag: "a" })]), []);
  });

  it("recognises both next and continue as step boundaries", () => {
    for (const word of ["Next", "Continue"]) {
      const states = detector.analyzeFormStateTransitions([
        el({ text: "Name" }),
        el({ text: word }),
      ]);
      assert.equal(states.length, 2, `"${word}" should start a step`);
    }
  });
});

describe("WorkflowDetector: pattern matching rules", () => {
  it("requires every signature term to be present", () => {
    // LOGIN needs email-or-username, password, and a login verb.
    const partial = [el({ text: "Email" }), el({ text: "Password" })];
    assert.ok(!typesFor(partial).includes("LOGIN"), "missing the verb");

    const complete = [...partial, el({ tag: "button", text: "Sign in" })];
    assert.ok(typesFor(complete).includes("LOGIN"));
  });

  it("accepts either side of an OR term", () => {
    const byEmail = [
      el({ text: "Email" }),
      el({ text: "Password" }),
      el({ text: "Login" }),
    ];
    const byUsername = [
      el({ text: "Username" }),
      el({ text: "Password" }),
      el({ text: "Login" }),
    ];

    assert.ok(typesFor(byEmail).includes("LOGIN"));
    assert.ok(typesFor(byUsername).includes("LOGIN"));
  });

  it("matches on aria-label as well as text", () => {
    const elements = [
      el({ ariaLabel: "Email" }),
      el({ ariaLabel: "Password" }),
      el({ tag: "button", ariaLabel: "Sign in" }),
    ];
    assert.ok(typesFor(elements).includes("LOGIN"));
  });

  it("is case insensitive", () => {
    const elements = [
      el({ text: "EMAIL" }),
      el({ text: "PASSWORD" }),
      el({ text: "LOGIN" }),
    ];
    assert.ok(typesFor(elements).includes("LOGIN"));
  });

  it("reports nothing when the element list is empty", () => {
    assert.deepEqual(detector.detectWorkflows([]), []);
  });

  it("sorts results by descending confidence", () => {
    const confidences = detector
      .detectWorkflows(multiStepCheckoutPage)
      .map((w) => w.confidence);
    assert.deepEqual(confidences, [...confidences].sort((a, b) => b - a));
  });
});

describe("WorkflowDetector: page count estimation", () => {
  function pagesFor(elements) {
    const [result] = detector.detectWorkflows(elements);
    return result?.estimatedPages;
  }

  it("counts one page for a form with no navigation", () => {
    const elements = [
      el({ text: "Email" }),
      el({ text: "Password" }),
      el({ tag: "span", text: "Login" }),
    ];
    assert.equal(pagesFor(elements), 1);
  });

  it("adds a page for the submit step", () => {
    const elements = [
      el({ text: "Email" }),
      el({ text: "Password" }),
      el({ tag: "button", text: "Login" }),
    ];
    assert.equal(pagesFor(elements), 2);
  });

  it("adds a page per navigating element", () => {
    const elements = [
      el({ text: "Email" }),
      el({ text: "Password" }),
      el({ tag: "a", text: "Login", navigates: true, navigationTarget: "/in" }),
    ];
    assert.equal(pagesFor(elements), 2, "one nav element, no submit button");
  });
});
