import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Builder, WebDriver, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { AnalysisResult } from "./types.js";

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
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
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
  async crawlAndAnalyze(url: string): Promise<AnalysisResult> {
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
    const result = await this.driver.executeAsyncScript<AnalysisResult>(`
      const callback = arguments[arguments.length - 1];
      (async () => {
        try {
          const analyzer = new window.DomAnalyzerBundle.DomAnalyzer();
          await analyzer.init();
          const result = await analyzer.analyzeCurrentPage();
          callback(result);
        } catch (err) {
          callback({ error: err instanceof Error ? err.message : String(err) });
        }
      })();
    `);

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
}
