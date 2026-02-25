import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import { AnalysisResult, RiskyElement, TestCandidate } from "./types.js";

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
  children?: DomElement[];
}

export { AnalysisResult, RiskyElement, TestCandidate } from "./types.js";

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

  /** Pre-load the embedding model so the first analysis call is fast. */
  async init(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("[analyzer] This module must run in a browser environment.");
    }
    // Try WebNN → WebGPU in order of preference (browser-only execution providers).
    for (const device of ["webnn", "webgpu"] as const) {
      try {
        this.extractor = (await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
          { device }
        )) as FeatureExtractionPipeline;
        console.log(`[analyzer] Model loaded on device: ${device}`);
        return;
      } catch {
        console.warn(
          `[analyzer] Device '${device}' unavailable, trying next…`
        );
      }
    }
    throw new Error("[analyzer] Could not load model. A browser with WebNN or WebGPU support is required.");
  }

  /**
   * Extract the current page's DOM, score elements, and return a prioritized
   * list of test candidates. Must be called from inside a browser page.
   */
  async analyzeCurrentPage(): Promise<AnalysisResult> {
    if (!this.extractor) {
      throw new Error("DomAnalyzer is not initialized. Call init() first.");
    }

    const dom = extractDom();
    const riskyElements: RiskyElement[] = [];
    this.collectRiskyElements(dom, "", riskyElements);

    const priorityTestList: TestCandidate[] = await this.buildTestCandidates(
      riskyElements
    );

    return {
      url: window.location.href,
      title: document.title,
      riskyElements,
      priorityTestList,
      // Console logs are captured by Selenium on the Node side; empty here.
      consoleLogs: [],
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private collectRiskyElements(
    elements: DomElement[],
    parentPath: string,
    out: RiskyElement[]
  ): void {
    for (const el of elements) {
      const path = buildPath(el, parentPath);
      const reasons: string[] = [];
      let riskScore = 0;

      // No unique ID → harder to locate reliably
      if (!el.id) {
        reasons.push("No unique ID");
        riskScore += 20;
      }

      // Shadow DOM increases test complexity
      if (el.hasShadowRoot) {
        reasons.push("Shadow root present");
        riskScore += 40;
      }

      // Embedded iframes are notoriously brittle
      if (el.isIframe) {
        reasons.push("Iframe element");
        riskScore += 30;
      }

      // Interactive elements without accessible labels are fragile
      const interactiveTags = new Set([
        "button",
        "input",
        "select",
        "textarea",
        "a",
      ]);
      if (interactiveTags.has(el.tag) && !el.id && !el.ariaLabel) {
        reasons.push("Interactive element with no ID or aria-label");
        riskScore += 25;
      }

      if (reasons.length > 0) {
        out.push({
          path,
          tag: el.tag,
          id: el.id,
          classes: el.classes,
          reason: reasons.join("; "),
          riskScore,
        });
      }

      if (el.children?.length) {
        this.collectRiskyElements(el.children, path, out);
      }
    }
  }

  private async buildTestCandidates(
    riskyElements: RiskyElement[]
  ): Promise<TestCandidate[]> {
    if (!this.extractor || riskyElements.length === 0) return [];

    // Use the model to embed element descriptions so we can de-duplicate
    // near-identical elements and surface the most unique ones.
    const descriptions = riskyElements.map((el) => elementDescription(el));

    const embeddings: number[][] = [];
    for (const desc of descriptions) {
      const output = await this.extractor(desc, {
        pooling: "mean",
        normalize: true,
      });
      // output.data is a Float32Array; convert to plain number[]
      embeddings.push(Array.from(output.data as Float32Array));
    }

    // Greedy de-duplication: keep elements whose embedding is not too close
    // to an already-selected element (cosine similarity < 0.92).
    const selected: number[] = [];
    for (let i = 0; i < embeddings.length; i++) {
      const isTooSimilar = selected.some((j) => {
        return cosineSimilarity(embeddings[i], embeddings[j]) > 0.92;
      });
      if (!isTooSimilar) selected.push(i);
    }

    return selected
      .map((i) => {
        const el = riskyElements[i];
        return {
          description: descriptions[i],
          locator: buildLocator(el),
          riskScore: el.riskScore,
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore);
  }
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Walk document.body and return a simplified DomElement tree.
 * Mirrors the extractDomScript logic that previously lived in crawler.ts.
 */
function extractDom(): DomElement[] {
  const MAX_DEPTH = 5;
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "META",
    "LINK",
    "HEAD",
  ]);

  function extractNode(el: Element, depth: number): DomElement | null {
    if (!el || depth > MAX_DEPTH) return null;
    if (SKIP_TAGS.has(el.tagName)) return null;

    const node: DomElement = { tag: el.tagName.toLowerCase() };

    if (el.id) node.id = el.id;

    const classes = Array.from(el.classList ?? []);
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

function buildLocator(el: RiskyElement): string {
  if (el.id) return `#${el.id}`;
  if (el.classes?.length) return `${el.tag}.${el.classes.join(".")}`;
  return el.path;
}

function elementDescription(el: RiskyElement): string {
  const parts: string[] = [el.tag];
  if (el.id) parts.push(`id="${el.id}"`);
  if (el.classes?.length) parts.push(`class="${el.classes.join(" ")}"`);
  parts.push(el.reason);
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
