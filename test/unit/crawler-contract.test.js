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

import {
  SiteCrawler,
  READ_CHROME_ERROR_CODE,
  loadFailureMessage,
} from "../../build/crawler.js";

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
function fakeDriver(landsOn, errorCode = null) {
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
      // Reading the error code off Chrome's error page is the one script
      // allowed to run there; it is not counted as analysis.
      if (script === READ_CHROME_ERROR_CODE) return errorCode;
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

function crawlerOn(landsOn, errorCode = null) {
  const crawler = new SiteCrawler();
  const { driver, calls } = fakeDriver(landsOn, errorCode);
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

  // With no error code readable, HTTPS-First is one possible cause among
  // several, so it is offered only as a hint for http-only sites.
  it("offers HTTPS-First only as an http-only hint when the cause is unknown", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/");
    await assert.rejects(
      () => crawler.auditAria(url),
      (err) => /HTTPS-First/.test(err.message) && /if the site is http-only/i.test(err.message)
    );
  });

  it("names a refused connection and does not blame HTTPS-First for it", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/", "ERR_CONNECTION_REFUSED");
    await assert.rejects(
      () => crawler.auditAria("http://127.0.0.1:9/"),
      (err) =>
        err.message.includes("http://127.0.0.1:9/") &&
        err.message.includes("ERR_CONNECTION_REFUSED") &&
        /refused/i.test(err.message) &&
        !/HTTPS-First/.test(err.message)
    );
  });

  it("names an unresolvable host", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/", "ERR_NAME_NOT_RESOLVED");
    await assert.rejects(
      () => crawler.auditAria(url),
      (err) => err.message.includes("ERR_NAME_NOT_RESOLVED") && /DNS|resolve/i.test(err.message) && !/HTTPS-First/.test(err.message)
    );
  });

  it("names a timeout", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/", "ERR_CONNECTION_TIMED_OUT");
    await assert.rejects(
      () => crawler.auditAria(url),
      (err) => err.message.includes("ERR_CONNECTION_TIMED_OUT") && /time/i.test(err.message)
    );
  });

  it("blames HTTPS-First for a certificate error on an http URL", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/", "NET::ERR_CERT_COMMON_NAME_INVALID");
    await assert.rejects(
      () => crawler.auditAria(url),
      (err) =>
        err.message.includes("ERR_CERT_COMMON_NAME_INVALID") &&
        /certificate/i.test(err.message) &&
        /HTTPS-First/.test(err.message)
    );
  });

  it("reports a certificate error on an https URL without HTTPS-First", async () => {
    const { crawler } = crawlerOn("chrome-error://chromewebdata/", "ERR_CERT_AUTHORITY_INVALID");
    await assert.rejects(
      () => crawler.auditAria("https://self-signed.example.test/"),
      (err) => err.message.includes("ERR_CERT_AUTHORITY_INVALID") && !/HTTPS-First/.test(err.message)
    );
  });

  // What Chrome really shows for http://127.0.0.1:9/: port 9 is on its
  // restricted-port list, so it never even tries to connect.
  it("explains a restricted port without blaming HTTPS-First", () => {
    const message = loadFailureMessage("http://127.0.0.1:9/", "ERR_UNSAFE_PORT");
    assert.match(message, /ERR_UNSAFE_PORT/);
    assert.match(message, /restricted ports/);
    assert.doesNotMatch(message, /HTTPS-First/);
  });

  // chromedriver throws for some failures instead of showing the error page
  // (seen for a refused port and an unresolvable host). Those get the same
  // explanation rather than a bare "unknown error: net::...".
  it("explains a net error thrown by navigation itself", async () => {
    const crawler = new SiteCrawler();
    const { driver } = fakeDriver("https://never.example.test/");
    driver.get = async () => {
      throw new Error("unknown error: net::ERR_CONNECTION_REFUSED\n  (Session info: chrome=140)");
    };
    crawler.driver = driver;
    await assert.rejects(
      () => crawler.auditAria("http://127.0.0.1:59999/"),
      (err) =>
        err.message.startsWith("Chrome could not load http://127.0.0.1:59999/: ERR_CONNECTION_REFUSED") &&
        !/HTTPS-First/.test(err.message)
    );
  });

  it("passes other navigation errors through unchanged", async () => {
    const crawler = new SiteCrawler();
    const { driver } = fakeDriver("https://never.example.test/");
    driver.get = async () => {
      throw new Error("invalid session id");
    };
    crawler.driver = driver;
    await assert.rejects(() => crawler.auditAria("https://x.example.test/"), /^Error: invalid session id$/);
  });

  it("still names an error code it has no explanation for", () => {
    const message = loadFailureMessage("https://x.example.test/", "ERR_SOMETHING_NEW");
    assert.match(message, /ERR_SOMETHING_NEW/);
  });

  it("still fails the load when the error code cannot be read", async () => {
    const crawler = new SiteCrawler();
    const { driver } = fakeDriver("chrome-error://chromewebdata/");
    const real = driver.executeScript;
    driver.executeScript = async (script) => {
      if (script === READ_CHROME_ERROR_CODE) throw new Error("script failed");
      return real(script);
    };
    crawler.driver = driver;
    await assert.rejects(() => crawler.auditAria(url), /error page/i);
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
