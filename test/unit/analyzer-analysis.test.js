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
