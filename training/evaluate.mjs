#!/usr/bin/env node
/**
 * Compare locator accuracy on the held-out set: keyword matching alone, and
 * semantic matching with each model given.
 *
 *   npm run build
 *   node training/evaluate.mjs [--model ID_OR_PATH ...] [--data FILE] [--json]
 *
 * --model may be repeated; it defaults to the stock model. Each model is
 * loaded exactly as the server loads CARTOGRAPHER_LOCATOR_MODEL, so a Hub id or an
 * export.py output directory both work.
 *
 * For each model it reports top-1 accuracy with descriptive ids (as in the
 * benchmark app) and neutral ids (el0, el1, …: no hint in the id), whether any
 * unrelated description got an answer, and the threshold to set with
 * CARTOGRAPHER_LOCATOR_MIN_SIMILARITY so that none does.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { LocatorGenerator, MIN_SEMANTIC_SIMILARITY } from "../build/locator-generator.js";
import { MATCHER_MODEL, SemanticMatcher } from "../build/semantic-matcher.js";
import { loadPages, pageElements, recommendThreshold, validatePages } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    model: { type: "string", multiple: true },
    data: { type: "string", default: path.join(here, "data", "eval.jsonl") },
    json: { type: "boolean", default: false },
  },
});

const pages = loadPages(args.data);
const problems = validatePages(pages);
if (problems.length) {
  console.error(`Dataset problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// The generator logs every match; that would bury the report.
const log = console.log;
console.log = () => {};

/**
 * Score one way of matching over every page and both id styles.
 * `similarities(query, elements)` returns null for keyword-only matching.
 */
async function score(label, similarities, minSimilarity) {
  const generator = new LocatorGenerator({ minSimilarity });
  const result = { label, ids: {}, misses: [], unrelated: { answered: [], maxSimilarity: 0 } };

  for (const ids of ["key", "neutral"]) {
    let hits = 0;
    let total = 0;
    for (const page of pages) {
      const { elements, expected } = pageElements(page, ids);
      for (const [query, key] of page.queries) {
        const sims = await similarities(query, elements);
        const got = generator.generateLocator(query, elements, sims);
        total += 1;
        if (got.selector === expected.get(key)) hits += 1;
        else if (ids === "neutral") {
          const gotKey = [...expected].find(([, sel]) => sel === got.selector)?.[0] ?? got.selector;
          result.misses.push({ page: page.page, query, want: key, got: gotKey, similarity: got.similarity });
        }
      }
      if (ids === "neutral") {
        for (const query of page.unrelated ?? []) {
          const sims = await similarities(query, elements);
          if (sims) result.unrelated.maxSimilarity = Math.max(result.unrelated.maxSimilarity, ...sims);
          const got = generator.generateLocator(query, elements, sims);
          if (got.confidence > 0) result.unrelated.answered.push(query);
        }
      }
    }
    result.ids[ids] = { hits, total };
  }
  return result;
}

const models = args.model?.length ? args.model : [MATCHER_MODEL];
const results = [await score("keyword only", async () => null)];

for (const model of models) {
  const matcher = new SemanticMatcher({ model, loadTimeoutMs: 10 * 60 * 1000 });
  const sims = (query, elements) => matcher.similarities(query, elements);
  // First pass at the default threshold, to see where unrelated queries land.
  const first = await score(matcher.modelName, sims, MIN_SEMANTIC_SIMILARITY);
  if (!first.ids.key.total || first.unrelated.maxSimilarity === 0) {
    results.push(first);
    continue;
  }
  const recommended = recommendThreshold(first.unrelated.maxSimilarity);
  const tuned = recommended === MIN_SEMANTIC_SIMILARITY ? first : await score(matcher.modelName, sims, recommended);
  results.push({ ...tuned, threshold: recommended, atDefault: first });
}

console.log = log;

if (args.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pct = ({ hits, total }) => `${hits}/${total}`.padEnd(7);
  console.log(`\n${"matcher".padEnd(52)} ${"ids=key".padEnd(8)} ${"ids=neutral".padEnd(12)} unrelated answered`);
  for (const r of results) {
    const unrelated = r.unrelated.answered.length;
    const note = r.threshold !== undefined ? `  (threshold ${r.threshold})` : "";
    console.log(`${r.label.padEnd(52)} ${pct(r.ids.key)}  ${pct(r.ids.neutral)}      ${unrelated}${note}`);
    if (r.atDefault && r.atDefault !== r) {
      const d = r.atDefault;
      console.log(
        `${"  at default threshold " + MIN_SEMANTIC_SIMILARITY}`.padEnd(52) +
          ` ${pct(d.ids.key)}  ${pct(d.ids.neutral)}      ${d.unrelated.answered.length}`
      );
    }
  }
  for (const r of results.slice(1)) {
    console.log(`\n${r.label}: highest similarity for an unrelated description ${r.unrelated.maxSimilarity.toFixed(2)}`);
    if (r.threshold !== undefined && r.threshold !== MIN_SEMANTIC_SIMILARITY) {
      console.log(`  to use it: CARTOGRAPHER_LOCATOR_MODEL=${r.label} CARTOGRAPHER_LOCATOR_MIN_SIMILARITY=${r.threshold}`);
    }
    for (const m of r.misses) {
      const sim = m.similarity === undefined ? "" : ` (similarity ${m.similarity.toFixed(2)})`;
      console.log(`  miss: "${m.query}" → ${m.got}, wanted ${m.want}${sim}`);
    }
  }
}
