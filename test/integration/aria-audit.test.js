/**
 * The ARIA advisory in a real browser, against the BenchmarkShop /aria-lab page.
 *
 * The unit suites run the collector over a fake DOM. This proves the same
 * function survives being serialised into Chrome, and that real layout,
 * focusability and id resolution give the answers the rules expect. The lab
 * page has a "bad" half that must each attract advice and a "good" half that
 * must attract none.
 *
 * Skips without Chrome unless REQUIRE_BROWSER=1, like benchmark-crawl.test.js.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { SiteCrawler } from "../../build/crawler.js";
import { browserGate } from "../helpers/browser-availability.js";
import { startBenchmarkApp } from "../helpers/benchmark-app.js";
import { startInProcessServer, textOf } from "../helpers/mcp-harness.js";

const gate = await browserGate();
const app = gate.skip ? null : await startBenchmarkApp();

/** Advice expected for each deliberately bad element on the lab page. */
const EXPECTED_BAD = {
  "#bad-div-button": "widget-not-focusable",
  "#bad-hidden-link": "aria-hidden-focusable",
  "#bad-label-mismatch": "label-not-in-name",
  "#bad-typo-role": "invalid-role",
  "#bad-expanded-value": "invalid-attribute-value",
  "#bad-describedby": "broken-idref",
  "#bad-checked-on-button": "unsupported-state",
  "#bad-empty-tablist": "required-owned",
  "#bad-named-div": "prohibited-name",
  "#bad-redundant": "redundant-role",
  "#bad-hidden-wrapper": "aria-hidden-focusable",
};

describe("ARIA advisory in Chrome", { skip: gate.skip }, () => {
  let report = null;
  let auditError = null;

  before(async () => {
    const crawler = new SiteCrawler();
    try {
      await crawler.init();
      report = await crawler.auditAria(`${app.baseUrl}/aria-lab`, 20000);
    } catch (err) {
      auditError = err;
    } finally {
      await crawler.close();
    }
  });

  after(async () => {
    await app?.stop();
  });

  function audited() {
    if (!report) assert.fail(`audit did not produce a report: ${auditError?.stack ?? auditError}`);
    assert.equal(report.error, undefined, `collector failed in the page: ${report.error}`);
    return report;
  }

  it("produces an advisory report for the page", () => {
    const r = audited();

    assert.equal(r.advisory, true);
    assert.match(r.url, /\/aria-lab$/);
    assert.match(r.title, /ARIA Lab/);
    assert.ok(r.elementsScanned > r.elementsWithAria);
  });

  for (const [locator, ruleId] of Object.entries(EXPECTED_BAD)) {
    it(`advises on ${locator} (${ruleId})`, () => {
      const found = audited().findings.filter((f) => f.locator === locator);
      assert.ok(
        found.some((f) => f.ruleId === ruleId),
        `expected ${ruleId} on ${locator}, got ${JSON.stringify(found.map((f) => f.ruleId))}`
      );
      for (const f of found) {
        assert.ok(f.ifRemoved.length > 0, `${f.ruleId} on ${locator} does not say what removal would lose`);
      }
    });
  }

  it("gives no advice about the correct ARIA on the page", () => {
    const good = audited().findings.filter((f) => f.locator.startsWith("#good-"));
    assert.deepEqual(good.map((f) => `${f.ruleId} ${f.locator}`), []);
  });

  it("ignores the content hidden with the hidden attribute", () => {
    assert.ok(!audited().findings.some((f) => f.locator === "#good-panel"));
  });

  it("calls out the site header's menubar navigation", () => {
    const f = audited().findings.find((x) => x.ruleId === "links-as-menu");
    assert.ok(f, "expected links-as-menu for the header navigation");
    assert.match(f.problem, /#nav-home/);
  });

  it("attaches the advisory to crawl_and_analyze only when asked", async () => {
    const crawler = new SiteCrawler();
    try {
      await crawler.init();
      const options = { analyzerInitTimeoutMs: 1000, analyzerTimeoutMs: 30000 };
      const without = await crawler.crawlAndAnalyze(`${app.baseUrl}/aria-lab`, 25, options);
      const withAudit = await crawler.crawlAndAnalyze(`${app.baseUrl}/aria-lab`, 25, { ...options, ariaAudit: true });

      assert.equal(without.ariaAudit, undefined);
      assert.equal(withAudit.ariaAudit?.advisory, true);
      assert.ok(withAudit.ariaAudit.findings.some((f) => f.locator === "#bad-div-button"));
    } finally {
      await crawler.close();
    }
  });

  it("serves audit_aria over MCP as advice, not as an error", async () => {
    const server = await startInProcessServer();
    try {
      const result = await server.client.callTool({
        name: "audit_aria",
        arguments: { url: `${app.baseUrl}/aria-lab` },
      });
      const text = textOf(result);

      assert.notEqual(result.isError, true, "findings must never make the tool call an error");
      assert.match(text, /# ARIA Advisory/);
      assert.match(text, /No ARIA is better than bad ARIA/);
      assert.match(text, /\*\*If you remove this ARIA:\*\*/);
      assert.match(text, /#bad-div-button/);

      const json = await server.client.callTool({
        name: "audit_aria",
        arguments: { url: `${app.baseUrl}/aria-lab`, format: "json" },
      });
      const parsed = JSON.parse(textOf(json));
      assert.equal(parsed.advisory, true);
      assert.ok(parsed.summary.total > 0);
    } finally {
      await server.close();
    }
  });
});
