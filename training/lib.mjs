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

/**
 * Sites (the pages' `site` field) that appear in both datasets. Evaluating on
 * a site the model trained on measures memory of that site, not whether it
 * copes with one it has never seen, so each site belongs to one side only.
 */
export function sharedSites(trainPages, evalPages) {
  const trainSites = new Set(trainPages.map((p) => p.site).filter(Boolean));
  return [...new Set(evalPages.map((p) => p.site).filter((s) => trainSites.has(s)))];
}

/** Attributes describeElement reads; anything else is noise in the dataset. */
const KEPT_ATTRIBUTES = ["type", "placeholder", "name", "title", "alt"];
/** Longer element text is cut: a card or paragraph, not a control label. */
const MAX_TEXT = 120;

/**
 * Draft dataset pages from crawler output. The elements are what the locator
 * ranks at run time (the crawl's high-intent elements), trimmed to the fields
 * the model sees; `queries` is left empty for a person (or an LLM, reviewed by
 * a person) to fill in. prepare.mjs rejects a page whose queries are empty, so
 * an unfinished draft can't slip into training.
 *
 * @param {object} crawl a multi-page crawl result ({ session: { pages } }),
 *   an array of crawled pages, or one crawl_and_analyze result
 * @param {object} [options]
 * @param {string} [options.site] site name; defaults to each page's host
 * @returns {object[]} pages in dataset form, plus `site` and `url`
 */
export function crawlToPages(crawl, { site } = {}) {
  const crawled = Array.isArray(crawl) ? crawl : (crawl?.session?.pages ?? [crawl]);
  const pages = [];
  const names = new Set();

  for (const result of crawled) {
    if (!result?.url || !Array.isArray(result.highIntentElements)) continue;
    const url = new URL(result.url);
    const siteName = site ?? url.host;

    const keys = new Set();
    const seen = new Set();
    const elements = [];
    for (const raw of result.highIntentElements) {
      const el = trimElement(raw);
      const text = describeElement(el);
      // A bare "div" or "button" gives a query nothing to match (a typed
      // input, "password input", still does); an exact repeat (the same link
      // in header and footer) would make labels ambiguous.
      const typedInput = el.tag === "input" && el.attributes?.type && !el.role;
      if (!text.includes(":") && !typedInput) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      elements.push({ key: uniqueName(elementKey(el), keys), ...el });
    }
    if (elements.length < 2) continue;

    const name = uniqueName(slug(`${siteName} ${url.pathname === "/" ? "home" : url.pathname}`), names);
    pages.push({ page: name, site: siteName, url: result.url, elements, queries: [] });
  }
  return pages;
}

function trimElement(raw) {
  const el = { tag: String(raw.tag ?? "").toLowerCase() };
  const text = collapse(raw.text);
  if (text) el.text = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text;
  for (const field of ["ariaLabel", "role", "id"]) {
    const value = collapse(raw[field]);
    if (value) el[field] = value;
  }
  const attributes = {};
  for (const name of KEPT_ATTRIBUTES) {
    const value = collapse(raw.attributes?.[name]);
    if (value) attributes[name] = value;
  }
  if (Object.keys(attributes).length) el.attributes = attributes;
  return el;
}

/** A readable key: the element's id if it has one, else its label. */
function elementKey(el) {
  const label =
    el.id ?? el.ariaLabel ?? el.text ?? el.attributes?.placeholder ?? el.attributes?.name ?? el.attributes?.title ?? `${el.attributes?.type ?? ""} ${el.tag}`;
  return slug(label).slice(0, 40).replace(/-+$/, "") || el.tag;
}

function uniqueName(base, taken) {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  return name;
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collapse(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : undefined;
}

function normalise(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
