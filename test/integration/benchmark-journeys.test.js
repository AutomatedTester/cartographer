/**
 * Hermetic coverage built on the in-repo BenchmarkShop fixture.
 *
 * Two things are checked here, neither needing a browser:
 *   1. The fixture app still serves the pages and stable locators that
 *      benchmark/ground-truth/journeys.json promises. If the app drifts, every
 *      benchmark number computed from it is meaningless, so this guards the
 *      guard.
 *   2. JourneyInferenceEngine recovers the ground-truth journeys from a crawl
 *      session shaped like the fixture.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { JourneyInferenceEngine } from "../../build/journey-inference-engine.js";
import { loadGroundTruth, startBenchmarkApp } from "../helpers/benchmark-app.js";

const groundTruth = loadGroundTruth();

/** Every distinct path named by any ground-truth journey. */
function groundTruthPaths() {
  const paths = new Set();
  for (const journey of groundTruth.journeys) {
    for (const p of journey.pageSequence) {
      if (!p.includes(":")) paths.add(p); // skip patterns like /products/:id
    }
  }
  return [...paths].sort();
}

/** Ids referenced by the ground truth, minus templated ones. */
function stableIdsFor(group) {
  return groundTruth.stableLocators[group].filter((s) => !s.includes("{"));
}

describe("BenchmarkShop fixture integrity", () => {
  let app;

  before(async () => {
    app = await startBenchmarkApp();
  });

  after(async () => {
    await app?.stop();
  });

  it("serves every page named in the ground-truth journeys", async () => {
    const failures = [];
    for (const p of groundTruthPaths()) {
      const res = await fetch(`${app.baseUrl}${p}`, { redirect: "manual" });
      // 2xx, or a redirect for auth-gated pages like /dashboard.
      if (res.status >= 400) failures.push(`${p} -> ${res.status}`);
    }
    assert.deepEqual(failures, [], `unreachable ground-truth pages: ${failures}`);
  });

  it("renders the frozen navigation locators on the homepage", async () => {
    const html = await (await fetch(`${app.baseUrl}/`)).text();

    const missing = stableIdsFor("navigation").filter(
      (sel) => !html.includes(`id="${sel.slice(1)}"`)
    );
    assert.deepEqual(missing, [], `homepage is missing frozen ids: ${missing}`);
  });

  it("renders the frozen login-form locators", async () => {
    const html = await (await fetch(`${app.baseUrl}/login`)).text();

    // #login-error only appears after a failed attempt.
    const expected = stableIdsFor("loginForm").filter((s) => s !== "#login-error");
    const missing = expected.filter((sel) => !html.includes(`id="${sel.slice(1)}"`));
    assert.deepEqual(missing, [], `login page is missing frozen ids: ${missing}`);
  });

  it("renders the frozen product-listing locators", async () => {
    const html = await (await fetch(`${app.baseUrl}/products`)).text();

    assert.ok(html.includes('id="product-list"'), "missing #product-list");
    assert.ok(html.includes('id="product-1"'), "missing #product-1");
    assert.ok(html.includes('id="add-to-cart-1"'), "missing #add-to-cart-1");
  });

  it("accepts the documented credentials and rejects wrong ones", async () => {
    const { username, password } = groundTruth._meta.credentials;

    const good = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
      redirect: "manual",
    });
    assert.ok(
      good.status >= 300 && good.status < 400,
      `valid login should redirect, got ${good.status}`
    );

    const bad = await fetch(`${app.baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password: "wrong" }),
      redirect: "manual",
    });
    assert.equal(bad.status, 200, "invalid login should re-render the form");
    assert.ok((await bad.text()).includes('id="login-error"'), "missing #login-error");
  });

  it("gates the dashboard behind authentication", async () => {
    const res = await fetch(`${app.baseUrl}/dashboard`, { redirect: "manual" });
    assert.ok(res.status >= 300 && res.status < 400, "dashboard should redirect");
  });
});

// ---------------------------------------------------------------------------
// Journey inference against the ground truth
// ---------------------------------------------------------------------------

function element(overrides) {
  return {
    path: "body > a",
    tag: "a",
    locator: "#x",
    intentScore: 60,
    intentReasons: ["link"],
    ...overrides,
  };
}

function page(url, elements) {
  return {
    url,
    title: url,
    timestamp: 1,
    highIntentElements: elements,
    consoleLogs: [],
  };
}

/** A crawl session shaped like a real crawl of BenchmarkShop. */
function benchmarkSession(paths, extraElementsByPath = {}) {
  const base = "http://127.0.0.1:3000";
  return {
    sessionId: "test-session",
    startUrl: `${base}/`,
    pages: paths.map((p) =>
      page(`${base}${p}`, extraElementsByPath[p] ?? [
        element({ text: "Products", locator: "#nav-products", navigationTarget: "/products" }),
      ])
    ),
    metadata: {
      startTime: 0,
      totalPages: paths.length,
      totalElementsAnalyzed: paths.length * 5,
      totalHighIntentElements: paths.length,
    },
    sessionState: {},
    workflows: [],
  };
}

describe("JourneyInferenceEngine against ground truth", () => {
  it("returns nothing for an empty session rather than throwing", () => {
    assert.deepEqual(JourneyInferenceEngine.inferJourneys(benchmarkSession([])), []);
  });

  it("tolerates a malformed session", () => {
    assert.deepEqual(JourneyInferenceEngine.inferJourneys(null), []);
    assert.deepEqual(JourneyInferenceEngine.inferJourneys({}), []);
  });

  it("infers a product-browsing journey from the J3 page sequence", () => {
    const j3 = groundTruth.journeys.find((j) => j.id === "J3");
    const session = benchmarkSession(j3.pageSequence, {
      "/products": [
        element({ tag: "a", text: "Laptop Pro 15", locator: "#view-product-1" }),
        element({ tag: "button", text: "Add to Cart", locator: "#add-to-cart-1", intentScore: 90 }),
      ],
      "/cart": [
        element({ tag: "button", text: "Checkout", locator: "#checkout-btn", intentScore: 95 }),
      ],
    });

    const journeys = JourneyInferenceEngine.inferJourneys(session);

    assert.ok(journeys.length > 0, "expected at least one inferred journey");
    const tags = journeys.flatMap((j) => j.tags);
    assert.ok(
      tags.some((t) => /product|browse|discovery|shop|checkout|cart/i.test(t)),
      `expected a shopping-related journey, got tags ${JSON.stringify(tags)}`
    );
  });

  it("infers a checkout journey when cart and payment pages are present", () => {
    const session = benchmarkSession([
      "/products",
      "/cart",
      "/checkout",
      "/checkout/payment",
      "/checkout/confirm",
    ], {
      "/cart": [
        element({ tag: "button", text: "Checkout", locator: "#checkout-btn", intentScore: 95 }),
      ],
      "/checkout/payment": [
        element({ tag: "input", text: "Card Number", locator: "#cardNumber", intentScore: 85 }),
        element({ tag: "button", text: "Pay", locator: "#payment-submit", intentScore: 95 }),
      ],
    });

    const journeys = JourneyInferenceEngine.inferJourneys(session);
    const tags = journeys.flatMap((j) => j.tags).join(" ");

    assert.match(tags, /checkout|cart|purchase|shop/i);
  });

  it("infers an account journey from the J1 login sequence", () => {
    const j1 = groundTruth.journeys.find((j) => j.id === "J1");
    const session = benchmarkSession(j1.pageSequence, {
      "/login": [
        element({ tag: "input", text: "Username", locator: "#username", intentScore: 85 }),
        element({ tag: "input", text: "Password", locator: "#password", intentScore: 90 }),
        element({ tag: "button", text: "Sign In", locator: "#login-submit", intentScore: 95 }),
      ],
    });

    const journeys = JourneyInferenceEngine.inferJourneys(session);
    const tags = journeys.flatMap((j) => j.tags).join(" ");

    assert.match(tags, /account|auth|login|signin/i);
  });

  it("gives every inferred journey a well-formed shape", () => {
    const session = benchmarkSession([
      "/", "/products", "/products/1", "/cart", "/checkout", "/login", "/dashboard",
    ]);

    for (const journey of JourneyInferenceEngine.inferJourneys(session)) {
      assert.ok(journey.id, "journey needs an id");
      assert.ok(journey.name, "journey needs a name");
      assert.ok(Array.isArray(journey.pageSequence));
      assert.ok(Array.isArray(journey.tags));
      assert.ok(
        journey.confidence >= 0 && journey.confidence <= 100,
        `confidence ${journey.confidence} out of range for ${journey.name}`
      );
    }
  });

  it("is deterministic for the same session", () => {
    const paths = ["/", "/products", "/products/1", "/cart", "/checkout"];
    const first = JourneyInferenceEngine.inferJourneys(benchmarkSession(paths));
    const second = JourneyInferenceEngine.inferJourneys(benchmarkSession(paths));

    assert.deepEqual(
      first.map((j) => j.name),
      second.map((j) => j.name)
    );
  });
});
