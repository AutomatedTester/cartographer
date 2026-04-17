import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Builder, WebDriver, WebElement, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { AnalysisResult } from "./types.js";
import { SemanticHandlerGenerator } from "./webmcp-semantic-handlers.js";

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

  /** Build and launch a headless Chrome driver with BiDi enabled. */
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
  async crawlAndAnalyze(url: string, intentThreshold: number = 25): Promise<AnalysisResult> {
    if (!this.driver) {
      throw new Error("SiteCrawler is not initialized. Call init() first.");
    }

    // Raise async-script timeout to handle model download on first run.
    await this.driver.manage().setTimeouts({ script: 120_000 });

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
      (async () => {
        try {
          const analyzer = new window.DomAnalyzerBundle.DomAnalyzer();
          await analyzer.init();
          const result = await analyzer.analyzeCurrentPage(intentThreshold);
          callback(result);
        } catch (err) {
          callback({ error: err instanceof Error ? err.message : String(err) });
        }
      })();
    `,
      intentThreshold
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
