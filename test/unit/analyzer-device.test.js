/**
 * Behavioural replacement for the source-text assertions in
 * test-webnn-optimization-phase1-2.js.
 *
 * The previous suite grepped src/analyzer.ts for literals like `'float16'` and
 * a specific ternary. Both greps were wrong about code that worked, and neither
 * would have noticed the device order actually changing. These tests observe
 * what the analyzer asks the model pipeline for.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  installBrowserGlobals,
  loadAnalyzerModule,
} from "../helpers/analyzer-harness.js";
import { configureStub, stubState } from "../helpers/transformers-stub.js";

let restoreGlobals = () => {};

/** Silence the analyzer's progress logging for the duration of a test. */
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

async function initAnalyzer(globals = {}, stub = {}) {
  restoreGlobals = installBrowserGlobals(globals);
  configureStub(stub);
  const unmute = muteConsole();
  try {
    const { DomAnalyzer } = await loadAnalyzerModule();
    const analyzer = new DomAnalyzer();
    await analyzer.init({ modelLoadTimeoutMs: 2000 });
    return analyzer;
  } finally {
    unmute();
  }
}

describe("analyzer device negotiation", () => {
  it("omits webnn from the device list when navigator.ml is absent", async () => {
    await initAnalyzer({ webnn: false });

    assert.deepEqual(
      stubState().calls.map((c) => c.device),
      ["webgpu"],
      "should start at webgpu and stop once it succeeds"
    );
  });

  it("tries webnn first when navigator.ml is present", async () => {
    await initAnalyzer({ webnn: true });

    assert.equal(stubState().calls[0].device, "webnn");
  });

  it("omits webnn when navigator.ml exists but cannot create a context", async () => {
    await initAnalyzer({ webnn: true, webnnThrows: true });

    const devices = stubState().calls.map((c) => c.device);
    assert.ok(!devices.includes("webnn"), `webnn should be skipped, got ${devices}`);
    assert.equal(devices[0], "webgpu");
  });

  it("falls back through the full device chain in order", async () => {
    await initAnalyzer({ webnn: true }, { failDevices: ["webnn", "webgpu"] });

    assert.deepEqual(
      stubState().calls.map((c) => c.device),
      ["webnn", "webgpu", "wasm"]
    );
  });

  it("degrades to heuristic-only mode when every backend fails", async () => {
    const analyzer = await initAnalyzer(
      { webnn: true },
      { failDevices: ["webnn", "webgpu", "wasm"] }
    );

    assert.deepEqual(
      stubState().calls.map((c) => c.device),
      ["webnn", "webgpu", "wasm"]
    );
    assert.equal(analyzer.getMetrics?.().device ?? "none", "none");
  });
});

describe("analyzer pipeline options", () => {
  it("requests fp16 on GPU backends to reduce memory", async () => {
    await initAnalyzer({ webnn: true });

    const webnnCall = stubState().calls.find((c) => c.device === "webnn");
    assert.equal(webnnCall.dtype, "fp16");
  });

  it("requests fp32 on the wasm/CPU backend", async () => {
    await initAnalyzer({ webnn: false }, { failDevices: ["webgpu"] });

    const wasmCall = stubState().calls.find((c) => c.device === "wasm");
    assert.equal(wasmCall.dtype, "fp32");
  });

  it("requests the feature-extraction task", async () => {
    await initAnalyzer({ webnn: false });
    assert.equal(stubState().calls[0].task, "feature-extraction");
  });
});

describe("analyzer model selection", () => {
  // Both models must be sentence-embedding models that exist on the Hub. The
  // old lightweight choice (distilbert-base-multilingual-cased under Xenova/)
  // did not exist, so on most devices no model loaded at all.
  it("picks the lightweight sentence model on a low-memory device", async () => {
    await initAnalyzer({ deviceMemory: 2 });
    assert.equal(stubState().calls[0].model, "Xenova/paraphrase-MiniLM-L3-v2");
  });

  it("picks the lightweight sentence model on a slow connection", async () => {
    await initAnalyzer({ deviceMemory: 16, effectiveType: "2g" });
    assert.equal(stubState().calls[0].model, "Xenova/paraphrase-MiniLM-L3-v2");
  });

  it("treats 3g as a slow connection", async () => {
    await initAnalyzer({ deviceMemory: 16, effectiveType: "3g" });
    assert.equal(stubState().calls[0].model, "Xenova/paraphrase-MiniLM-L3-v2");
  });

  it("picks the accurate model on a high-memory device with a fast connection", async () => {
    await initAnalyzer({ deviceMemory: 8, effectiveType: "4g" });
    assert.equal(stubState().calls[0].model, "Xenova/all-MiniLM-L6-v2");
  });

  it("picks the accurate model on a mid-range device", async () => {
    // navigator.deviceMemory is capped and coarse; 4GB on 4g is an ordinary
    // laptop and should not be pushed onto the smaller model.
    await initAnalyzer({ deviceMemory: 4, effectiveType: "4g" });
    assert.equal(stubState().calls[0].model, "Xenova/all-MiniLM-L6-v2");
  });

  it("exports the model ids it chooses between", async () => {
    configureStub();
    const { DEFAULT_MODEL, LIGHTWEIGHT_MODEL } = await loadAnalyzerModule();
    assert.equal(DEFAULT_MODEL, "Xenova/all-MiniLM-L6-v2");
    assert.equal(LIGHTWEIGHT_MODEL, "Xenova/paraphrase-MiniLM-L3-v2");
  });
});

describe("analyzer without IndexedDB", () => {
  // Some pages block storage, and Chrome then throws from indexedDB.open().
  // The embedding cache is only an optimisation, so the page must still be
  // analysed; this used to abort the crawl of the whole page.
  for (const [label, indexedDB] of [
    ["denied by the page", "denied"],
    ["absent", false],
  ]) {
    it(`initialises and loads the model when IndexedDB is ${label}`, async () => {
      const analyzer = await initAnalyzer({ webnn: false, indexedDB });

      assert.equal(stubState().calls.length, 1, "the model should still load");
      assert.equal(analyzer.device, "webgpu", "the model should be in use, not heuristics");
    });
  }
});

describe("analyzer model caching", () => {
  it("loads the model once and reuses it across analyzer instances", async () => {
    restoreGlobals = installBrowserGlobals({ webnn: false });
    configureStub();
    const unmute = muteConsole();
    try {
      const { DomAnalyzer } = await loadAnalyzerModule();

      const first = new DomAnalyzer();
      await first.init({ modelLoadTimeoutMs: 2000 });
      const afterFirst = stubState().calls.length;

      const second = new DomAnalyzer();
      await second.init({ modelLoadTimeoutMs: 2000 });

      assert.equal(afterFirst, 1, "first init should load exactly once");
      assert.equal(
        stubState().calls.length,
        1,
        "second instance should reuse the cached model, not reload it"
      );
    } finally {
      unmute();
    }
  });

  it("collapses concurrent init calls into a single model load", async () => {
    restoreGlobals = installBrowserGlobals({ webnn: false });
    configureStub({ loadDelayMs: 50 });
    const unmute = muteConsole();
    try {
      const { DomAnalyzer } = await loadAnalyzerModule();

      const analyzers = [new DomAnalyzer(), new DomAnalyzer(), new DomAnalyzer()];
      await Promise.all(analyzers.map((a) => a.init({ modelLoadTimeoutMs: 2000 })));

      assert.equal(
        stubState().calls.length,
        1,
        "three concurrent inits should share one load"
      );
    } finally {
      unmute();
    }
  });
});

describe("analyzer environment guards", () => {
  it("refuses to initialise outside a browser environment", async () => {
    configureStub();
    const { DomAnalyzer } = await loadAnalyzerModule();
    const analyzer = new DomAnalyzer();

    await assert.rejects(
      () => analyzer.init(),
      /must run in a browser environment/
    );
  });
});
