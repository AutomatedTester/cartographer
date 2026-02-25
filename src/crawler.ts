import { Builder, By, WebDriver, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

/** Simplified representation of a DOM element for model consumption. */
export interface DomElement {
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  ariaLabel?: string;
  text?: string;
  hasShadowRoot?: boolean;
  isIframe?: boolean;
  children?: DomElement[];
}

/** The full snapshot returned by the crawler. */
export interface PageSnapshot {
  url: string;
  title: string;
  dom: DomElement[];
  consoleLogs: string[];
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
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--log-level=3"
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

  /** Navigate to a URL and return a cleaned PageSnapshot. */
  async getPageSnapshot(url: string): Promise<PageSnapshot> {
    if (!this.driver) {
      throw new Error("SiteCrawler is not initialized. Call init() first.");
    }

    await this.driver.get(url);

    const title = await this.driver.getTitle();

    // Extract a simplified JSON DOM via in-page script
    const dom: DomElement[] = await this.driver.executeScript<DomElement[]>(
      extractDomScript
    );

    // Collect browser console logs
    const rawLogs = await this.driver
      .manage()
      .logs()
      .get(logging.Type.BROWSER);
    const consoleLogs = rawLogs.map(
      (entry) => `[${entry.level.name}] ${entry.message}`
    );

    return { url, title, dom, consoleLogs };
  }

  /** Quit the browser and release resources. */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
  }
}

/**
 * Inline script that runs inside the browser to extract a simplified DOM tree.
 * Depth is capped at 5 levels to keep the payload manageable for the model.
 */
const extractDomScript = `
  const MAX_DEPTH = 5;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD']);

  function extractNode(el, depth) {
    if (!el || depth > MAX_DEPTH) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const node = {
      tag: el.tagName.toLowerCase(),
    };

    if (el.id) node.id = el.id;

    const classes = Array.from(el.classList || []);
    if (classes.length) node.classes = classes;

    const role = el.getAttribute('role');
    if (role) node.role = role;

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) node.ariaLabel = ariaLabel;

    const text = (el.textContent || '').trim().slice(0, 120);
    if (text) node.text = text;

    if (el.shadowRoot) node.hasShadowRoot = true;
    if (el.tagName === 'IFRAME') node.isIframe = true;

    const childElements = Array.from(el.children || []);
    const children = childElements
      .map(child => extractNode(child, depth + 1))
      .filter(Boolean);
    if (children.length) node.children = children;

    return node;
  }

  return Array.from(document.body ? document.body.children : [])
    .map(child => extractNode(child, 1))
    .filter(Boolean);
`;
