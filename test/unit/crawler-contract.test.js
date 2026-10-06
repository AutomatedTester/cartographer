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
