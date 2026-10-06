/**
 * End-to-end crawl of the in-repo BenchmarkShop fixture.
 *
 * This is the only suite that drives a real browser. It is hermetic — the
 * target is localhost, not a third-party site — and it asserts against
 * benchmark/ground-truth/journeys.json rather than just printing what it found.
 *
 * The ML model is deliberately given a short load budget so the crawl falls
 * back to heuristic scoring. That keeps the test fast and deterministic while
 * still exercising Selenium, DOM extraction, scoring, workflow detection and
 * journey inference.
 *
 * Set REQUIRE_BROWSER=1 (as CI does) to turn "Chrome is broken" from a skip
 * into a failure.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { MultiPageCrawler } from "../../build/multi-page-crawler.js";
import { browserGate } from "../helpers/browser-availability.js";
import { loadGroundTruth, startBenchmarkApp } from "../helpers/benchmark-app.js";

const groundTruth = loadGroundTruth();

const gate = await browserGate();
const app = gate.skip ? null : await startBenchmarkApp();

/** Path portion of a crawled page URL. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

let crawlResult = null;
let crawlError = null;

describe("BenchmarkShop crawl", { skip: gate.skip }, () => {
  before(async () => {
    const crawler = new MultiPageCrawler({
      startUrl: `${app.baseUrl}/`,
      maxPages: 8,
      maxDepth: 2,
      pageLoadTimeout: 20000,
      // Short budget: fall back to heuristics instead of downloading a model.
      modelLoadTimeoutMs: 2000,
      analysisTimeoutMs: 30000,
      intentThreshold: 25,
      detectWorkflows: true,
      concurrencyLimit: 2,
      enableAutoLogin: false,
    });

    try {
      crawlResult = await crawler.crawl();
    } catch (err) {
      crawlError = err;
    }
  });

  after(async () => {
    await app?.stop();
  });

  it("completes without throwing", () => {
    assert.equal(crawlError, null, `crawl threw: ${crawlError?.stack ?? crawlError}`);
    assert.ok(crawlResult, "crawl returned no result");
  });

  it("visits more than just the entry page", () => {
    assert.ok(
      crawlResult.summary.pagesVisited >= 3,
      `expected to reach at least 3 pages, visited ${crawlResult.summary.pagesVisited}`
    );
  });

  it("reaches pages that appear in the ground-truth journeys", () => {
    const visited = new Set(crawlResult.session.pages.map((p) => pathOf(p.url)));
    const groundTruthPaths = new Set(
      groundTruth.journeys.flatMap((j) => j.pageSequence).filter((p) => !p.includes(":"))
    );

    const overlap = [...visited].filter((p) => groundTruthPaths.has(p));
    assert.ok(
      overlap.length >= 2,
      `crawl reached ${JSON.stringify([...visited])}, which overlaps ground truth only at ${JSON.stringify(overlap)}`
    );
  });

  it("finds high-intent elements on the pages it visited", () => {
    assert.ok(
      crawlResult.summary.highIntentElements > 0,
      "crawl found no high-intent elements at all"
    );
  });

  it("recovers the frozen navigation locators the ground truth promises", () => {
    const locators = crawlResult.session.pages
      .flatMap((p) => p.highIntentElements)
      .map((el) => el.locator)
      .join(" ");

    const frozen = groundTruth.stableLocators.navigation.filter((s) => !s.includes("{"));
    const found = frozen.filter((sel) => locators.includes(sel.slice(1)));

    assert.ok(
      found.length >= 3,
      `expected to recover several frozen nav ids, found ${JSON.stringify(found)}`
    );
  });

  it("reports per-page failures rather than silently dropping pages", () => {
    const { pagesVisited, failedPages = 0 } = crawlResult.summary;
    assert.equal(
      pagesVisited + failedPages,
      crawlResult.session.pages.length + failedPages,
      "page accounting does not add up"
    );

    for (const err of crawlResult.crawlErrors ?? []) {
      assert.ok(err.url, "crawl error without a url");
      assert.ok(err.phase, "crawl error without a phase");
      assert.ok(err.message, "crawl error without a message");
    }
  });

  it("gives every crawled page a well-formed shape", () => {
    for (const page of crawlResult.session.pages) {
      assert.ok(page.url.startsWith("http"), `bad page url: ${page.url}`);
      assert.equal(typeof page.title, "string");
      assert.ok(Array.isArray(page.highIntentElements));
      for (const el of page.highIntentElements) {
        assert.ok(el.locator, `element without a locator on ${page.url}`);
        assert.equal(typeof el.intentScore, "number");
        assert.ok(el.intentScore >= 0, "negative intent score");
      }
    }
  });

  it("produces inferred journeys for a shop-shaped site", () => {
    const journeys = crawlResult.inferredJourneys ?? [];
    assert.ok(
      journeys.length > 0,
      "no journeys inferred from a site with products, cart and login"
    );

    for (const journey of journeys) {
      assert.ok(journey.name, "journey without a name");
      assert.ok(
        journey.confidence >= 0 && journey.confidence <= 100,
        `confidence out of range: ${journey.confidence}`
      );
    }
  });

  it("stays within the configured page budget", () => {
    assert.ok(
      crawlResult.session.pages.length <= 8,
      `maxPages was 8 but ${crawlResult.session.pages.length} pages were crawled`
    );
  });
});
