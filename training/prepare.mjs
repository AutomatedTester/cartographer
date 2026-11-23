#!/usr/bin/env node
/**
 * Check the datasets and write training triplets for train.py.
 *
 *   npm run build && node training/prepare.mjs [--train FILE] [--eval FILE] [--out FILE]
 *
 * Element text is produced by the server's own describeElement, so the model
 * is trained on exactly the strings it will compare at run time.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadPages, queryTexts, toTriplets, validatePages } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    train: { type: "string", default: path.join(here, "data", "train.jsonl") },
    eval: { type: "string", default: path.join(here, "data", "eval.jsonl") },
    out: { type: "string", default: path.join(here, "out", "triplets.jsonl") },
  },
});

const evalPages = loadPages(args.eval);
const trainPages = loadPages(args.train);

const problems = [
  ...validatePages(evalPages).map((p) => `eval: ${p}`),
  ...validatePages(trainPages, { heldOut: queryTexts(evalPages) }).map((p) => `train: ${p}`),
];
if (problems.length) {
  console.error(`Dataset problems:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const rows = toTriplets(trainPages);
mkdirSync(path.dirname(args.out), { recursive: true });
writeFileSync(args.out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(
  `train: ${trainPages.length} pages, ${queryTexts(trainPages).length} queries → ${rows.length} triplets\n` +
    `eval:  ${evalPages.length} pages, ${queryTexts(evalPages).length} queries (held out)\n` +
    `wrote ${path.relative(process.cwd(), args.out)}`
);
