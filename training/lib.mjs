/**
 * Shared helpers for the locator fine-tuning pipeline.
 *
 * A dataset is JSON Lines, one page per line:
 *
 *   {
 *     "page": "auth-login",
 *     "elements": [{ "key": "go", "tag": "button", "text": "Log in", ... }],
 *     "queries": [["sign in button", "go"], ...],
 *     "unrelated": ["weather forecast"]          // optional, eval only
 *   }
 *
 * Elements use the same fields the crawler records (tag, text, ariaLabel,
 * role, id, attributes); `key` only names the element for `queries`. Each
 * query is a description a person might give and the key of the element it
 * means. Other elements on the same page are its wrong answers, which is what
 * makes them useful negatives in training and a fair test in evaluation.
 */
import { readFileSync } from "node:fs";

import { describeElement } from "../build/semantic-matcher.js";

/** Parse a JSON Lines dataset, naming the line of any parse error. */
export function loadPages(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => [line.trim(), i + 1])
    .filter(([line]) => line && !line.startsWith("//"))
    .map(([line, n]) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${file}:${n}: ${err.message}`);
      }
    });
}

/**
 * Problems that would make a dataset train or measure the wrong thing.
 *
 * @param {object[]} pages
 * @param {object} [options]
 * @param {Iterable<string>} [options.heldOut] queries that must not appear
 *   (the evaluation set's, when checking training data)
 * @returns {string[]} one message per problem; empty when the data is usable
 */
export function validatePages(pages, { heldOut = [] } = {}) {
  const problems = [];
  const banned = new Set([...heldOut].map(normalise));
  const seenPages = new Set();

  for (const [i, page] of pages.entries()) {
    const where = `page ${page?.page ?? `#${i + 1}`}`;
    if (!page || typeof page.page !== "string" || !page.page) {
      problems.push(`${where}: missing "page" name`);
      continue;
    }
    if (seenPages.has(page.page)) problems.push(`${where}: duplicate page name`);
    seenPages.add(page.page);

    if (!Array.isArray(page.elements) || page.elements.length < 2) {
      problems.push(`${where}: needs at least two elements, so each query has a wrong answer`);
      continue;
    }

    const byKey = new Map();
    const byDescription = new Map();
    for (const el of page.elements) {
      if (!el?.key) {
        problems.push(`${where}: element without a "key"`);
        continue;
      }
      if (!el.tag) problems.push(`${where}: element ${el.key} has no "tag"`);
      if (byKey.has(el.key)) problems.push(`${where}: duplicate key ${el.key}`);
      byKey.set(el.key, el);

      // Two elements the model sees identically make every query for one of
      // them ambiguous: the label says "this one", the text says "either".
      const text = describeElement(el);
      if (byDescription.has(text)) {
        problems.push(`${where}: ${byDescription.get(text)} and ${el.key} look identical ("${text}")`);
      }
      byDescription.set(text, el.key);
    }

    if (!Array.isArray(page.queries) || page.queries.length === 0) {
      problems.push(`${where}: no queries`);
      continue;
    }
    const seenQueries = new Set();
    for (const query of page.queries) {
      const [text, key] = Array.isArray(query) ? query : [];
      if (typeof text !== "string" || !text.trim()) {
        problems.push(`${where}: query without text`);
        continue;
      }
      if (!byKey.has(key)) problems.push(`${where}: "${text}" points at unknown key ${key}`);
      if (seenQueries.has(normalise(text))) problems.push(`${where}: "${text}" appears twice`);
      seenQueries.add(normalise(text));
      if (banned.has(normalise(text))) {
        problems.push(`${where}: "${text}" is in the evaluation set; training on it would inflate the score`);
      }
    }
  }
  return problems;
}

/**
 * Training rows: (description, right element, wrong element) triplets, one
 * per wrong element on the page, as text the model will actually compare.
 */
export function toTriplets(pages) {
  const rows = [];
  for (const page of pages) {
    const text = new Map(page.elements.map((el) => [el.key, describeElement(el)]));
    for (const [anchor, key] of page.queries) {
      const positive = text.get(key);
      for (const [otherKey, negative] of text) {
        if (otherKey !== key && negative !== positive) {
          rows.push({ anchor, positive, negative, page: page.page });
        }
      }
    }
  }
  return rows;
}

/** Every query text in a dataset. */
export function queryTexts(pages) {
  return pages.flatMap((page) => (page.queries ?? []).map(([text]) => text));
}

/**
 * The elements of a page as the locator will see them. `ids` chooses what
 * goes in each element's id: "key" (descriptive, like the benchmark app) or
 * "neutral" (el0, el1, … — no hint in the id, as on many real sites).
 * Returns the elements and the selector each key should produce.
 */
export function pageElements(page, ids) {
  const expected = new Map();
  const elements = page.elements.map(({ key, ...el }, i) => {
    const id = ids === "neutral" ? `el${i}` : key;
    expected.set(key, `#${id}`);
    return { ...el, id, isVisible: true, attributes: el.attributes ?? {} };
  });
  return { elements, expected };
}

/**
 * The lowest threshold that rejects every unrelated description, with a small
 * margin. Below this, some description that matches nothing gets a confident
 * answer anyway.
 */
export function recommendThreshold(maxUnrelatedSimilarity, margin = 0.03) {
  return Math.round((maxUnrelatedSimilarity + margin) * 100) / 100;
}

function normalise(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
