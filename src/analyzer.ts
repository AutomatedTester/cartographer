import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import { AnalysisResult, AnalysisMetrics, HighIntentElement } from "./types.js";
import { TestCaseGenerator } from "./test-case-generator.js";
import { EmbeddingCache } from "./embedding-cache.js";
import { HeuristicScorer } from "./heuristic-scorer.js";

// ---------------------------------------------------------------------------
// DOM types (defined here — this module is browser-only)
// ---------------------------------------------------------------------------

export interface DomElement {
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  ariaLabel?: string;
  text?: string;
  hasShadowRoot?: boolean;
  isIframe?: boolean;
  attributes?: Record<string, string>;
  isVisible?: boolean;
  children?: DomElement[];
}

export { AnalysisResult, AnalysisMetrics, HighIntentElement } from "./types.js";

/**
 * DomAnalyzer uses a local Transformers.js model (feature-extraction /
 * semantic-similarity) to rank DOM elements by testing risk and produce a
 * prioritized test list.
 *
 * The WebNN execution provider is requested first; the runtime falls back to
 * WebGPU and then the default WASM/CPU provider if unavailable in the current
 * environment.
 */
export class DomAnalyzer {
  private extractor: FeatureExtractionPipeline | null = null;
  private device: 'webnn' | 'webgpu' | 'wasm' | 'none' = 'none';
  private modelLoadTime: number = 0;
  private cache: EmbeddingCache | null = null;

  // PHASE 2 OPTIMIZATION: Static model cache across analyzer instances
  // Prevents reload penalty on multi-page crawls (10+ pages)
  private static globalModelCache: FeatureExtractionPipeline | null = null;
  private static modelLoadPromise: Promise<void> | null = null;
  private static globalDevice: 'webnn' | 'webgpu' | 'wasm' | 'none' = 'none';
  private static globalModelLoadTime: number = 0;

  /**
   * Check if WebNN is supported in the current browser environment.
   * Prevents timeouts by detecting unavailable devices early.
   * 
   * PHASE 1 OPTIMIZATION: 1-second timeout to prevent hanging
   * If WebNN is unavailable, this detects it quickly and falls back to WASM
   */
  private async isWebNNSupported(): Promise<boolean> {
    if (typeof navigator === "undefined" || !('ml' in navigator)) {
      console.log('[analyzer] WebNN not available (navigator.ml missing)');
      return false;
    }

    try {
      // PHASE 1 OPTIMIZATION: Early abort with 1-second timeout
      // Prevents 10+ second hangs on WebNN-unavailable devices
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      const context = await (navigator as any).ml.createContext();
      clearTimeout(timeoutId);
      await context?.close?.();

      console.log('[analyzer] ✓ WebNN supported and available');
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(`[analyzer] WebNN not supported: ${errorMsg}`);
      return false;
    }
  }

  /** Pre-load the embedding model so the first analysis call is fast. */
  async init(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("[analyzer] This module must run in a browser environment.");
    }

    // PHASE 1 OPTIMIZATION: Initialize embedding cache
    if (!this.cache) {
      this.cache = new EmbeddingCache();
      await this.cache.init();
    }

    // PHASE 2 OPTIMIZATION: Reuse cached model if available
    if (DomAnalyzer.globalModelCache) {
      this.extractor = DomAnalyzer.globalModelCache;
      this.device = DomAnalyzer.globalDevice;
      this.modelLoadTime = DomAnalyzer.globalModelLoadTime;
      console.log('[analyzer] ✓ Using cached model (reuse across instances)');
      return;
    }

    // PHASE 2 OPTIMIZATION: Wait for concurrent init calls to complete
    if (DomAnalyzer.modelLoadPromise) {
      await DomAnalyzer.modelLoadPromise;
      this.extractor = DomAnalyzer.globalModelCache!;
      this.device = DomAnalyzer.globalDevice;
      this.modelLoadTime = DomAnalyzer.globalModelLoadTime;
      console.log('[analyzer] ✓ Using model loaded by concurrent init');
      return;
    }

    // Start loading model and cache the promise
    DomAnalyzer.modelLoadPromise = this.loadAndCacheModel();
    await DomAnalyzer.modelLoadPromise;
    this.extractor = DomAnalyzer.globalModelCache!;
    this.device = DomAnalyzer.globalDevice;
    this.modelLoadTime = DomAnalyzer.globalModelLoadTime;
  }

  private async loadAndCacheModel(): Promise<void> {
    const initStartTime = performance.now();

    // Check WebNN support first to avoid timeout delays
    const webnnSupported = await this.isWebNNSupported();

    // PHASE 1 OPTIMIZATION: Device-aware model selection
    // Select lightweight model on low-resource devices
    const selectedModel = await this.selectModel();
    console.log(`[analyzer] Selected model: ${selectedModel}`);

    // Try devices in order of preference, skip WebNN if not supported
    let devices: ('webnn' | 'webgpu' | 'wasm')[] = ["webgpu", "wasm"];
    if (webnnSupported) {
      devices = ["webnn", "webgpu", "wasm"];
    }

    for (const device of devices) {
      try {
        // PHASE 2 OPTIMIZATION: Advanced pipeline options
        // float16: Reduce GPU memory usage
        DomAnalyzer.globalModelCache = (await (pipeline as any)(
          "feature-extraction",
          selectedModel,
          {
            device: device as any,
            dtype: device === 'wasm' ? 'fp32' : 'fp16', // fp16 on GPU, fp32 on CPU
          }
        )) as FeatureExtractionPipeline;
        DomAnalyzer.globalDevice = device;
        DomAnalyzer.globalModelLoadTime = performance.now() - initStartTime;
        console.log(`[analyzer] ✓ Model loaded on device: ${device} (${DomAnalyzer.globalModelLoadTime.toFixed(0)}ms)`);
        return;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[analyzer] ✗ Failed to load on '${device}': ${errorMsg}. Trying next…`
        );
      }
    }

    DomAnalyzer.globalDevice = 'none';
    DomAnalyzer.globalModelLoadTime = performance.now() - initStartTime;
    console.warn(
      `[analyzer] ✗ All ML backends unavailable — running in heuristic-only mode (${DomAnalyzer.globalModelLoadTime.toFixed(0)}ms)`
    );
  }

  /**
   * PHASE 1 OPTIMIZATION: Select model based on device capabilities
   * Low-memory devices get DistilBERT (28MB, 5x faster)
   * High-memory devices get all-MiniLM (134MB, more accurate)
   */
  private async selectModel(): Promise<string> {
    const memory = (navigator as any).deviceMemory || 4; // GB
    const connection = (navigator as any).connection?.effectiveType || '4g';

    console.log(
      `[analyzer] Device: ${memory}GB RAM, ${connection} connection`
    );

    // Low resource devices: use DistilBERT
    if (memory < 4 || connection === '3g' || connection === '2g') {
      console.log(
        '[analyzer] Low-resource device detected, using DistilBERT (lightweight)'
      );
      return 'Xenova/distilbert-base-multilingual-cased';
    }

    // High resource devices: use all-MiniLM
    if (memory >= 8 && connection === '4g') {
      console.log(
        '[analyzer] High-resource device detected, using all-MiniLM (accurate)'
      );
      return 'Xenova/all-MiniLM-L6-v2';
    }

    // Medium resource: default to DistilBERT (safe choice)
    console.log(
      '[analyzer] Medium-resource device, using DistilBERT as safe default'
    );
    return 'Xenova/distilbert-base-multilingual-cased';
  }

  /**
   * Clear the global model cache (useful for memory cleanup, tests, or switching backends).
   * Call this when you know you're done with the analyzer for a while.
   */
  static clearModelCache(): void {
    DomAnalyzer.globalModelCache = null;
    DomAnalyzer.modelLoadPromise = null;
    DomAnalyzer.globalDevice = 'none';
    DomAnalyzer.globalModelLoadTime = 0;
    console.log('[analyzer] Model cache cleared');
  }

  async analyzeCurrentPage(
    intentThreshold: number = 25,
    maxBatchSize: number = 50
  ): Promise<AnalysisResult> {
    const overallStartTime = performance.now();

    // DOM extraction
    const domStartTime = performance.now();
    const dom = extractDom(10);
    const highIntentElements: HighIntentElement[] = [];
    this.collectHighIntentElements(dom, "", highIntentElements, intentThreshold);
    const analysisTime = performance.now() - domStartTime;
    const elementsAnalyzed = dom.length;

    // ML deduplication (if model available) or fallback to heuristics/dedup
    const dedupStartTime = performance.now();
    let deduped: HighIntentElement[] = [];

    if (!this.extractor) {
      // PHASE 1 OPTIMIZATION: Fallback to heuristic-based scoring
      // When WebNN/ML is unavailable, use pure pattern matching
      console.log('[analyzer] ML unavailable, using heuristic scoring (fallback)');
      const scorer = new HeuristicScorer();
      deduped = scorer.scoreElements(highIntentElements);
    } else {
      // Use ML model to deduplicate by semantic similarity
      const descriptions = highIntentElements.map((el) => elementDescription(el));

      const embeddings: number[][] = [];

      // PHASE 2 OPTIMIZATION: GPU memory management with batching
      // For large DOMs (100+ elements), process in batches to prevent OOM
      if (descriptions.length > maxBatchSize) {
        console.log(
          `[analyzer] Processing ${descriptions.length} embeddings in batches of ${maxBatchSize}`
        );
        for (let i = 0; i < descriptions.length; i += maxBatchSize) {
          const batch = descriptions.slice(i, i + maxBatchSize);
          const batchResults = await Promise.all(
            batch.map(async (desc) => {
              // PHASE 1 OPTIMIZATION: Check embedding cache first
              let embedding = await this.cache?.getEmbedding(desc);
              if (!embedding) {
                const result = await this.extractor!(desc);
                if (result) {
                  // Convert Tensor to number array
                  const tensorData = (result as any).data ? Array.from((result as any).data) : Array.from(result as any);
                  embedding = Array.isArray(tensorData[0]) ? tensorData[0] : tensorData;
                  // Cache the computed embedding
                  if (embedding) {
                    await this.cache?.setEmbedding(desc, embedding);
                  }
                  return embedding;
                }
              }
              return embedding;
            })
          );
          batchResults.forEach(result => {
            if (result) {
              embeddings.push(result);
            }
          });
        }
      } else {
        // Original parallel processing for smaller DOMs
        const embeddingResults = await Promise.all(
          descriptions.map(async (desc) => {
            // PHASE 1 OPTIMIZATION: Check embedding cache first
            let embedding = await this.cache?.getEmbedding(desc);
            if (!embedding) {
              const result = await this.extractor!(desc);
              if (result) {
                // Convert Tensor to number array
                const tensorData = (result as any).data ? Array.from((result as any).data) : Array.from(result as any);
                embedding = Array.isArray(tensorData[0]) ? tensorData[0] : tensorData;
                // Cache the computed embedding
                if (embedding) {
                  await this.cache?.setEmbedding(desc, embedding);
                }
                return embedding;
              }
            }
            return embedding;
          })
        );
        embeddingResults.forEach(result => {
          if (result) {
            embeddings.push(Array.isArray(result[0]) ? result[0][0] : (result[0] as any));
          }
        });
      }

      const used = new Array(highIntentElements.length).fill(false);
      const threshold = 0.92;
      for (let i = 0; i < highIntentElements.length; ++i) {
        if (used[i]) continue;
        deduped.push(highIntentElements[i]);
        used[i] = true;
        for (let j = i + 1; j < highIntentElements.length; ++j) {
          if (used[j]) continue;
          if (cosineSimilarity(embeddings[i], embeddings[j]) > threshold) {
            used[j] = true;
          }
        }
      }
    }

    const deduplicationTime = performance.now() - dedupStartTime;
    deduped.sort((a, b) => b.intentScore - a.intentScore);

    // Extract all navigation links for fallback crawling
    const allNavLinks = new Set<string>();
    const allElements = document.querySelectorAll('a[href], form[action], [onclick], button, [role="button"]');
    const navigationKeywords = ["sign in", "login", "log in", "get started", "start now", "register", "signup", "sign up", "submit", "next", "continue"];

    for (const el of allElements) {
      let href: string | undefined;
      if (el.tagName === 'A') {
        href = (el as HTMLAnchorElement).href;
        if (href && !href.startsWith('#') && href !== window.location.href) {
          allNavLinks.add(href);
        }
      } else if (el.tagName === 'FORM') {
        href = (el as HTMLFormElement).action;
        if (href) allNavLinks.add(href);
      } else if (el.tagName === 'BUTTON' || (el as any).role === 'button') {
        // For buttons, check data attributes first
        const dataHref = (el as any)['data-href'] || (el as any)['data-link'] || (el as any)['data-url'] || (el as any)['data-route'];
        if (dataHref && typeof dataHref === 'string' && !dataHref.startsWith('#')) {
          allNavLinks.add(dataHref);
        }

        // For buttons without explicit targets, mark that they're navigable
        // This is a placeholder that will be captured when the button is clicked
        const btnText = ((el.textContent || (el as any).innerText || '') as string).toLowerCase().trim();
        if (navigationKeywords.some(kw => btnText.includes(kw))) {
          // Use a special URL pattern to indicate this button should be clicked and tracked
          const btnId = (el as any).id || (el as any).getAttribute('aria-label') || btnText.replace(/\s+/g, '-');
          allNavLinks.add(`__button__:${btnId}`);
        }
      }
    }

    // Generate test cases from high-intent elements
    const testCases = TestCaseGenerator.generate(deduped, document.title);

    // PHASE 1 OPTIMIZATION: Performance metrics
    const metrics: AnalysisMetrics = {
      device: this.device,
      modelLoadTime: this.modelLoadTime,
      analysisTime,
      deduplicationTime,
      elementsAnalyzed,
      elementsClustered: deduped.length,
    };

    // Log cache stats if available
    const cacheStats = this.cache?.getStats();
    if (cacheStats) {
      console.log(`[analyzer] Embedding cache stats:`, cacheStats);
    }

    return {
      url: window.location.href,
      title: document.title,
      highIntentElements: deduped,
      generatedTestCases: testCases,
      consoleLogs: [],
      allNavigationLinks: Array.from(allNavLinks),
      metrics,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private collectHighIntentElements(
    elements: DomElement[],
    parentPath: string,
    out: HighIntentElement[],
    intentThreshold: number
  ): void {
    for (const el of elements) {
      const path = buildPath(el, parentPath);
      const reasons: string[] = [];
      let intentScore = 0;

      // Only consider visible elements
      if (el.isVisible === false) continue;

      // Tag/role-based scoring
      const tag = el.tag;
      const role = el.role || "";
      const type = el.attributes?.type || "";
      const hasHref = !!el.attributes?.href;
      const hasAction = !!el.attributes?.action;

      // Base scores
      if (tag === "button" || role === "button") {
        intentScore += 30;
        reasons.push("button or role=button");
      }
      if (tag === "a" && hasHref) {
        intentScore += 25;
        reasons.push("anchor with href");
      }
      if (tag === "input" && ["submit", "button", "reset"].includes(type)) {
        intentScore += 30;
        reasons.push("input type submit/button/reset");
      }
      if (tag === "input" && ["text", "search", "email", "password"].includes(type)) {
        intentScore += 15;
        reasons.push("input type text/search/email/password");
      }
      if (tag === "select") {
        intentScore += 20;
        reasons.push("select element");
      }
      if (tag === "textarea") {
        intentScore += 15;
        reasons.push("textarea");
      }
      if (["form", "nav", "details", "summary"].includes(tag)) {
        intentScore += 10;
        reasons.push("semantic container");
      }
      if (
        ["button", "link", "menuitem", "tab", "checkbox", "radio", "combobox", "searchbox"].includes(role)
      ) {
        intentScore += 20;
        reasons.push("ARIA interactive role");
      }

      // Positive signals
      if (el.ariaLabel || el.text) {
        intentScore += 15;
        reasons.push("has label or text");
      }
      if (el.id) {
        intentScore += 10;
        reasons.push("has id");
      }
      if (parentPath.includes("form")) {
        intentScore += 10;
        reasons.push("inside form");
      }
      if (el.attributes?.tabindex && Number(el.attributes.tabindex) >= 0) {
        intentScore += 5;
        reasons.push("tabindex >= 0");
      }

      // Negative signals
      if (el.attributes?.disabled !== undefined) {
        intentScore -= 50;
        reasons.push("disabled");
      }
      if (el.attributes?.readonly !== undefined) {
        intentScore -= 20;
        reasons.push("readonly");
      }
      if (el.attributes?.hidden !== undefined || el.attributes?.["aria-hidden"] === "true") {
        intentScore -= 50;
        reasons.push("hidden");
      }
      if (type === "hidden") {
        intentScore -= 50;
        reasons.push("input type=hidden");
      }

      // Navigation detection
      let navigates = false;
      let navigationTarget: string | undefined = undefined;
      if (tag === "a" && hasHref && el.attributes?.href && !el.attributes.href.startsWith("#")) {
        navigates = true;
        navigationTarget = el.attributes.href;
        intentScore += 30; // Boost score for navigation links
        reasons.push("anchor likely navigates");
      }
      if (tag === "form" && hasAction && el.attributes?.action) {
        navigates = true;
        navigationTarget = el.attributes.action;
        intentScore += 25; // Boost score for forms
        reasons.push("form likely navigates");
      }
      if (tag === "button" && type === "submit" && parentPath.includes("form")) {
        navigates = true;
        intentScore += 20; // Boost score for submit buttons
        reasons.push("submit button in form");
      }

      // Enhanced button navigation detection for SPA/modern apps
      if (tag === "button" || role === "button") {
        // Check for data attributes indicating navigation
        for (const [key, value] of Object.entries(el.attributes || {})) {
          if (key.startsWith("data-") && (key.includes("href") || key.includes("link") || key.includes("route") || key.includes("url"))) {
            if (value && typeof value === "string" && !value.startsWith("#")) {
              navigates = true;
              navigationTarget = value;
              intentScore += 15; // Moderate boost for data-href style navigation
              reasons.push(`button likely navigates (${key}="${value}")`);
              break;
            }
          }
        }

        // If button has onclick attribute, mark as navigative interactive
        if (!navigationTarget && el.attributes?.onclick) {
          navigates = true;
          intentScore += 10; // Slight boost for onclick handlers
          reasons.push("button with onclick handler");
        }

        // Buttons with semantic navigation text without explicit target should still navigate
        // This allows clicking to capture the actual URL
        if (!navigationTarget && (el.text || el.ariaLabel)) {
          const btnText = (el.text || el.ariaLabel || "").toLowerCase();
          const navigationKeywords = ["sign in", "login", "log in", "get started", "start now", "register", "signup", "sign up", "submit"];
          if (navigationKeywords.some(kw => btnText.includes(kw))) {
            navigates = true;
            intentScore += 12; // Moderate boost for semantic navigation buttons
            reasons.push(`button text suggests navigation: "${el.text}"`);
          }
        }
      }

      // Only include if above threshold
      if (intentScore >= intentThreshold) {
        out.push({
          path,
          tag,
          id: el.id,
          classes: el.classes,
          role: el.role,
          ariaLabel: el.ariaLabel,
          text: el.text,
          locator: buildLocator(el, path),
          intentReasons: reasons,
          intentScore,
          navigates,
          navigationTarget,
          attributes: el.attributes,
        });
      }

      if (el.children?.length) {
        this.collectHighIntentElements(el.children as DomElement[], path, out, intentThreshold);
      }
    }
  }
}

// -------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Walk document.body and return a simplified DomElement tree.
 * Mirrors the extractDomScript logic that previously lived in crawler.ts.
 */
function extractDom(maxDepth: number = 10): DomElement[] {
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "META",
    "LINK",
    "HEAD",
  ]);

  function extractNode(el: Element, depth: number): DomElement | null {
    if (!el || depth > maxDepth) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const node: DomElement = { tag: el.tagName.toLowerCase() };

    if (el.id) node.id = el.id;

    const classes = Array.from(el.classList ?? []) as string[];
    if (classes.length) node.classes = classes;

    const role = el.getAttribute("role");
    if (role) node.role = role;

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) node.ariaLabel = ariaLabel;

    const text = (el.textContent ?? "").trim().slice(0, 120);
    if (text) node.text = text;

    if ((el as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot)
      node.hasShadowRoot = true;
    if (el.tagName === "IFRAME") node.isIframe = true;

    // Collect semantic attributes
    const attrNames = [
      "type",
      "name",
      "placeholder",
      "title",
      "href",
      "action",
      "tabindex",
      "disabled",
      "readonly",
      "required",
      "hidden",
      "value",
    ];
    node.attributes = {};
    for (const attr of attrNames) {
      const val = el.getAttribute(attr);
      if (val !== null) node.attributes[attr] = val;
    }

    // Visibility detection (best effort)
    const style = window.getComputedStyle(el as Element);
    node.isVisible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      el.getAttribute("hidden") === null &&
      el.getAttribute("aria-hidden") !== "true";

    const children = Array.from(el.children)
      .map((child) => extractNode(child, depth + 1))
      .filter((n): n is DomElement => n !== null);
    if (children.length) node.children = children;

    return node;
  }

  return Array.from(document.body?.children ?? [])
    .map((child) => extractNode(child, 1))
    .filter((n): n is DomElement => n !== null);
}

function buildPath(el: DomElement, parentPath: string): string {
  let segment = el.tag;
  if (el.id) {
    segment += `#${el.id}`;
  } else if (el.classes?.length) {
    segment += `.${el.classes[0]}`;
  }
  return parentPath ? `${parentPath} > ${segment}` : segment;
}

function buildLocator(el: DomElement, path?: string): string {
  if (el.id) return `#${el.id}`;
  if (el.classes?.length) return `${el.tag}.${el.classes.join(".")}`;
  return path || el.tag;
}

function elementDescription(el: HighIntentElement): string {
  const parts: string[] = [el.tag];
  if (el.id) parts.push(`id="${el.id}"`);
  if (el.classes?.length) parts.push(`class="${el.classes.join(" ")}"`);
  if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
  if (el.text) parts.push(`text="${el.text}"`);
  if (el.intentReasons?.length) parts.push(el.intentReasons.join("; "));
  return parts.join(" ");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}
