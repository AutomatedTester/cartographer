/**
 * Pre-init contract of SiteCrawler, including the WebDriver BiDi capability.
 *
 * Converted from test/test-bidi-session.js, which already had real assertions
 * but ran outside the test gate. No browser is required: every check here is
 * about the API surface and the state before init().
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import chrome from "selenium-webdriver/chrome.js";

import { SiteCrawler } from "../../build/crawler.js";

const REQUIRED_METHODS = [
  "init",
  "verifyBiDiSession",
  "isBiDiEnabled",
  "clickElement",
  "crawlAndAnalyze",
  "close",
  "getDriver",
];

describe("SiteCrawler API surface", () => {
  for (const method of REQUIRED_METHODS) {
    it(`exposes ${method}()`, () => {
      assert.equal(typeof SiteCrawler.prototype[method], "function");
    });
  }
});

describe("SiteCrawler before init()", () => {
  it("reports no BiDi session", async () => {
    assert.equal(await new SiteCrawler().verifyBiDiSession(), false);
  });

  it("reports BiDi as disabled", () => {
    assert.equal(new SiteCrawler().isBiDiEnabled(), false);
  });

  it("refuses to click, naming init() in the error", async () => {
    await assert.rejects(
      () => new SiteCrawler().clickElement({}),
      /init\(\)/
    );
  });

  it("closes cleanly even though nothing was started", async () => {
    await assert.doesNotReject(() => new SiteCrawler().close());
  });
});

describe("Chrome BiDi capability", () => {
  it("sets webSocketUrl when enableBidi() is called", () => {
    const options = new chrome.Options();
    options.enableBidi();
    assert.equal(options.get("webSocketUrl"), true);
  });

  it("does not set webSocketUrl by default", () => {
    assert.notEqual(new chrome.Options().get("webSocketUrl"), true);
  });
});

/**
 * A driver stand-in whose every navigation lands where `landsOn` says,
 * recording whether anything ran on the page afterwards.
 */
function fakeDriver(landsOn) {
  const calls = { scripts: 0 };
  let requested = "";
  const driver = {
    manage: () => ({ setTimeouts: async () => {} }),
    get: async (url) => {
      requested = url;
    },
    // Like chromedriver: on an error page this still reports the URL asked
    // for, so only the page itself knows where it ended up.
    getCurrentUrl: async () => requested,
    executeScript: async (script) => {
      if (script === "return window.location.href") return landsOn;
      calls.scripts += 1;
      return null;
    },
    executeAsyncScript: async () => {
      calls.scripts += 1;
      return null;
    },
  };
  return { driver, calls };
}

function crawlerOn(landsOn) {
  const crawler = new SiteCrawler();
  const { driver, calls } = fakeDriver(landsOn);
  crawler.driver = driver;
  return { crawler, calls };
}

describe("SiteCrawler when Chrome shows its own error page", () => {
  // Chrome answers a failed load (DNS, refused connection, bad certificate,
  // an HTTPS-First upgrade that fails) with chrome-error://chromewebdata/
  // rather than an exception. Analysing that page used to record the site as
  // a real page with no elements.
  const url = "http://http-only.example.test/";

  it("rejects crawlAndAnalyze, naming the requested URL", async () => {
    const { crawler, calls } = crawlerOn("chrome-error://chromewebdata/");
    await assert.rejects(
      () => crawler.crawlAndAnalyze(url),
      (err) => err.message.includes(url) && /error page/i.test(err.message)
    );
    assert.equal(calls.scripts, 0, "nothing should be injected into the error page");
  });

  it("rejects auditAria the same way", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/");
    await assert.rejects(() => crawler.auditAria(url), /error page/i);
  });

  it("points at HTTPS-First when an http URL fails", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/");
    await assert.rejects(() => crawler.auditAria(url), /HTTPS-First/);
  });

  it("does not blame HTTPS-First for an https URL", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/");
    await assert.rejects(
      () => crawler.auditAria("https://down.example.test/"),
      (err) => !/HTTPS-First/.test(err.message)
    );
  });

  it("carries on when the page loaded", async () => {
    const { crawler, calls } = crawlerOn("https://example.test/");
    await crawler.auditAria("https://example.test/");
    assert.ok(calls.scripts > 0, "the ARIA collector should have run");
  });
});
