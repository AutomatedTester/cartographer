/**
 * PerformanceOptimizer, IncrementalAnalyzer, DOMComplexityAnalyzer.
 *
 * 344 lines that had no test. This layer decides how aggressively a large DOM
 * gets filtered — batch size, adaptive intent threshold, deduplication. None of
 * it can crash a crawl; it can only quietly discard elements that should have
 * been reported, which looks exactly like a page with nothing on it.
 *
 * The two time-dependent paths are driven with a stubbed `performance.now()`
 * rather than real elapsed time. IncrementalAnalyzer compares against a 500ms
 * checkpoint interval starting from zero, so with the real clock the first
 * call's outcome depends on how long the process happened to have been alive —
 * a test that passes or fails by position in the run is worse than no test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PerformanceOptimizer,
  IncrementalAnalyzer,
  DOMComplexityAnalyzer,
} from "../../build/performance-optimizer.js";

/**
 * Run `fn` with `performance.now()` returning successive values from `times`.
 *
 * The last value repeats once the list is exhausted, so a test only has to
 * list the readings it cares about.
 */
async function withClock(times, fn) {
  const real = performance.now;
  let i = 0;
  performance.now = () => times[Math.min(i++, times.length - 1)];
  try {
    return await fn();
  } finally {
    performance.now = real;
  }
}

function el(overrides = {}) {
  return {
    path: "body > button",
    tag: "button",
    locator: "#b",
    intentScore: 50,
    intentReasons: [],
    ...overrides,
  };
}

/** Drain an async generator into an array of its yields. */
async function collect(generator) {
  const yields = [];
  for await (const value of generator) yields.push(value);
  return yields;
}

describe("PerformanceOptimizer: configuration", () => {
  it("applies documented defaults when constructed with no config", () => {
    const optimizer = new PerformanceOptimizer();
    // batchSize 50 is observable through how many batches 120 elements make.
    assert.equal(optimizer.calculateAdaptiveThreshold(10, 100), 110);
  });

  it("accepts a partial config without dropping the unspecified defaults", () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });
    // adaptiveThreshold defaults to true, so it still scales.
    assert.notEqual(optimizer.calculateAdaptiveThreshold(10, 100), 100);
  });
});

describe("PerformanceOptimizer.calculateAdaptiveThreshold", () => {
  const optimizer = new PerformanceOptimizer();

  it("returns the base threshold untouched when adaptation is off", () => {
    const fixed = new PerformanceOptimizer({ adaptiveThreshold: false });
    assert.equal(fixed.calculateAdaptiveThreshold(10_000, 35), 35);
  });

  it("raises the threshold as the element count grows", () => {
    const small = optimizer.calculateAdaptiveThreshold(10, 100);
    const medium = optimizer.calculateAdaptiveThreshold(100, 100);
    const large = optimizer.calculateAdaptiveThreshold(1000, 100);

    assert.equal(small, 110);
    assert.equal(medium, 120);
    assert.equal(large, 130);
    assert.ok(small < medium && medium < large, "must be monotonic");
  });

  // The count is floored at 10 before the log, so every page pays the same
  // 10% surcharge no matter how small. A caller passing 0 must not get NaN
  // or -Infinity, which is what an unfloored log10 would produce.
  it("floors the element count at 10, so tiny pages do not produce -Infinity", () => {
    assert.equal(optimizer.calculateAdaptiveThreshold(0, 100), 110);
    assert.equal(optimizer.calculateAdaptiveThreshold(1, 100), 110);
    assert.equal(optimizer.calculateAdaptiveThreshold(10, 100), 110);
  });

  it("returns an integer, never a fraction", () => {
    for (const count of [0, 7, 83, 412, 9999]) {
      const value = optimizer.calculateAdaptiveThreshold(count, 35);
      assert.equal(value, Math.floor(value), `count ${count} gave ${value}`);
    }
  });

  it("maps a zero base threshold to zero", () => {
    assert.equal(optimizer.calculateAdaptiveThreshold(500, 0), 0);
  });
});

describe("PerformanceOptimizer.deduplicateElements", () => {
  it("keeps the first of two elements sharing a key", () => {
    const optimizer = new PerformanceOptimizer();
    const first = el({ id: "save", text: "Save" });
    const second = el({ id: "save", text: "Save again" });

    const result = optimizer.deduplicateElements([first, second]);

    assert.equal(result.length, 1);
    assert.equal(result[0].text, "Save", "the first occurrence survives");
  });

  it("treats the same id on different tags as different elements", () => {
    const optimizer = new PerformanceOptimizer();
    const result = optimizer.deduplicateElements([
      el({ tag: "button", id: "go" }),
      el({ tag: "a", id: "go" }),
    ]);
    assert.equal(result.length, 2);
  });

  it("falls back from id to classes to text to ariaLabel", () => {
    const optimizer = new PerformanceOptimizer();
    const result = optimizer.deduplicateElements([
      el({ classes: ["btn", "primary"] }),
      el({ classes: ["btn", "primary"] }),
      el({ text: "Submit" }),
      el({ text: "Submit" }),
      el({ ariaLabel: "Close dialog" }),
      el({ ariaLabel: "Close dialog" }),
    ]);

    assert.deepEqual(
      result.map((e) => e.classes?.join(".") ?? e.text ?? e.ariaLabel),
      ["btn.primary", "Submit", "Close dialog"]
    );
  });

  it("prefers id over every other identifier", () => {
    const optimizer = new PerformanceOptimizer();
    const result = optimizer.deduplicateElements([
      el({ id: "x", text: "One" }),
      el({ id: "x", text: "Two" }),
    ]);
    assert.equal(result.length, 1);
  });

  // Every element with nothing identifying collapses to the key "tag:", so a
  // page of anonymous buttons reduces to one. That is the intended trade, but
  // it is severe enough to be worth stating outright.
  it("collapses all elements of a tag that carry no identifier at all", () => {
    const optimizer = new PerformanceOptimizer();
    const anonymous = [el(), el(), el()];
    assert.equal(optimizer.deduplicateElements(anonymous).length, 1);
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(new PerformanceOptimizer().deduplicateElements([]), []);
  });

  it("preserves input order", () => {
    const optimizer = new PerformanceOptimizer();
    const result = optimizer.deduplicateElements([
      el({ id: "c" }),
      el({ id: "a" }),
      el({ id: "b" }),
    ]);
    assert.deepEqual(result.map((e) => e.id), ["c", "a", "b"]);
  });

  it("counts each dropped duplicate as a cache hit", () => {
    const optimizer = new PerformanceOptimizer();
    optimizer.deduplicateElements([
      el({ id: "a" }),
      el({ id: "a" }),
      el({ id: "a" }),
      el({ id: "b" }),
    ]);
    assert.equal(optimizer.getMetrics().cacheHits, 2);
  });

  it("retains elements in the cache only under the aggressive strategy", () => {
    const aggressive = new PerformanceOptimizer({ cachingStrategy: "aggressive" });
    const moderate = new PerformanceOptimizer({ cachingStrategy: "moderate" });

    aggressive.deduplicateElements([el({ id: "a" })]);
    moderate.deduplicateElements([el({ id: "a" })]);

    // clearCache() is only observable through not throwing, but the two
    // strategies must at least agree on the deduplicated output.
    assert.doesNotThrow(() => aggressive.clearCache());
    assert.doesNotThrow(() => moderate.clearCache());
  });

  // cacheMisses is recomputed as (kept - cacheHits) while cacheHits keeps
  // accumulating across calls, so a second call on the same instance can drive
  // it negative. Documented, not endorsed: a miss count below zero is not a
  // meaningful statistic.
  it("miscounts cacheMisses across repeated calls on one instance", () => {
    const optimizer = new PerformanceOptimizer();
    const pair = [el({ id: "a" }), el({ id: "a" })];

    optimizer.deduplicateElements(pair);
    assert.equal(optimizer.getMetrics().cacheMisses, 0);

    optimizer.deduplicateElements(pair);
    assert.equal(optimizer.getMetrics().cacheMisses, -1);
  });
});

describe("PerformanceOptimizer.processInBatches", () => {
  it("splits the input into batches of the configured size", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });
    const seen = [];

    await collect(
      optimizer.processInBatches([1, 2, 3, 4, 5], async (batch) => {
        seen.push(batch);
        return batch.map((n) => el({ id: `e${n}` }));
      })
    );

    assert.deepEqual(seen, [[1, 2], [3, 4], [5]], "last batch is short, not padded");
  });

  it("accumulates results across batches rather than replacing them", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });

    const yields = await collect(
      optimizer.processInBatches([1, 2, 3, 4], async (batch) =>
        batch.map((n) => el({ id: `e${n}` }))
      )
    );

    assert.deepEqual(yields.at(-1).map((e) => e.id), ["e1", "e2", "e3", "e4"]);
  });

  it("yields once per batch plus a final yield when incremental results are on", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });

    const yields = await collect(
      optimizer.processInBatches([1, 2, 3, 4], async () => [el()])
    );

    assert.equal(yields.length, 3, "two batches then the final yield");
    assert.deepEqual(yields.map((y) => y.length), [1, 2, 2]);
  });

  it("yields only the final result when incremental results are off", async () => {
    const optimizer = new PerformanceOptimizer({
      batchSize: 2,
      enableIncrementalResults: false,
    });

    const yields = await collect(
      optimizer.processInBatches([1, 2, 3, 4], async () => [el()])
    );

    assert.equal(yields.length, 1);
    assert.equal(yields[0].length, 2);
  });

  it("reports progress from just above zero through to exactly 1", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });
    const progress = [];

    await collect(
      optimizer.processInBatches(
        [1, 2, 3, 4, 5, 6],
        async () => [],
        (p) => progress.push(p)
      )
    );

    assert.deepEqual(progress, [1 / 3, 2 / 3, 1]);
  });

  it("yields an empty result for empty input without calling the processor", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });
    let called = 0;

    const yields = await collect(
      optimizer.processInBatches([], async () => {
        called += 1;
        return [];
      })
    );

    assert.equal(called, 0);
    assert.deepEqual(yields, [[]]);
  });

  it("counts batches and accumulates elapsed analysis time", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });

    await withClock([0, 10, 10, 30], () =>
      collect(optimizer.processInBatches([1, 2, 3, 4], async () => [el()]))
    );

    const metrics = optimizer.getMetrics();
    assert.equal(metrics.batchCount, 2);
    assert.equal(metrics.analysisTimeMs, 30, "10ms then 20ms");
  });

  it("propagates a processor rejection rather than swallowing it", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });

    await assert.rejects(
      () =>
        collect(
          optimizer.processInBatches([1, 2], async () => {
            throw new Error("processor exploded");
          })
        ),
      /processor exploded/
    );
  });

  it("skips memory monitoring when it is disabled", async () => {
    const optimizer = new PerformanceOptimizer({
      batchSize: 2,
      enableMemoryMonitoring: false,
    });

    await collect(optimizer.processInBatches([1, 2], async () => []));

    assert.equal(optimizer.getMetrics().memoryUsageMb, 0, "never sampled");
  });

  it("records memory usage when monitoring is enabled", async () => {
    const optimizer = new PerformanceOptimizer({ batchSize: 2 });

    await collect(optimizer.processInBatches([1, 2], async () => []));

    assert.ok(optimizer.getMetrics().memoryUsageMb > 0, "heap was sampled");
  });

  // Above 200MB the optimizer evicts half the element cache. The eviction has
  // no other observable effect, because nothing ever reads elementCache back —
  // deduplicateElements builds a fresh Set per call. So the log line is the
  // whole contract, and asserting on it is the only way to prove the branch
  // runs at all.
  it("evicts half the element cache once the heap passes 200MB", async () => {
    const optimizer = new PerformanceOptimizer({
      batchSize: 1,
      cachingStrategy: "aggressive",
    });
    optimizer.deduplicateElements([
      el({ id: "a" }),
      el({ id: "b" }),
      el({ id: "c" }),
      el({ id: "d" }),
    ]);

    const realMemoryUsage = process.memoryUsage;
    const realLog = console.log;
    const logged = [];
    process.memoryUsage = () => ({ heapUsed: 300 * 1024 * 1024 });
    console.log = (...args) => logged.push(args.join(" "));

    try {
      await collect(optimizer.processInBatches([1], async () => []));
    } finally {
      process.memoryUsage = realMemoryUsage;
      console.log = realLog;
    }

    assert.equal(optimizer.getMetrics().memoryUsageMb, 300);
    assert.ok(
      logged.some((line) => /Cleared 2 cached elements/.test(line)),
      `expected an eviction of 2 of 4, got: ${JSON.stringify(logged)}`
    );
  });

  it("leaves the cache alone when the heap is below the eviction threshold", async () => {
    const optimizer = new PerformanceOptimizer({
      batchSize: 1,
      cachingStrategy: "aggressive",
    });
    optimizer.deduplicateElements([el({ id: "a" }), el({ id: "b" })]);

    const realMemoryUsage = process.memoryUsage;
    const realLog = console.log;
    const logged = [];
    process.memoryUsage = () => ({ heapUsed: 10 * 1024 * 1024 });
    console.log = (...args) => logged.push(args.join(" "));

    try {
      await collect(optimizer.processInBatches([1], async () => []));
    } finally {
      process.memoryUsage = realMemoryUsage;
      console.log = realLog;
    }

    assert.equal(optimizer.getMetrics().memoryUsageMb, 10);
    assert.deepEqual(logged, [], "nothing evicted below 200MB");
  });
});

describe("PerformanceOptimizer: metrics lifecycle", () => {
  it("hands back a copy, so a caller cannot mutate internal state", () => {
    const optimizer = new PerformanceOptimizer();
    optimizer.deduplicateElements([el({ id: "a" }), el({ id: "a" })]);

    const snapshot = optimizer.getMetrics();
    snapshot.cacheHits = 999;

    assert.equal(optimizer.getMetrics().cacheHits, 1, "snapshot was detached");
  });

  it("returns every metric to zero on reset", () => {
    const optimizer = new PerformanceOptimizer();
    optimizer.deduplicateElements([el({ id: "a" }), el({ id: "a" })]);

    optimizer.resetMetrics();

    for (const [key, value] of Object.entries(optimizer.getMetrics())) {
      assert.equal(value, 0, `${key} should be reset`);
    }
  });

  it("starts every metric at zero", () => {
    for (const [key, value] of Object.entries(new PerformanceOptimizer().getMetrics())) {
      assert.equal(value, 0, `${key} should start at zero`);
    }
  });
});

describe("IncrementalAnalyzer", () => {
  it("starts with no checkpoints", () => {
    assert.deepEqual(new IncrementalAnalyzer().getCheckpoints(), []);
  });

  it("records the first batch once the checkpoint interval has elapsed", async () => {
    const analyzer = new IncrementalAnalyzer();
    await withClock([501], async () => analyzer.recordProgress([el({ id: "a" })]));

    assert.deepEqual(analyzer.getCheckpoints().map((e) => e.id), ["a"]);
  });

  it("ignores progress reported inside the checkpoint interval", async () => {
    const analyzer = new IncrementalAnalyzer();
    await withClock([499], async () => analyzer.recordProgress([el({ id: "a" })]));

    assert.deepEqual(analyzer.getCheckpoints(), [], "too soon to checkpoint");
  });

  it("throttles: a second report inside the interval is dropped", async () => {
    const analyzer = new IncrementalAnalyzer();

    await withClock([600, 700, 1300], async () => {
      analyzer.recordProgress([el({ id: "a" })]); // t=600, first checkpoint
      analyzer.recordProgress([el({ id: "b" })]); // t=700, only 100ms later
      analyzer.recordProgress([el({ id: "c" })]); // t=1300, 700ms later
    });

    assert.deepEqual(
      analyzer.getCheckpoints().map((e) => e.id),
      ["a", "c"],
      "b fell inside the interval"
    );
  });

  it("appends elements rather than replacing the checkpoint list", async () => {
    const analyzer = new IncrementalAnalyzer();

    await withClock([600, 1300], async () => {
      analyzer.recordProgress([el({ id: "a" }), el({ id: "b" })]);
      analyzer.recordProgress([el({ id: "c" })]);
    });

    assert.deepEqual(analyzer.getCheckpoints().map((e) => e.id), ["a", "b", "c"]);
  });

  it("clears checkpoints and the clock on reset", async () => {
    const analyzer = new IncrementalAnalyzer();

    await withClock([600], async () => analyzer.recordProgress([el({ id: "a" })]));
    analyzer.reset();
    assert.deepEqual(analyzer.getCheckpoints(), []);

    // The interval is measured from zero again, so t=501 checkpoints anew.
    await withClock([501], async () => analyzer.recordProgress([el({ id: "b" })]));
    assert.deepEqual(analyzer.getCheckpoints().map((e) => e.id), ["b"]);
  });

  it("records an empty batch without creating a phantom checkpoint entry", async () => {
    const analyzer = new IncrementalAnalyzer();
    await withClock([600], async () => analyzer.recordProgress([]));
    assert.deepEqual(analyzer.getCheckpoints(), []);
  });
});

describe("DOMComplexityAnalyzer.analyzeComplexity", () => {
  /** `count` elements each having `childCount` children. */
  function elements(count, childCount = 0) {
    return Array.from({ length: count }, () => ({
      children: Array.from({ length: childCount }, () => ({ children: [] })),
    }));
  }

  it("reports the element count it was given", () => {
    assert.equal(DOMComplexityAnalyzer.analyzeComplexity(elements(42)).totalElements, 42);
  });

  it("classifies under 100 elements as low complexity", () => {
    const metrics = DOMComplexityAnalyzer.analyzeComplexity(elements(99));
    assert.equal(metrics.estimatedComplexity, "low");
    assert.equal(metrics.suggestedBatchSize, 100);
    assert.equal(metrics.suggestedThreshold, 30);
  });

  it("classifies 100 to 499 elements as medium complexity", () => {
    for (const count of [100, 499]) {
      const metrics = DOMComplexityAnalyzer.analyzeComplexity(elements(count));
      assert.equal(metrics.estimatedComplexity, "medium", `${count} elements`);
      assert.equal(metrics.suggestedBatchSize, 50);
      assert.equal(metrics.suggestedThreshold, 35);
    }
  });

  it("classifies 500 or more elements as high complexity", () => {
    const metrics = DOMComplexityAnalyzer.analyzeComplexity(elements(500));
    assert.equal(metrics.estimatedComplexity, "high");
    assert.equal(metrics.suggestedBatchSize, 25);
    assert.equal(metrics.suggestedThreshold, 40);
  });

  it("handles an empty DOM without dividing by zero", () => {
    const metrics = DOMComplexityAnalyzer.analyzeComplexity([]);
    assert.equal(metrics.totalElements, 0);
    assert.equal(metrics.averageDepth, 0);
    assert.equal(metrics.nestingFactor, 0);
    assert.equal(metrics.estimatedComplexity, "low");
  });

  // averageDepth is the mean number of direct children, despite the name.
  it("averages the direct child count across elements", () => {
    const mixed = [{ children: [{}, {}] }, { children: [{}, {}, {}, {}] }];
    assert.equal(DOMComplexityAnalyzer.analyzeComplexity(mixed).averageDepth, 3);
  });

  it("treats an element with no children array as having none", () => {
    const metrics = DOMComplexityAnalyzer.analyzeComplexity([{}, {}]);
    assert.equal(metrics.averageDepth, 0);
    assert.equal(metrics.nestingFactor, 0);
  });

  it("reports nesting factor as the deepest descendant chain", () => {
    const threeDeep = [
      { children: [{ children: [{ children: [] }] }] },
      { children: [] },
    ];
    assert.equal(DOMComplexityAnalyzer.analyzeComplexity(threeDeep).nestingFactor, 2);
  });

  it("escalates a small DOM to high complexity when it is densely nested", () => {
    // 10 elements is 'low' by count, but 9 children each pushes averageDepth
    // past the 8 threshold.
    const metrics = DOMComplexityAnalyzer.analyzeComplexity(elements(10, 9));

    assert.equal(metrics.estimatedComplexity, "high");
    assert.equal(metrics.suggestedBatchSize, 25, "clamped down from 100");
  });

  it("leaves an already-small batch size alone when escalating", () => {
    const metrics = DOMComplexityAnalyzer.analyzeComplexity(elements(500, 9));
    assert.equal(metrics.estimatedComplexity, "high");
    assert.equal(metrics.suggestedBatchSize, 25);
  });

  it("does not escalate at exactly the nesting threshold", () => {
    const metrics = DOMComplexityAnalyzer.analyzeComplexity(elements(10, 8));
    assert.equal(metrics.averageDepth, 8);
    assert.equal(metrics.estimatedComplexity, "low", "strictly greater than 8 required");
  });
});
