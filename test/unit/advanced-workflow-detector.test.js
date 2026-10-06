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
