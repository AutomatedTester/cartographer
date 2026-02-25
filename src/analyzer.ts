import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import { DomElement, PageSnapshot } from "./crawler.js";

/** A single element flagged as a testing risk. */
export interface RiskyElement {
  /** CSS-like path describing the element's location. */
  path: string;
  tag: string;
  id?: string;
  classes?: string[];
  /** Human-readable explanation of why this element is flagged. */
  reason: string;
  /** Higher value = higher priority for test coverage. */
  riskScore: number;
}

/** A candidate test case derived from a page snapshot. */
export interface TestCandidate {
  description: string;
  /** Suggested stable locator strategy (CSS or XPath). */
  locator: string;
  riskScore: number;
}

/** Full output produced by the analyzer. */
export interface AnalysisResult {
  url: string;
  title: string;
  riskyElements: RiskyElement[];
  priorityTestList: TestCandidate[];
  consoleLogs: string[];
}

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
    // Try WebNN → WebGPU → cpu (fallback) in order of preference.
    for (const device of ["webnn", "webgpu", "cpu"] as const) {
      try {
        this.extractor = (await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
          { device }
        )) as FeatureExtractionPipeline;
        console.error(`[analyzer] Model loaded on device: ${device}`);
        return;
      } catch {
        console.error(
          `[analyzer] Device '${device}' unavailable, trying next…`
        );
      }
    }
    throw new Error("[analyzer] Could not load model on any execution device.");
  }

  /**
   * Analyze a PageSnapshot and return a prioritized list of test candidates.
   *
   * @param snapshot - The page snapshot produced by SiteCrawler.
   */
  async analyzeMetadata(snapshot: PageSnapshot): Promise<AnalysisResult> {
    if (!this.extractor) {
      throw new Error("DomAnalyzer is not initialized. Call init() first.");
    }

    const riskyElements: RiskyElement[] = [];
    this.collectRiskyElements(snapshot.dom, "", riskyElements);

    // Build test candidates from risky elements
    const priorityTestList: TestCandidate[] = await this.buildTestCandidates(
      riskyElements
    );

    return {
      url: snapshot.url,
      title: snapshot.title,
      riskyElements,
      priorityTestList,
      consoleLogs: snapshot.consoleLogs,
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
