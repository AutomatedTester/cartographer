#!/usr/bin/env node
/**
 * Draft dataset pages from real sites: crawl them (or read a saved crawl) and
 * write each page's elements in the train/eval format, with empty queries.
 *
 *   npm run train:harvest -- --url https://the-internet.herokuapp.com/ [--url …]
 *                            [--max-pages 10] [--max-depth 2] [--out DIR]
 *   npm run train:harvest -- --from crawl.json [--site NAME] [--out DIR]
 *
 * One file per site goes to training/out/harvest/<site>.jsonl (git-ignored).
 * Fill in each page's queries, delete pages not worth keeping, then append
 * the site's pages to train.jsonl or eval.jsonl: one or the other, never both
 * (prepare.mjs checks).
 *
 * --save-raw keeps the crawl result next to the draft, so a draft can be
 * rebuilt with --from without crawling again.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { crawlToPages } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    url: { type: "string", multiple: true, default: [] },
    from: { type: "string", multiple: true, default: [] },
    site: { type: "string" },
    "max-pages": { type: "string", default: "10" },
    "max-depth": { type: "string", default: "2" },
    out: { type: "string", default: path.join(here, "out", "harvest") },
    "save-raw": { type: "boolean", default: false },
  },
});

if (!args.url.length && !args.from.length) {
  console.error("Give at least one --url to crawl or --from file to read.");
  process.exit(2);
}
if (args.site && args.url.length + args.from.length > 1) {
  console.error("--site names a single source; leave it out to name each site by its host.");
  process.exit(2);
}

mkdirSync(args.out, { recursive: true });
const bySite = new Map();
const collect = (pages) => {
  for (const page of pages) bySite.set(page.site, [...(bySite.get(page.site) ?? []), page]);
};

for (const file of args.from) {
  collect(crawlToPages(JSON.parse(readFileSync(file, "utf8")), { site: args.site }));
}

if (args.url.length) {
  const { MultiPageCrawler } = await import("../build/multi-page-crawler.js");
  for (const startUrl of args.url) {
    console.log(`crawling ${startUrl} …`);
    const crawler = new MultiPageCrawler({
      startUrl,
      maxPages: Number(args["max-pages"]),
      maxDepth: Number(args["max-depth"]),
      // Elements only: no workflow analysis, and never type into a login form.
      detectWorkflows: false,
      enableAutoLogin: false,
    });
    const result = await crawler.crawl();
    if (args["save-raw"]) {
      const raw = path.join(args.out, `${new URL(result.session.startUrl).host}.crawl.json`);
      writeFileSync(raw, JSON.stringify(result.session.pages, null, 1));
      console.log(`saved crawl to ${path.relative(process.cwd(), raw)}`);
    }
    for (const err of result.crawlErrors ?? []) console.warn(`  skipped ${err.url}: ${err.message}`);
    collect(crawlToPages(result, { site: args.site }));
  }
}

if (!bySite.size) {
  console.error("No page had two or more usable elements; nothing written.");
  process.exit(1);
}
for (const [site, pages] of bySite) {
  const file = path.join(args.out, `${site.replace(/[^a-z0-9.-]+/gi, "_")}.jsonl`);
  writeFileSync(file, pages.map((p) => JSON.stringify(p)).join("\n") + "\n");
  const elements = pages.reduce((n, p) => n + p.elements.length, 0);
  console.log(`${site}: ${pages.length} pages, ${elements} elements → ${path.relative(process.cwd(), file)}`);
}
console.log("\nNext: write queries for each page, then move the site into train.jsonl or eval.jsonl.");
