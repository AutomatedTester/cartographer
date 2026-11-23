/**
 * The fine-tuning pipeline's data helpers (training/lib.mjs), and the bundled
 * datasets themselves: a bad label there trains or measures the wrong thing
 * silently, so the datasets are checked on every run.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadPages,
  pageElements,
  queryTexts,
  recommendThreshold,
  toTriplets,
  validatePages,
} from "../../training/lib.mjs";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../training/data");

const page = (overrides = {}) => ({
  page: "login",
  elements: [
    { key: "go", tag: "button", text: "Log in" },
    { key: "join", tag: "a", text: "Sign up" },
    { key: "pw", tag: "input", attributes: { type: "password" } },
  ],
  queries: [
    ["sign in button", "go"],
    ["register link", "join"],
  ],
  ...overrides,
});

describe("bundled datasets", () => {
  const train = loadPages(path.join(dataDir, "train.jsonl"));
  const evalSet = loadPages(path.join(dataDir, "eval.jsonl"));

  it("the evaluation set is valid", () => {
    assert.deepEqual(validatePages(evalSet), []);
  });

  it("the training set is valid and shares no query with the evaluation set", () => {
    assert.deepEqual(validatePages(train, { heldOut: queryTexts(evalSet) }), []);
  });

  it("the evaluation set has unrelated descriptions to test false matches", () => {
    assert.ok(evalSet.every((p) => (p.unrelated ?? []).length > 0));
  });
});

describe("validatePages", () => {
  it("accepts a well-formed page", () => {
    assert.deepEqual(validatePages([page()]), []);
  });

  it("rejects a query pointing at a key that does not exist", () => {
    const problems = validatePages([page({ queries: [["missing", "nope"]] })]);
    assert.match(problems.join("\n"), /unknown key nope/);
  });

  it("rejects two elements the model would see as identical", () => {
    const elements = [
      { key: "a", tag: "button", text: "Delete" },
      { key: "b", tag: "button", text: "Delete" },
    ];
    const problems = validatePages([page({ elements, queries: [["remove", "a"]] })]);
    assert.match(problems.join("\n"), /a and b look identical/);
  });

  it("rejects a training query that is also an evaluation query, ignoring case and spacing", () => {
    const problems = validatePages([page()], { heldOut: ["Sign  In button"] });
    assert.match(problems.join("\n"), /in the evaluation set/);
  });

  it("rejects a page with only one element, which leaves no wrong answer", () => {
    const problems = validatePages([page({ elements: [{ key: "go", tag: "button", text: "Go" }] })]);
    assert.match(problems.join("\n"), /at least two elements/);
  });

  it("reports duplicate pages, keys and queries, and missing fields", () => {
    const problems = validatePages([
      page(),
      page({
        elements: [
          { key: "go", text: "Go" },
          { key: "go", tag: "a", text: "Again" },
          { tag: "a", text: "No key" },
        ],
        queries: [["twice", "go"], ["Twice", "go"], ["", "go"], "not a pair"],
      }),
      { elements: [] },
      page({ page: "empty", queries: [] }),
    ]).join("\n");

    for (const pattern of [
      /duplicate page name/,
      /duplicate key go/,
      /element go has no "tag"/,
      /element without a "key"/,
      /"Twice" appears twice/,
      /query without text/,
      /missing "page" name/,
      /page empty: no queries/,
    ]) {
      assert.match(problems, pattern);
    }
  });
});

describe("toTriplets", () => {
  it("pairs each query with its element and every other element on the page", () => {
    const rows = toTriplets([page()]);
    const forSignIn = rows.filter((r) => r.anchor === "sign in button");

    assert.equal(forSignIn.length, 2);
    assert.ok(forSignIn.every((r) => r.positive === "button, text: Log in"));
    assert.deepEqual(forSignIn.map((r) => r.negative).sort(), ["a, text: Sign up", "password input"]);
    assert.ok(rows.every((r) => r.page === "login"));
  });
});

describe("pageElements", () => {
  it("uses keys as ids, or neutral ids, and says which selector each key should produce", () => {
    const named = pageElements(page(), "key");
    assert.equal(named.expected.get("join"), "#join");
    assert.equal(named.elements[1].id, "join");

    const neutral = pageElements(page(), "neutral");
    assert.equal(neutral.expected.get("join"), "#el1");
    assert.ok(neutral.elements.every((el) => !("key" in el) && el.isVisible && el.attributes));
  });
});

describe("recommendThreshold", () => {
  it("adds a margin above the highest unrelated similarity, rounded to hundredths", () => {
    assert.equal(recommendThreshold(0.13), 0.16);
    assert.equal(recommendThreshold(0.161), 0.19);
    assert.equal(recommendThreshold(0.1, 0.05), 0.15);
  });
});

describe("loadPages", () => {
  it("skips blank and comment lines and names the line of a parse error", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pages-"));
    const file = path.join(dir, "d.jsonl");
    writeFileSync(file, `// comment\n\n${JSON.stringify(page())}\n{broken\n`);

    assert.throws(() => loadPages(file), /d\.jsonl:4/);

    writeFileSync(file, `// comment\n\n${JSON.stringify(page())}\n`);
    assert.equal(loadPages(file).length, 1);
  });
});
