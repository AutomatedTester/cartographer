import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Builder, WebDriver, logging } from "selenium-webdriver";
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
 */
export class SiteCrawler {
  private driver: WebDriver | null = null;

  /** Build and launch a headless Chrome driver. */
  async init(): Promise<void> {
    const options = new chrome.Options();
    options.addArguments(
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--log-level=3",
      // Allow injected scripts to bypass Content-Security-Policy headers
      "--disable-web-security"
    );

    // Enable browser-side console log capture
    const prefs = new logging.Preferences();
    prefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);
    options.setLoggingPrefs(prefs);

    this.driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();
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
  }

  /** Get the underlying WebDriver instance for advanced operations */
  getDriver(): WebDriver | null {
    return this.driver;
  }
}
