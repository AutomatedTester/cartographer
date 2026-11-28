import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Builder, WebDriver, WebElement, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { AnalysisResult, AriaAuditReport, AriaSnapshot } from "./types.js";
import { SemanticHandlerGenerator } from "./webmcp-semantic-handlers.js";
import { collectAriaSnapshot } from "./aria-collector.js";
import { ARIA_ROLES, auditAriaSnapshot, failedAriaAudit } from "./aria-auditor.js";
import { envSetting } from "./env.js";

export interface CrawlAnalyzeOptions {
  scriptTimeoutMs?: number;
  pageLoadTimeoutMs?: number;
  analyzerTimeoutMs?: number;
  analyzerInitTimeoutMs?: number;
  /** Attach an ARIA advisory report. Off unless asked for. */
  ariaAudit?: boolean;
}

/**
 * SiteCrawler uses a headless Chrome instance managed by Selenium Manager
 * (no manual chromedriver downloads required) to capture page snapshots.
 *
 * A WebDriver BiDi session is established at startup so that pointer
 * interactions go through the W3C BiDi input module rather than synthetic
 * JavaScript events.  Call {@link verifyBiDiSession} after {@link init} to
 * confirm the connection.
 */
export class SiteCrawler {
  private driver: WebDriver | null = null;
  private biDiEnabled: boolean = false;
  private userDataDir: string | null = null;

  /** Build and launch a headless Chrome driver with BiDi enabled. */
  async init(): Promise<void> {
    const options = new chrome.Options();

    // A dedicated throwaway profile per crawler instance, so concurrent crawls
    // do not contend for the default profile's lock file and no crawl state
    // persists between runs.
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cartographer-chrome-"));

    options.addArguments(
      // Headless unless explicitly asked for a visible browser. This was
      // missing despite the class being documented as headless, so any
      // environment without a display (CI, containers, remote shells) failed
      // with "Chrome instance exited" at session creation.
      ...(envSetting("CARTOGRAPHER_HEADED") === "1" ? [] : ["--headless=new"]),
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
      `--user-data-dir=${this.userDataDir}`,
      "--log-level=3"
      // Deliberately NOT --disable-web-security. It was previously listed here
      // to let the injected analyzer bundle bypass page CSP, but that premise
      // is wrong on two counts:
      //
      //  1. The bundle is injected with driver.executeScript(), which runs via
      //     the WebDriver automation protocol rather than a page <script> tag,
      //     so the page's CSP never applied to it in the first place.
      //  2. Chrome ignores --disable-web-security unless --user-data-dir is
      //     also set, which it was not, so the flag had never taken effect in
      //     any release of this crawler.
      //
      // Turning it on would disable the same-origin policy for a browser that
      // navigates to arbitrary caller-supplied URLs. A hostile page could then
      // read cross-origin responses — cloud metadata endpoints, localhost
      // services — and exfiltrate them. If a future change genuinely needs to
      // relax CSP, scope it with Page.setBypassCSP over CDP or a BiDi preload
      // script instead; both leave the same-origin policy intact.
    );

    // Enable browser-side console log capture
    const prefs = new logging.Preferences();
    prefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);
    options.setLoggingPrefs(prefs);

    // Request a WebDriver BiDi session so pointer actions use the BiDi
    // input module instead of synthetic JavaScript events.
    options.enableBidi();

    this.driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    // Verify the BiDi session was actually established by the browser.
    this.biDiEnabled = await this.verifyBiDiSession();
    if (this.biDiEnabled) {
      console.log("[crawler] WebDriver BiDi session established.");
    } else {
      console.warn(
        "[crawler] WebDriver BiDi session was not established. " +
          "Falling back to classic WebDriver interactions."
      );
    }
  }

  /**
   * Verify that the current driver session has an active WebDriver BiDi
   * connection by inspecting the session capabilities for a `webSocketUrl`.
   *
   * @returns `true` when BiDi is active, `false` otherwise.
   */
  async verifyBiDiSession(): Promise<boolean> {
    if (!this.driver) {
      return false;
    }
    try {
      const caps = await this.driver.getCapabilities();
      const wsUrl = caps.get("webSocketUrl");
      return typeof wsUrl === "string" && wsUrl.length > 0;
    } catch {
      return false;
    }
  }

  /** Returns `true` when the active session has BiDi enabled. */
  isBiDiEnabled(): boolean {
    return this.biDiEnabled;
  }

  /**
   * Perform a real pointer click on a {@link WebElement} using the WebDriver
   * actions API.  This routes through the W3C BiDi input module when BiDi is
   * active, producing genuine OS-level pointer events instead of a synthetic
   * JavaScript `click()` call.
   *
   * @param element The target element to click.
   */
  async clickElement(element: WebElement): Promise<void> {
    if (!this.driver) {
      throw new Error("SiteCrawler is not initialized. Call init() first.");
    }
    await this.driver.actions({ async: true }).click(element).perform();
  }

  /**
   * Navigate to a URL, inject the analyzer bundle, run the ML analysis
   * inside the page, and return the result.
   *
   * The async script timeout is raised to 120 s to account for model
   * download time on the first run.
   */
  async crawlAndAnalyze(
    url: string,
    intentThreshold: number = 25,
    options: CrawlAnalyzeOptions = {}
  ): Promise<AnalysisResult> {
    if (!this.driver) {
      throw new Error("SiteCrawler is not initialized. Call init() first.");
    }

    const scriptTimeoutMs = options.scriptTimeoutMs ?? 120_000;
    const pageLoadTimeoutMs = options.pageLoadTimeoutMs ?? 60_000;
    const analyzerTimeoutMs = options.analyzerTimeoutMs ?? 90_000;
    // Per-device model load timeout (default 5s) — init() fast-fails each backend
    // and falls back to heuristics, completing well inside the outer watchdog.
    const analyzerInitTimeoutMs = options.analyzerInitTimeoutMs ?? 5_000;

    // Raise async-script timeout to handle model download on first run.
    await this.driver.manage().setTimeouts({
      script: scriptTimeoutMs,
      pageLoad: pageLoadTimeoutMs,
    });

    await this.load(url);

    // Read the pre-built browser bundle from disk and inject it into the page.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Next to this file when built; under `npm run dev` (tsx) this file is in
    // src/, and the bundle is still in build/.
    const builtBundle = path.resolve(__dirname, "analyzer.browser.js");
    const bundlePath = fs.existsSync(builtBundle)
      ? builtBundle
      : path.resolve(__dirname, "..", "build", "analyzer.browser.js");
    const bundleSource = fs.readFileSync(bundlePath, "utf-8");
    await this.driver.executeScript(bundleSource + "\nwindow.DomAnalyzerBundle = DomAnalyzerBundle;");

    // Run the analysis asynchronously inside the page.
    // Selenium passes the done-callback as the last element of `arguments`.
    const result = await this.driver.executeAsyncScript<AnalysisResult>(
      `
      const callback = arguments[arguments.length - 1];
      const intentThreshold = arguments[0];
      const analyzerTimeoutMs = arguments[1];
      const analyzerInitTimeoutMs = arguments[2];
      let done = false;

      const finish = (payload) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(watchdog);
        callback(payload);
      };

      const watchdog = setTimeout(() => {
        finish({
          url: window.location.href,
          title: document.title || 'Untitled',
          highIntentElements: [],
          generatedTestCases: [],
          consoleLogs: [],
          error: 'Analyzer execution timed out after ' + analyzerTimeoutMs + 'ms',
        });
      }, analyzerTimeoutMs);

      const withTimeout = (promise, ms, label) =>
        Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms)
          ),
        ]);

      (async () => {
        try {
          const analyzer = new window.DomAnalyzerBundle.DomAnalyzer();
          // Give init() generously more time than the per-device inner timeout
          // (devices × inner timeout + slack) so the heuristic fallback can run.
          const numDevices = 3; // webnn, webgpu, wasm
          const initOuterMs = analyzerInitTimeoutMs * numDevices + 5000;
          await withTimeout(
            analyzer.init({ modelLoadTimeoutMs: analyzerInitTimeoutMs }),
            initOuterMs,
            'Analyzer initialization'
          );
          const result = await analyzer.analyzeCurrentPage(intentThreshold);
          finish(result);
        } catch (err) {
          finish({
            url: window.location.href,
            title: document.title || 'Untitled',
            highIntentElements: [],
            generatedTestCases: [],
            consoleLogs: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    `,
      intentThreshold,
      analyzerTimeoutMs,
      analyzerInitTimeoutMs
    );

    // Inject semantic webmcp tool handlers for the discovered high-intent elements
    if (result.highIntentElements && result.highIntentElements.length > 0) {
      const handlerCode = SemanticHandlerGenerator.generateHandlerCode(result.highIntentElements);
      await this.driver.executeScript(handlerCode);

      // Log which tools were registered
      const registeredTools = await this.driver.executeScript<string[]>(
        `return navigator.webmcp?.registeredTools || [];`
      );
      console.log(`[crawler] Registered ${registeredTools.length} semantic tools:`, registeredTools);
    }

    // Collect browser console logs and attach them to the result.
    const rawLogs = await this.driver.manage().logs().get(logging.Type.BROWSER);
    result.consoleLogs = rawLogs.map(
      (entry) => `[${entry.level.name}] ${entry.message}`
    );

    if (options.ariaAudit) {
      result.ariaAudit = await this.auditCurrentPage();
    }

    return result;
  }

  /**
   * Navigate to a URL and produce an ARIA advisory report for it. Does not
   * load the ML model or run the test-candidate analysis.
   */
  async auditAria(url: string, pageLoadTimeoutMs: number = 60_000): Promise<AriaAuditReport> {
    if (!this.driver) {
      throw new Error("SiteCrawler is not initialized. Call init() first.");
    }
    await this.driver.manage().setTimeouts({ pageLoad: pageLoadTimeoutMs });
    await this.load(url);
    return this.auditCurrentPage();
  }

  /**
   * Navigate, and fail if Chrome could not load the page. Chrome reports a
   * failed load (DNS, refused connection, bad certificate) by showing its own
   * error page rather than by throwing, and analysing that page would record
   * the site as a real page with nothing on it.
   */
  private async load(url: string): Promise<void> {
    const driver = this.driver!;
    try {
      await driver.get(url);
    } catch (err) {
      // chromedriver throws "unknown error: net::ERR_..." for some failures
      // (a refused port, an unresolvable host) instead of showing the page.
      const thrown = err instanceof Error ? err.message : String(err);
      const netError = thrown.match(/net::(ERR_[A-Z0-9_]+)/);
      if (netError) throw new Error(loadFailureMessage(url, netError[1]));
      throw err;
    }
    // Ask the page: chromedriver's getCurrentUrl() reports the URL requested
    // even while Chrome is showing its error page.
    const landedOn = String(await driver.executeScript("return window.location.href"));
    if (landedOn.startsWith("chrome-error:")) {
      // The error page names its net error (ERR_CONNECTION_REFUSED and so
      // on). Reading it is best effort: the load has failed either way.
      const errorCode = await driver
        .executeScript<string | null>(READ_CHROME_ERROR_CODE)
        .catch(() => null);
      throw new Error(loadFailureMessage(url, errorCode));
    }
  }

  /**
   * ARIA advisory for whatever page the driver is on. The advisory must never
   * break a crawl, so a failure becomes a report carrying the error.
   */
  private async auditCurrentPage(): Promise<AriaAuditReport> {
    const driver = this.driver!;
    try {
      const snapshot = await driver.executeScript<AriaSnapshot>(collectAriaSnapshot, [...ARIA_ROLES]);
      return auditAriaSnapshot(snapshot);
    } catch (err) {
      const url = await driver.getCurrentUrl().catch(() => "");
      return failedAriaAudit(url, err);
    }
  }

  /** Quit the browser and release resources. */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
    // Remove the throwaway profile. Best effort: a leaked temp directory must
    // not turn into a failed crawl.
    if (this.userDataDir) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this.userDataDir = null;
    }
  }

  /** Get the underlying WebDriver instance for advanced operations */
  getDriver(): WebDriver | null {
    return this.driver;
  }
}

/**
 * Script that reads the net error code off Chrome's error page, or null. The
 * page shows it in an `.error-code` element ("ERR_CONNECTION_REFUSED"), and a
 * certificate interstitial shows it as "NET::ERR_CERT_..." in its text.
 */
export const READ_CHROME_ERROR_CODE = `
  const pattern = /(?:NET::)?ERR_[A-Z0-9_]+/;
  const el = document.querySelector('.error-code, #error-code');
  const fromElement = el && el.textContent ? el.textContent.match(pattern) : null;
  if (fromElement) return fromElement[0];
  const fromText = document.body ? (document.body.innerText || '').match(pattern) : null;
  return fromText ? fromText[0] : null;
`;

/** Plain-language meaning of the net errors a crawl is likely to meet. */
const NET_ERROR_MEANINGS: Record<string, string> = {
  ERR_CONNECTION_REFUSED: "the connection was refused; nothing is listening at that address and port",
  ERR_UNSAFE_PORT: "Chrome will not connect to this port; it is on Chrome's list of restricted ports",
  ERR_NAME_NOT_RESOLVED: "the host name could not be resolved; the DNS lookup failed",
  ERR_NAME_RESOLUTION_FAILED: "the host name could not be resolved; the DNS lookup failed",
  ERR_ADDRESS_UNREACHABLE: "the address is unreachable from this machine",
  ERR_INTERNET_DISCONNECTED: "this machine is not connected to the internet",
  ERR_CONNECTION_TIMED_OUT: "the connection timed out; the server did not answer",
  ERR_TIMED_OUT: "the request timed out",
  ERR_CONNECTION_RESET: "the connection was reset by the server",
  ERR_CONNECTION_CLOSED: "the server closed the connection without a response",
  ERR_EMPTY_RESPONSE: "the server closed the connection without sending anything",
  ERR_SSL_PROTOCOL_ERROR: "the TLS handshake failed",
  ERR_SSL_VERSION_OR_CIPHER_MISMATCH: "the TLS handshake failed; there is no common protocol version or cipher",
  ERR_TOO_MANY_REDIRECTS: "the page redirects in a loop",
  ERR_BLOCKED_BY_CLIENT: "the request was blocked by the browser",
};

/** Is this net error about TLS (certificate or handshake)? */
function isTlsError(code: string): boolean {
  return /^ERR_(CERT_|SSL_|BAD_SSL_)/.test(code);
}

/**
 * Why a page load ended on Chrome's error page, naming Chrome's net error when
 * the page showed one. HTTPS-First is blamed only where it can be the cause:
 * an http:// URL whose failure is about TLS (Chrome tried https:// first and
 * the certificate or handshake failed), or, when the cause is unknown, as a
 * hint for http-only sites.
 */
export function loadFailureMessage(url: string, errorCode?: string | null): string {
  const httpsFirst =
    "Chrome's HTTPS-First mode tries https:// first, so an http-only site whose" +
    " https:// address fails (for example, a certificate for another name) cannot be crawled.";
  const isHttp = url.startsWith("http:");
  const code = errorCode ? errorCode.replace(/^NET::/, "").trim() : "";

  if (!code) {
    let message = `Chrome could not load ${url} and showed its error page instead.`;
    if (isHttp) message += ` If the site is http-only: ${httpsFirst}`;
    return message;
  }

  const meaning = isTlsError(code)
    ? code.startsWith("ERR_CERT_")
      ? "the site's TLS certificate was rejected"
      : NET_ERROR_MEANINGS[code] ?? "the TLS handshake failed"
    : NET_ERROR_MEANINGS[code];
  let message =
    `Chrome could not load ${url}: ${code}` +
    (meaning ? ` (${meaning})` : "") +
    ".";
  if (isHttp && isTlsError(code)) message += ` ${httpsFirst}`;
  return message;
}
