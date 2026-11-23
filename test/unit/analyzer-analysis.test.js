/**
 * Behavioural coverage for DomAnalyzer.analyzeCurrentPage: metrics, the
 * heuristic fallback path, and the batching introduced for large DOMs.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  installBrowserGlobals,
  loadAnalyzerModule,
  node,
  setPageBody,
} from "../helpers/analyzer-harness.js";
import { configureStub, stubState } from "../helpers/transformers-stub.js";

let restoreGlobals = () => {};

function muteConsole() {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
}

afterEach(() => {
  restoreGlobals();
  restoreGlobals = () => {};
});

/** Build a page of N interactive buttons plus a heading. */
function buildPage(buttonCount) {
  const nodes = [node("h1", { text: "Checkout" })];
  for (let i = 0; i < buttonCount; i += 1) {
    nodes.push(
      node("button", {
        id: `action-${i}`,
        text: `Action ${i}`,
        attrs: { type: "button" },
      })
    );
  }
  return nodes;
}

async function analyze({ globals = {}, stub = {}, body, ...args } = {}) {
  restoreGlobals = installBrowserGlobals(globals);
  configureStub(stub);
  const unmute = muteConsole();
  try {
    const { DomAnalyzer } = await loadAnalyzerModule();
    const analyzer = new DomAnalyzer();
    await analyzer.init({ modelLoadTimeoutMs: 2000 });
    setPageBody(body ?? buildPage(3));
    const result = await analyzer.analyzeCurrentPage(
      args.intentThreshold ?? 25,
      args.maxBatchSize ?? 50
    );
    return { analyzer, result };
  } finally {
    unmute();
  }
}

describe("analyzeCurrentPage result shape", () => {
  it("reports the page url and title", async () => {
    const { result } = await analyze();

    assert.equal(result.url, "https://example.test/page");
    assert.equal(result.title, "Test Page");
    assert.ok(Array.isArray(result.highIntentElements));
    assert.ok(Array.isArray(result.consoleLogs));
  });

  it("surfaces interactive elements as high intent", async () => {
    const { result } = await analyze({ body: buildPage(3) });

    const locators = result.highIntentElements.map((el) => el.locator);
    assert.ok(
      locators.some((l) => l.includes("action-0")),
      `expected a button locator, got ${JSON.stringify(locators)}`
    );
  });

  it("ignores non-interactive content below the intent threshold", async () => {
    const { result } = await analyze({
      body: [node("p", { text: "Just some prose" }), node("span", { text: "more" })],
      intentThreshold: 25,
    });

    assert.deepEqual(result.highIntentElements, []);
  });

  it("populates metrics with the device actually used", async () => {
    const { result } = await analyze({ globals: { webnn: true } });

    assert.ok(result.metrics, "metrics should be present");
    assert.equal(result.metrics.device, "webnn");
    assert.equal(typeof result.metrics.modelLoadTime, "number");
    assert.equal(typeof result.metrics.analysisTime, "number");
    assert.equal(typeof result.metrics.deduplicationTime, "number");
    assert.ok(result.metrics.elementsAnalyzed >= 1);
    assert.ok(result.metrics.modelLoadTime >= 0);
  });

  it("reports device 'none' when no ML backend loaded", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { failDevices: ["webgpu", "wasm"] },
    });

    assert.equal(result.metrics.device, "none");
  });

  it("reports zero LLM tokens on the ML path", async () => {
    const { result } = await analyze({ globals: { webnn: true } });
    assert.equal(result.metrics.tokensUsed, 0);
  });

  it("reports zero LLM tokens on the heuristic path", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { failDevices: ["webgpu", "wasm"] },
    });
    assert.equal(result.metrics.tokensUsed, 0);
  });
});

describe("analyzeCurrentPage heuristic fallback", () => {
  it("still returns high-intent elements with no ML backend available", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { failDevices: ["webgpu", "wasm"] },
      body: buildPage(4),
    });

    assert.ok(
      result.highIntentElements.length > 0,
      "heuristic scoring should still surface the buttons"
    );
    assert.equal(stubState().calls.filter((c) => c.device === "wasm").length, 1);
  });

  it("computes no embeddings when running heuristically", async () => {
    await analyze({
      globals: { webnn: false },
      stub: { failDevices: ["webgpu", "wasm"] },
      body: buildPage(10),
    });

    // Only the three failed pipeline construction attempts, no per-element work.
    assert.deepEqual(
      stubState().calls.map((c) => c.device),
      ["webgpu", "wasm"]
    );
  });
});

describe("analyzeCurrentPage batching", () => {
  it("processes a large DOM without dropping elements", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      body: buildPage(120),
      maxBatchSize: 25,
    });

    assert.ok(
      result.metrics.elementsAnalyzed >= 120,
      `expected >=120 analyzed, got ${result.metrics.elementsAnalyzed}`
    );
    assert.ok(result.highIntentElements.length > 0);
  });

  it("produces the same elements whether or not batching kicks in", async () => {
    const body = buildPage(60);

    const batched = await analyze({
      globals: { webnn: false },
      body,
      maxBatchSize: 10,
    });
    restoreGlobals();

    const unbatched = await analyze({
      globals: { webnn: false },
      body,
      maxBatchSize: 1000,
    });

    assert.equal(
      batched.result.highIntentElements.length,
      unbatched.result.highIntentElements.length,
      "batch size must not change which elements survive"
    );
  });
});

describe("analyzeCurrentPage semantic deduplication", () => {
  // Non-form elements (role=button divs here) are merged when their
  // embeddings say they are the same thing; buttons, links and inputs never are.
  const roleButton = (id, text) =>
    node("div", { id, text, attrs: { role: "button", tabindex: "0" } });

  /** Unit vectors keyed by which label a description mentions. */
  const byLabel = (text) => {
    if (text.includes("Add to cart")) return [1, 0, 0];
    if (text.includes("Add to bag")) return [0.99, 0.14, 0]; // cosine ~0.99
    if (text.includes("Wishlist")) return [0, 1, 0];
    return [0, 0, 1];
  };

  it("asks the model for one mean-pooled, normalised vector per description", async () => {
    await analyze({
      globals: { webnn: false },
      body: [roleButton("a", "Add to cart"), roleButton("b", "Wishlist")],
    });

    const calls = stubState().embedCalls;
    assert.ok(calls.length >= 2, "expected an embedding per candidate");
    for (const call of calls) {
      assert.deepEqual(call.options, { pooling: "mean", normalize: true });
    }
  });

  it("merges non-form elements whose embeddings are near-identical", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { embedding: byLabel },
      body: [
        roleButton("cart-1", "Add to cart"),
        roleButton("cart-2", "Add to bag"),
        roleButton("wish", "Wishlist"),
      ],
    });

    const ids = result.highIntentElements.map((e) => e.id).sort();
    assert.deepEqual(ids, ["cart-1", "wish"]);
  });

  it("keeps non-form elements whose embeddings differ", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { embedding: byLabel },
      body: [roleButton("cart", "Add to cart"), roleButton("wish", "Wishlist")],
    });

    assert.equal(result.highIntentElements.length, 2);
  });

  it("never merges real buttons, however similar", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { embedding: [1, 0, 0] },
      body: buildPage(4),
    });

    assert.equal(result.highIntentElements.filter((e) => e.tag === "button").length, 4);
  });

  it("keeps elements whose embedding came back empty", async () => {
    const { result } = await analyze({
      globals: { webnn: false },
      stub: { embedding: [] },
      body: [roleButton("a", "Add to cart"), roleButton("b", "Add to cart")],
    });

    assert.equal(result.highIntentElements.length, 2);
  });
});
