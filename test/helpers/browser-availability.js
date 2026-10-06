/**
 * Decides whether browser-driven tests can run, and makes that decision loud.
 *
 * The previous browser scripts caught `session not created` and exited 0, so a
 * broken ChromeDriver was indistinguishable from a passing run. The rule here:
 *
 *   - Chrome usable           → run the tests.
 *   - Chrome absent           → skip, with a reason.
 *   - REQUIRE_BROWSER=1       → never skip; a driver problem is a failure.
 *
 * CI sets REQUIRE_BROWSER=1 so a regression in the crawl path cannot hide
 * behind an environment skip.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Builder } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

let cached = null;
let profileCounter = 0;

/**
 * Chrome options used by both the probe and the tests.
 *
 * Each launch gets its own profile directory under the temp dir. Chrome cannot
 * always create its default profile (restricted CI images, sandboxed shells),
 * and the resulting failure looks exactly like a version mismatch.
 */
export function headlessChromeOptions() {
  profileCounter += 1;
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `webmcp-chrome-${process.pid}-${profileCounter}-`)
  );

  return new chrome.Options()
    .addArguments("--headless=new")
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments("--disable-gpu")
    .addArguments(`--user-data-dir=${userDataDir}`)
    .addArguments("--window-size=1280,900");
}

/**
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
export async function probeBrowser() {
  if (cached) return cached;

  let driver;
  try {
    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(headlessChromeOptions())
      .build();
    await driver.quit();
    driver = null;
    cached = { available: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    cached = { available: false, reason: reason.split("\n")[0] };
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }

  return cached;
}

/** True when the environment demands browser tests actually run. */
export function browserRequired() {
  return process.env.REQUIRE_BROWSER === "1";
}

/**
 * Resolve how a browser suite should proceed.
 *
 * @returns {Promise<{ skip: false } | { skip: string }>} a skip message, or run
 * @throws when the browser is unusable and REQUIRE_BROWSER=1
 */
export async function browserGate() {
  const { available, reason } = await probeBrowser();
  if (available) return { skip: false };

  if (browserRequired()) {
    throw new Error(
      `REQUIRE_BROWSER=1 but Chrome could not start, so this suite cannot be ` +
        `treated as passing. Underlying error: ${reason}`
    );
  }

  return { skip: `Chrome unavailable: ${reason}` };
}
