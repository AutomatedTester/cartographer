/**
 * LocatorGenerator: Generate CSS/XPath selectors without Copilot
 * 
 * Converts natural language element descriptions to stable CSS/XPath selectors
 * using pure heuristics and pattern matching. Zero Copilot/LLM calls needed.
 * 
 * Examples:
 * - "the submit button" → button[type="submit"]
 * - "delete link" → a:contains("delete")
 * - "email input" → input[type="email"]
 * - "search box" → input[placeholder*="search"]
 * 
 * When the caller also passes a semantic similarity per element (see
 * SemanticMatcher), elements are ranked by meaning first and keyword overlap
 * second, so "checkout button" can find a button labelled "Proceed to
 * payment". Without similarities it is keyword matching alone.
 *
 * Processing Time: <50ms (plus embedding time when similarities are used)
 */

import { DomElement } from "./analyzer.js";

export interface GeneratedLocator {
  selector: string;
  type: 'css' | 'xpath';
  confidence: number; // 0-1
  reason: string;
  /** How the element was found; absent when nothing matched. */
  matchedBy?: 'keyword' | 'semantic' | 'keyword+semantic';
  /** Cosine similarity to the description, when semantic scores were given. */
  similarity?: number;
}

/**
 * Lowest similarity at which an element with no keyword in common still counts
 * as a match. Measured with all-MiniLM-L6-v2: an unrelated description scored
 * at most 0.08 against a page's elements, while true paraphrases scored from
 * 0.26 ("add item to basket" → "Add to cart") up to 0.74.
 */
export const MIN_SEMANTIC_SIMILARITY = 0.2;

/** Keyword score is capped and scaled to at most this much on top of similarity. */
const KEYWORD_WEIGHT = 0.25;
const KEYWORD_SCORE_CAP = 120;

/** Generic control nouns left out of the keyword boost in semantic ranking. */
const CONTROL_WORDS = new Set([
  'button', 'btn', 'link', 'field', 'box', 'input', 'element', 'item', 'icon',
]);

export interface LocatorGeneratorOptions {
  /**
   * Overrides MIN_SEMANTIC_SIMILARITY. A fine-tuned model scores on its own
   * scale; training/evaluate.mjs recommends a value for it.
   */
  minSimilarity?: number;
}

export class LocatorGenerator {
  private readonly minSimilarity: number;

  constructor(options: LocatorGeneratorOptions = {}) {
    const value = options.minSimilarity;
    this.minSimilarity =
      typeof value === 'number' && Number.isFinite(value) ? value : MIN_SEMANTIC_SIMILARITY;
  }

  /**
   * Generate a stable locator from a natural language description
   * @param description Human description (e.g., "the submit button in the login form")
   * @param elements Array of DOM elements to search
   * @param similarities Optional cosine similarity of the description to each
   *   element, index-aligned with `elements`
   * @returns Best matching selector with confidence score
   */
  generateLocator(
    description: string,
    elements: DomElement[],
    similarities?: number[] | null
  ): GeneratedLocator {
    // Step 1: Extract keywords from description
    const keywords = this.extractKeywords(description);
    console.log(`[locator] Searching for: "${description}" → keywords: [${keywords.join(', ')}]`);

    if (similarities && similarities.length === elements.length) {
      return this.generateWithSimilarity(keywords, elements, similarities);
    }

    if (keywords.length === 0) {
      return {
        selector: '*',
        type: 'css',
        confidence: 0,
        reason: 'No searchable keywords found in description'
      };
    }

    // Step 2: Find matching elements
    const matches = this.findMatches(keywords, elements);

    if (matches.length === 0) {
      console.log(`[locator] No matches found for keywords: [${keywords.join(', ')}]`);
      return {
        selector: '*',
        type: 'css',
        confidence: 0,
        reason: `No elements matched keywords: ${keywords.join(', ')}`
      };
    }

    // Step 3: Pick best match
    const best = matches[0];
    console.log(`[locator] Best match: ${best.element.tag} (score: ${best.score})`);

    // Step 4: Generate and return selector
    return { ...this.generateSelector(best, keywords), matchedBy: 'keyword' };
  }

  /**
   * Rank by similarity, with keyword overlap as a bounded boost. An element
   * qualifies if it shares a keyword or is similar enough on its own.
   */
  private generateWithSimilarity(
    keywords: string[],
    elements: DomElement[],
    similarities: number[]
  ): GeneratedLocator {
    // Words naming the kind of control ("link", "button") say nothing about
    // which one is meant, and match ids and classes all over a page
    // ("dashboard-cart-link", "btn-primary"). The model already weighs them.
    keywords = keywords.filter((kw) => !CONTROL_WORDS.has(kw));
    let best: { element: DomElement; score: number; keyword: number; similarity: number } | null = null;

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const similarity = Number.isFinite(similarities[i]) ? similarities[i] : 0;
      const keyword = keywords.length > 0 ? this.calculateScore(keywords, element) : 0;
      if (keyword === 0 && !(similarity >= this.minSimilarity)) continue;

      const score =
        similarity + (Math.min(keyword, KEYWORD_SCORE_CAP) / KEYWORD_SCORE_CAP) * KEYWORD_WEIGHT;
      if (!best || score > best.score) {
        best = { element, score, keyword, similarity };
      }
    }

    if (!best) {
      const top = similarities.length ? Math.max(...similarities) : 0;
      return {
        selector: '*',
        type: 'css',
        confidence: 0,
        reason:
          `No element shared a keyword or was similar enough ` +
          `(best similarity ${top.toFixed(2)}, need ${this.minSimilarity})`,
        similarity: top,
      };
    }

    const match = best;
    console.log(
      `[locator] Best match: ${match.element.tag} (similarity: ${match.similarity.toFixed(2)}, keyword score: ${match.keyword})`
    );
    const locator = this.generateSelector(match, keywords);
    return {
      ...locator,
      reason: `${locator.reason}; similarity ${match.similarity.toFixed(2)} to the description`,
      matchedBy: match.keyword > 0 ? 'keyword+semantic' : 'semantic',
      similarity: match.similarity,
    };
  }

  /**
   * Extract searchable keywords from description
   * Removes stop words, special characters, etc.
   */
  private extractKeywords(description: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are',
      'this', 'that', 'and', 'or', 'but', 'with', 'by', 'from'
    ]);

    return description
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Find DOM elements matching the keywords
   */
  private findMatches(
    keywords: string[],
    elements: DomElement[]
  ): Array<{ element: DomElement; score: number }> {
    return elements
      .map(el => ({
        element: el,
        score: this.calculateScore(keywords, el)
      }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate match score for an element
   * Higher scores = better matches
   */
  private calculateScore(keywords: string[], el: DomElement): number {
    let keywordScore = 0;

    const text = (el.text || '').toLowerCase();
    const aria = (el.ariaLabel || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const classes = (el.classes || []).join(' ').toLowerCase();
    const placeholder = (el.attributes?.placeholder || '').toLowerCase();

    // Match keywords against element attributes
    keywords.forEach(kw => {
      // Text content (highest priority)
      if (text.includes(kw)) {
        keywordScore += 40;
      }
      // Label/aria (high priority)
      if (aria.includes(kw)) {
        keywordScore += 35;
      }
      // ID (medium priority)
      if (id.includes(kw)) {
        keywordScore += 30;
      }
      // Classes (medium priority)
      if (classes.includes(kw)) {
        keywordScore += 25;
      }
      // Placeholder (medium priority)
      if (placeholder.includes(kw)) {
        keywordScore += 25;
      }
    });

    // No keyword touched this element, so it is not a candidate. The bonuses
    // below are tie-breakers between genuine matches; adding them
    // unconditionally gave every visible element a positive score, which made
    // the "no elements matched" path unreachable and let an unrelated
    // description come back with a confident-looking selector.
    if (keywordScore === 0) {
      return 0;
    }

    let score = keywordScore;

    // Boost visible elements
    if (el.isVisible) {
      score += 10;
    }

    // Boost elements with explicit test IDs
    if (el.attributes?.['data-testid']) {
      score += 5;
    }

    return score;
  }

  /**
   * Generate CSS or XPath selector for the matched element
   */
  private generateSelector(
    match: { element: DomElement; score: number },
    keywords: string[]
  ): GeneratedLocator {
    const el = match.element;

    // Priority: ID → data-testid → aria-label → text content → tag+class

    // 1. Use ID (most specific)
    if (el.id) {
      return {
        selector: `#${this.escapeCss(el.id)}`,
        type: 'css',
        confidence: 0.99,
        reason: `Found by ID: "${el.id}"`
      };
    }

    // 2. Use data-testid (explicit test hook)
    if (el.attributes?.['data-testid']) {
      const testId = el.attributes['data-testid'];
      return {
        selector: `[data-testid="${testId}"]`,
        type: 'css',
        confidence: 0.95,
        reason: `Found by data-testid: "${testId}"`
      };
    }

    // 3. Use aria-label (accessibility label)
    if (el.ariaLabel) {
      const xpath = `//${el.tag}[@aria-label="${this.escapeXPath(el.ariaLabel)}"]`;
      return {
        selector: xpath,
        type: 'xpath',
        confidence: 0.85,
        reason: `Found by aria-label: "${el.ariaLabel}"`
      };
    }

    // 4. Use text content
    if (el.text) {
      let xpath: string;
      
      // Exact match for short text
      if (el.text.length < 30) {
        xpath = `//${el.tag}[text()="${this.escapeXPath(el.text)}"]`;
        return {
          selector: xpath,
          type: 'xpath',
          confidence: 0.90,
          reason: `Found by exact text: "${el.text}"`
        };
      }
      
      // Partial match for longer text
      xpath = `//${el.tag}[contains(text(), "${this.escapeXPath(el.text.substring(0, 20))}")]`;
      return {
        selector: xpath,
        type: 'xpath',
        confidence: 0.75,
        reason: `Found by partial text: "${el.text.substring(0, 20)}..."`
      };
    }

    // 5. Use input type
    if (el.attributes?.type) {
      const type = el.attributes.type;
      let selector = `input[type="${type}"]`;
      
      // Add name/placeholder for uniqueness
      if (el.attributes.name) {
        selector = `input[type="${type}"][name="${el.attributes.name}"]`;
      } else if (el.attributes.placeholder) {
        selector = `input[type="${type}"][placeholder*="${el.attributes.placeholder}"]`;
      }
      
      return {
        selector,
        type: 'css',
        confidence: 0.70,
        reason: `Found by input type: "${type}"`
      };
    }

    // 6. Use classes
    if (el.classes && el.classes.length > 0) {
      const classSelector = el.classes.join('.');
      const selector = `${el.tag}.${classSelector}`;
      return {
        selector,
        type: 'css',
        confidence: 0.60,
        reason: `Found by classes: .${classSelector}`
      };
    }

    // 7. Fallback: tag name only
    return {
      selector: el.tag,
      type: 'css',
      confidence: 0.30,
      reason: `Fallback: ${el.tag} selector (low specificity)`
    };
  }

  /**
   * Escape special characters for CSS selectors
   */
  private escapeCss(str: string): string {
    // Escape special CSS characters
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  /**
   * Escape special characters for XPath expressions
   */
  private escapeXPath(str: string): string {
    // For simplicity, escape double quotes by splitting on them
    // A more robust implementation would use concat()
    return str.replace(/"/g, "'");
  }
}
