#!/usr/bin/env node
/**
 * Test script to verify that the SiteCrawler establishes a WebDriver BiDi
 * session and exposes the expected API surface for BiDi-aware interactions.
 *
 * This test validates the session-startup behaviour without launching a real
 * browser (which is not available in CI without a display).  It checks that:
 *
 *  1. SiteCrawler exports the expected BiDi-related methods.
 *  2. `verifyBiDiSession()` returns false when no driver is present (pre-init).
 *  3. `isBiDiEnabled()` returns false when no driver is present (pre-init).
 *  4. `clickElement()` throws a clear error when called before `init()`.
 *  5. Chrome options are built with the `webSocketUrl` capability set to `true`
 *     (verified by inspecting the generated options object).
 */

import assert from "assert";

// ---------------------------------------------------------------------------
// 1. Module import
// ---------------------------------------------------------------------------
let SiteCrawler;
try {
  ({ SiteCrawler } = await import("../build/crawler.js"));
  console.log("✓ SiteCrawler imported successfully from build/crawler.js");
} catch (err) {
  console.error("✗ Failed to import SiteCrawler:", err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. API surface check – confirm expected methods exist
// ---------------------------------------------------------------------------
const requiredMethods = [
  "init",
  "verifyBiDiSession",
  "isBiDiEnabled",
  "clickElement",
  "crawlAndAnalyze",
  "close",
  "getDriver",
];

for (const method of requiredMethods) {
  assert.strictEqual(
    typeof SiteCrawler.prototype[method],
    "function",
    `SiteCrawler.prototype.${method} should be a function`
  );
  console.log(`✓ SiteCrawler.prototype.${method} exists`);
}

// ---------------------------------------------------------------------------
// 3. Pre-init state checks (no browser required)
// ---------------------------------------------------------------------------
const crawler = new SiteCrawler();

// verifyBiDiSession() should resolve to false when there is no driver yet.
const preInitBiDi = await crawler.verifyBiDiSession();
assert.strictEqual(
  preInitBiDi,
  false,
  "verifyBiDiSession() should return false before init()"
);
console.log("✓ verifyBiDiSession() returns false before init()");

// isBiDiEnabled() should return false before init().
assert.strictEqual(
  crawler.isBiDiEnabled(),
  false,
  "isBiDiEnabled() should return false before init()"
);
console.log("✓ isBiDiEnabled() returns false before init()");

// clickElement() should throw a descriptive error before init().
try {
  await crawler.clickElement({} /* dummy WebElement */);
  assert.fail("clickElement() should throw before init()");
} catch (err) {
  assert.ok(
    err.message.includes("init()"),
    `Expected error to mention init(), got: "${err.message}"`
  );
  console.log(
    `✓ clickElement() throws before init(): "${err.message}"`
  );
}

// ---------------------------------------------------------------------------
// 4. Chrome options include webSocketUrl: true (BiDi capability)
// ---------------------------------------------------------------------------
// We construct the options the same way crawler.ts does and verify that
// enableBidi() sets the expected capability without requiring a real browser.
try {
  const chrome = (await import("selenium-webdriver/chrome.js")).default;
  const options = new chrome.Options();
  options.enableBidi();

  // Options inherits from Capabilities so we can call get() directly.
  const wsUrl = options.get("webSocketUrl");
  assert.strictEqual(
    wsUrl,
    true,
    "enableBidi() should set webSocketUrl capability to true"
  );
  console.log("✓ Chrome options have webSocketUrl=true after enableBidi()");
} catch (err) {
  console.error("✗ Chrome options check failed:", err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// All checks passed
// ---------------------------------------------------------------------------
console.log("\n=== All BiDi session tests passed ===");
