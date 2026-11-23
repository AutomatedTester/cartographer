/**
 * SemanticMatcher: score how well each crawled element matches a
 * natural-language description, using a sentence-embedding model.
 *
 * Keyword overlap only finds an element when the description shares a word
 * with it: "checkout button" never finds a button labelled "Proceed to
 * payment". Embedding both and comparing them catches that kind of match.
 *
 * This runs in the MCP server process (Node), not in the crawled page, so it
 * has its own copy of the model. It is loaded lazily, never blocks a request
 * for longer than `loadTimeoutMs`, and returns null whenever the model is
 * unavailable so callers can fall back to keyword matching.
 */

import type { DomElement } from "./analyzer.js";

/** Turns texts into one embedding each. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/** Model used when none is given: matches DomAnalyzer's default. */
export const MATCHER_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Environment variable that turns semantic matching off ("off", "0", "false"). */
export const SEMANTIC_LOCATOR_ENV = "WEBMCP_SEMANTIC_LOCATOR";

/** After a failed load, wait this long before trying again. */
const RETRY_AFTER_MS = 5 * 60 * 1000;

export interface SemanticMatcherOptions {
  /**
   * Builds the embedder. Defaults to loading `model` with Transformers.js.
   * Tests pass their own.
   */
  loadEmbedder?: () => Promise<Embedder>;
  /** Hugging Face model id for the default loader. */
  model?: string;
  /** Longest a request waits for the model to load before falling back. */
  loadTimeoutMs?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export class SemanticMatcher {
  private readonly loadEmbedder: () => Promise<Embedder>;
  private readonly loadTimeoutMs: number;
  private readonly now: () => number;

  private embedder: Embedder | null = null;
  private loading: Promise<Embedder | null> | null = null;
  private failedAt: number | null = null;
  /** Element description → embedding; the same crawl is queried repeatedly. */
  private readonly cache = new Map<string, number[]>();

  constructor(options: SemanticMatcherOptions = {}) {
    const model = options.model ?? MATCHER_MODEL;
    this.loadEmbedder = options.loadEmbedder ?? (() => loadTransformersEmbedder(model));
    this.loadTimeoutMs = options.loadTimeoutMs ?? 15000;
    this.now = options.now ?? Date.now;
  }

  /** Whether semantic matching is turned off by the environment. */
  static disabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = (env[SEMANTIC_LOCATOR_ENV] ?? "").trim().toLowerCase();
    return value === "off" || value === "0" || value === "false";
  }

  /**
   * Start loading the model without waiting for it, so the first locator
   * request after a crawl does not pay the download.
   */
  warmUp(): void {
    void this.getEmbedder();
  }

  /**
   * Cosine similarity between `description` and each element, in the order
   * given, or null if the model is unavailable or not ready in time.
   */
  async similarities(description: string, elements: DomElement[]): Promise<number[] | null> {
    const embed = await this.waitForEmbedder();
    if (!embed) return null;

    try {
      const texts = elements.map(describeElement);
      const missing = [...new Set(texts.filter((t) => !this.cache.has(t)))];
      const [query, ...computed] = await embed([description, ...missing]);
      missing.forEach((text, i) => this.cache.set(text, computed[i]));

      return texts.map((text) => cosineSimilarity(query, this.cache.get(text)!));
    } catch (err) {
      console.error(`[semantic-matcher] Embedding failed; using keyword matching: ${errorMessage(err)}`);
      return null;
    }
  }

  private async waitForEmbedder(): Promise<Embedder | null> {
    if (this.embedder) return this.embedder;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.loadTimeoutMs);
    });
    try {
      const embed = await Promise.race([this.getEmbedder(), timeout]);
      if (!embed && this.loading) {
        console.error(
          `[semantic-matcher] Model not ready after ${this.loadTimeoutMs}ms; using keyword matching for now`
        );
      }
      return embed;
    } finally {
      clearTimeout(timer);
    }
  }

  private getEmbedder(): Promise<Embedder | null> {
    if (this.embedder) return Promise.resolve(this.embedder);
    if (this.loading) return this.loading;
    if (this.failedAt !== null && this.now() - this.failedAt < RETRY_AFTER_MS) {
      return Promise.resolve(null);
    }

    this.loading = this.loadEmbedder().then(
      (embed) => {
        this.embedder = embed;
        this.failedAt = null;
        this.loading = null;
        return embed;
      },
      (err) => {
        console.error(`[semantic-matcher] Model unavailable; using keyword matching: ${errorMessage(err)}`);
        this.failedAt = this.now();
        this.loading = null;
        return null;
      }
    );
    return this.loading;
  }
}

/**
 * A short phrase describing an element, in the form the model compares well:
 * what kind of control it is, then the words a person would see or hear.
 * Identifier-style names ("checkout-btn", "firstName") are split into words.
 */
export function describeElement(el: DomElement): string {
  const attrs = el.attributes ?? {};
  const kind = el.role || (el.tag === "input" && attrs.type ? `${attrs.type} input` : el.tag);
  const parts: string[] = [kind];

  const add = (label: string, value: string | undefined) => {
    const text = value?.trim();
    if (text) parts.push(`${label}: ${text}`);
  };

  add("text", el.text);
  add("label", el.ariaLabel);
  add("placeholder", attrs.placeholder);
  add("title", attrs.title);
  add("alt", attrs.alt);
  add("name", splitIdentifier(attrs.name));
  add("id", splitIdentifier(el.id));

  return parts.join(", ");
}

function splitIdentifier(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.:]+/g, " ")
    .trim()
    .toLowerCase();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / Math.sqrt(magA * magB);
}

// Downloads a real model, so unit tests inject an embedder instead.
/* node:coverage disable */
async function loadTransformersEmbedder(model: string): Promise<Embedder> {
  const { pipeline } = await import("@huggingface/transformers");
  // q8 is the ~23MB quantised build; plenty for ranking a page's elements.
  const extractor = await (pipeline as any)("feature-extraction", model, { dtype: "q8" });
  return async (texts: string[]) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist() as number[][];
  };
}
/* node:coverage enable */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
