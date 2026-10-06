import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Builder, WebDriver, WebElement, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { AnalysisResult } from "./types.js";
import { SemanticHandlerGenerator } from "./webmcp-semantic-handlers.js";

export interface CrawlAnalyzeOptions {
  scriptTimeoutMs?: number;
  pageLoadTimeoutMs?: number;
  analyzerTimeoutMs?: number;
  analyzerInitTimeoutMs?: number;
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

    // A dedicated profile per crawler instance. Two reasons:
    //  1. Chrome ignores --disable-web-security unless --user-data-dir is also
    //     set, so without this the CSP bypass below silently does nothing.
    //  2. Concurrent crawls would otherwise contend for the default profile's
    //     lock file.
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-chrome-"));

    options.addArguments(
      // Headless unless explicitly asked for a visible browser. This was
      // missing despite the class being documented as headless, so any
      // environment without a display (CI, containers, remote shells) failed
      // with "Chrome instance exited" at session creation.
      ...(process.env.WEBMCP_HEADED === "1" ? [] : ["--headless=new"]),
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
      `--user-data-dir=${this.userDataDir}`,
      "--log-level=3",
      // Allows the injected analyzer bundle to bypass CSP headers set by the
      // target page. Risk: cross-origin protections are disabled for this
      // session. A safer alternative is to deliver the bundle as a Chrome
      // extension or via BiDi addInitScript, which is CSP-exempt by design.
      "--disable-web-security"
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

    await this.driver.get(url);

    // Read the pre-built browser bundle from disk and inject it into the page.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const bundlePath = path.resolve(__dirname, "analyzer.browser.js");
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

    return result;
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
