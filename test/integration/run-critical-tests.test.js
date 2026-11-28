/**
 * End-to-end check of the run_critical_tests flow against BenchmarkShop.
 *
 * Mirrors the MCP handler in src/index.ts: crawl the home page to generate
 * test cases, crawl again for a live browser, then execute the critical tests
 * with TestExecutor.
 *
 * Regression: this used to report 2 passed / 26 failed, almost all
 * "Tool not found". A test that submitted a form or followed a link replaced
 * the page, which wiped the injected handlers for every later test, and the
 * navigating tool itself was reported as "Tool not found". Those are
 * Cartographer failures that read like bugs in the site.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { SiteCrawler } from "../../build/crawler.js";
import { TestExecutor } from "../../build/test-executor.js";
import { SemanticToolGenerator } from "../../build/webmcp-semantic-tools.js";
import { browserGate } from "../helpers/browser-availability.js";
import { startBenchmarkApp } from "../helpers/benchmark-app.js";

const gate = await browserGate();
const app = gate.skip ? null : await startBenchmarkApp();

// Short model budget: fall back to heuristic scoring instead of downloading.
const crawlOptions = { analyzerInitTimeoutMs: 2000, analyzerTimeoutMs: 30000, pageLoadTimeoutMs: 20000 };

describe("run_critical_tests against BenchmarkShop home", { skip: gate.skip }, () => {
  let tests;
  let summary;

  before(async () => {
    const url = `${app.baseUrl}/`;

    const crawler = new SiteCrawler();
    await crawler.init();
    try {
      const analysis = await crawler.crawlAndAnalyze(url, 25, crawlOptions);
      tests = (analysis.generatedTestCases || []).filter(
        (t) => t.priority === "critical" && t.semanticTool
      );
    } finally {
      await crawler.close();
    }

    const runner = new SiteCrawler();
    await runner.init();
    try {
      const live = await runner.crawlAndAnalyze(url, 25, crawlOptions);
      const executor = new TestExecutor(runner.getDriver());
      summary = await executor.executeTests(
        tests,
        SemanticToolGenerator.generate(live.highIntentElements),
        url
      );
    } finally {
      await runner.close();
    }
  });

  after(async () => {
    await app?.stop();
  });

  it("generates critical tests for the home page", () => {
    assert.ok(tests.length >= 10, `expected a realistic number of critical tests, got ${tests.length}`);
  });

  it("gives every test a clean, stable ID", () => {
    for (const t of tests) {
      assert.match(t.id, /^TC_[A-Z0-9]+(_[A-Z0-9]+)*$/, `bad test id: ${t.id}`);
      assert.ok(t.id.startsWith("TC_BENCHMARKSHOP_"), `unexpected id: ${t.id}`);
    }
  });

  it("never reports a handler as missing", () => {
    const missing = summary.results.filter(
      (r) => r.status === "handler-error" || /Tool not found/.test(r.message)
    );
    assert.deepEqual(
      missing.map((r) => `${r.testId} (${r.toolName}): ${r.message}`),
      []
    );
  });

  it("passes every critical test on the healthy fixture", () => {
    const failed = summary.results.filter((r) => r.status === "failed");
    assert.deepEqual(
      failed.map((r) => `${r.testId} (${r.toolName}): ${r.message}`),
      []
    );
    assert.equal(summary.passedTests + summary.skippedTests, summary.totalTests);
  });
});
