import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { WorkflowDetector } from "../../build/workflow-detector.js";

function element(overrides = {}) {
  return {
    path: "body > input",
    tag: "input",
    locator: "#field",
    intentScore: 80,
    intentReasons: ["input"],
    ...overrides,
  };
}

function page(url, elements = []) {
  return {
    url,
    title: url,
    timestamp: 1,
    highIntentElements: elements,
    consoleLogs: [],
  };
}

function session(pages) {
  return {
    sessionId: "s1",
    startUrl: pages[0]?.url ?? "https://shop.test/",
    pages,
    metadata: {
      startTime: 0,
      totalPages: pages.length,
      totalElementsAnalyzed: pages.length,
      totalHighIntentElements: pages.reduce((n, p) => n + p.highIntentElements.length, 0),
    },
    sessionState: {},
    workflows: [],
  };
}

const loginPage = page("https://shop.test/login", [
  element({ tag: "input", locator: "#username", text: "Username", attributes: { type: "text", name: "username" } }),
  element({ tag: "input", locator: "#password", text: "Password", attributes: { type: "password", name: "password" } }),
  element({ tag: "button", locator: "#login-submit", text: "Sign In", attributes: { type: "submit" } }),
]);

beforeEach(() => {
  WorkflowDetector.clearCache();
});

describe("WorkflowDetector.detect", () => {
  it("returns an array for a single-page session", () => {
    const result = WorkflowDetector.detect(session([page("https://shop.test/")]));
    assert.ok(Array.isArray(result));
  });

  it("returns an empty array for a session with no pages", () => {
    assert.deepEqual(WorkflowDetector.detect(session([])), []);
  });

  it("survives a malformed session instead of throwing", () => {
    assert.doesNotThrow(() => WorkflowDetector.detect(null));
    assert.doesNotThrow(() => WorkflowDetector.detect({}));
    assert.doesNotThrow(() => WorkflowDetector.detect({ pages: null }));
  });

  it("gives every detected workflow a well-formed shape", () => {
    const workflows = WorkflowDetector.detect(
      session([
        page("https://shop.test/"),
        loginPage,
        page("https://shop.test/dashboard"),
      ])
    );

    for (const wf of workflows) {
      assert.ok(wf.id, "workflow needs an id");
      assert.ok(wf.name, "workflow needs a name");
      assert.ok(Array.isArray(wf.pageSequence));
      assert.ok(Array.isArray(wf.actionSequence));
      assert.ok(Array.isArray(wf.stateTransitions));
      assert.ok(Array.isArray(wf.tags));
      assert.ok(
        wf.confidence >= 0 && wf.confidence <= 100,
        `confidence ${wf.confidence} out of range`
      );
    }
  });

  it("only references pages that were actually in the session", () => {
    const urls = new Set([
      "https://shop.test/",
      "https://shop.test/login",
      "https://shop.test/dashboard",
    ]);
    const workflows = WorkflowDetector.detect(
      session([page("https://shop.test/"), loginPage, page("https://shop.test/dashboard")])
    );

    for (const wf of workflows) {
      for (const url of wf.pageSequence) {
        assert.ok(urls.has(url), `workflow cites a page not in the session: ${url}`);
      }
    }
  });

  it("accepts each documented strategy", () => {
    const s = session([page("https://shop.test/"), loginPage]);
    for (const strategy of ["heuristic", "ml-based", "both"]) {
      assert.doesNotThrow(
        () => WorkflowDetector.detect(s, strategy, false),
        `strategy ${strategy} threw`
      );
    }
  });
});

describe("WorkflowDetector caching", () => {
  it("starts with an empty cache", () => {
    assert.equal(WorkflowDetector.getCacheStats().size, 0);
  });

  it("populates the cache when caching is enabled", () => {
    WorkflowDetector.detect(session([page("https://shop.test/"), loginPage]), "both", true);
    assert.ok(WorkflowDetector.getCacheStats().size > 0);
  });

  it("does not populate the cache when caching is disabled", () => {
    WorkflowDetector.detect(session([page("https://shop.test/"), loginPage]), "both", false);
    assert.equal(WorkflowDetector.getCacheStats().size, 0);
  });

  it("returns the same result from cache on a repeat call", () => {
    const s = session([page("https://shop.test/"), loginPage]);
    const first = WorkflowDetector.detect(s, "both", true);
    const second = WorkflowDetector.detect(s, "both", true);

    assert.deepEqual(second, first);
    assert.equal(WorkflowDetector.getCacheStats().size, 1, "same session should reuse one entry");
  });

  it("keys the cache per distinct page sequence", () => {
    WorkflowDetector.detect(session([page("https://shop.test/a")]), "both", true);
    WorkflowDetector.detect(session([page("https://shop.test/b")]), "both", true);

    assert.equal(WorkflowDetector.getCacheStats().size, 2);
  });

  it("clearCache empties the cache", () => {
    WorkflowDetector.detect(session([page("https://shop.test/"), loginPage]), "both", true);
    WorkflowDetector.clearCache();
    assert.equal(WorkflowDetector.getCacheStats().size, 0);
  });
});

describe("WorkflowDetector.isLoginFormPage", () => {
  it("recognises a login page by its fields", () => {
    const result = WorkflowDetector.isLoginFormPage(loginPage);

    assert.equal(result.isLoginPage, true);
    assert.equal(result.hasUsernameField, true);
    assert.equal(result.hasPasswordField, true);
    assert.equal(result.hasSubmitButton, true);
    assert.ok(result.confidence > 0);
  });

  it("does not mistake a product page for a login page", () => {
    const product = page("https://shop.test/products/1", [
      element({ tag: "button", locator: "#add-to-cart-1", text: "Add to Cart" }),
      element({ tag: "select", locator: "#color", text: "Color" }),
    ]);

    assert.equal(WorkflowDetector.isLoginFormPage(product).isLoginPage, false);
  });

  it("returns a zero-confidence negative for a malformed page", () => {
    for (const bad of [null, {}, { url: "x" }, { url: "x", highIntentElements: null }]) {
      const result = WorkflowDetector.isLoginFormPage(bad);
      assert.equal(result.isLoginPage, false);
      assert.equal(result.confidence, 0);
    }
  });

  it("handles a page with no elements", () => {
    const result = WorkflowDetector.isLoginFormPage(page("https://shop.test/login", []));
    assert.equal(result.hasPasswordField, false);
    assert.equal(result.hasUsernameField, false);
  });

  it("reports confidence as a percentage", () => {
    const result = WorkflowDetector.isLoginFormPage(loginPage);
    assert.ok(
      result.confidence >= 0 && result.confidence <= 100,
      `confidence ${result.confidence} is not a percentage`
    );
  });
});
