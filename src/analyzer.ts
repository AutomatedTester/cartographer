import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import { AnalysisResult, HighIntentElement } from "./types.js";

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

export { AnalysisResult, HighIntentElement } from "./types.js";

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
    // Try WebNN → WebGPU → WASM (CPU) in order of preference.
    for (const device of ["webnn", "webgpu", "wasm"] as const) {
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
    console.warn("[analyzer] All ML backends unavailable — running in heuristic-only mode.");
  }

  async analyzeCurrentPage(intentThreshold: number = 25): Promise<AnalysisResult> {
    const dom = extractDom(10);
    const highIntentElements: HighIntentElement[] = [];
    this.collectHighIntentElements(dom, "", highIntentElements, intentThreshold);

    // ML deduplication (if model available) or fallback to description dedup
    let deduped: HighIntentElement[] = [];
    if (!this.extractor) {
      const seen = new Set<string>();
      for (const el of highIntentElements) {
        const desc = elementDescription(el);
        if (!seen.has(desc)) {
          deduped.push(el);
          seen.add(desc);
        }
      }
    } else {
      // Use ML model to deduplicate by semantic similarity
      const descriptions = highIntentElements.map((el) => elementDescription(el));
      const embeddings: number[][] = [];
      for (const desc of descriptions) {
        // @ts-ignore: extractor returns Promise<number[][]>
        const emb = await this.extractor(desc);
        embeddings.push(Array.isArray(emb[0]) ? emb[0][0] : emb[0]);
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
    deduped.sort((a, b) => b.intentScore - a.intentScore);
    return {
      url: window.location.href,
      title: document.title,
      highIntentElements: deduped,
      consoleLogs: []
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
        reasons.push("anchor likely navigates");
      }
      if (tag === "form" && hasAction && el.attributes?.action) {
        navigates = true;
        navigationTarget = el.attributes.action;
        reasons.push("form likely navigates");
      }
      if (tag === "button" && type === "submit" && parentPath.includes("form")) {
        navigates = true;
        reasons.push("submit button in form");
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
          locator: buildLocator(el),
          intentReasons: reasons,
          intentScore,
          navigates,
          navigationTarget,
        });
      }

      if (el.children?.length) {
        this.collectHighIntentElements(el.children, path, out, intentThreshold);
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

function buildLocator(el: HighIntentElement): string {
  if (el.id) return `#${el.id}`;
  if (el.classes?.length) return `${el.tag}.${el.classes.join(".")}`;
  return el.path;
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
