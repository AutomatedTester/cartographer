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
  crawlScope,
  crawlToPages,
  loadPages,
  pageElements,
  queryTexts,
  recommendThreshold,
  sharedSites,
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

  it("no site is in both datasets", () => {
    assert.deepEqual(sharedSites(train, evalSet), []);
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

describe("sharedSites", () => {
  it("names sites present on both sides and ignores pages without a site", () => {
    const train = [page({ site: "a.test" }), page({ site: "b.test" }), page()];
    const evalSet = [page({ site: "b.test" }), page()];
    assert.deepEqual(sharedSites(train, evalSet), ["b.test"]);
    assert.deepEqual(sharedSites(train, [page({ site: "c.test" })]), []);
  });
});

describe("crawlToPages", () => {
  const crawled = (url, highIntentElements) => ({ url, title: "t", highIntentElements, consoleLogs: [] });
  const login = crawled("https://shop.test/login?next=%2F", [
    {
      tag: "BUTTON",
      text: "  Sign\n   in ",
      id: "login-btn",
      classes: ["btn"],
      locator: "#login-btn",
      intentScore: 80,
      intentReasons: ["submit"],
      attributes: { type: "submit", class: "btn", onclick: "go()" },
    },
    { tag: "a", text: "Create an account", attributes: { href: "/register" } },
    { tag: "a", text: "Create an account", attributes: { href: "/register" } }, // footer repeat
    { tag: "input", attributes: { type: "password" } }, // typed input: kept
    { tag: "div", attributes: { class: "overlay" } }, // nothing to match: dropped
    { tag: "p", text: "x".repeat(300) },
  ]);

  it("keeps the fields the model reads, drops repeats and blanks, and leaves queries empty", () => {
    const [draft] = crawlToPages({ session: { pages: [login] } });

    assert.equal(draft.page, "shop-test-login");
    assert.equal(draft.site, "shop.test");
    assert.equal(draft.url, "https://shop.test/login?next=%2F");
    assert.deepEqual(draft.queries, []);
    assert.deepEqual(draft.elements[0], {
      key: "login-btn",
      tag: "button",
      text: "Sign in",
      id: "login-btn",
      attributes: { type: "submit" },
    });
    assert.deepEqual(
      draft.elements.map((e) => e.key),
      ["login-btn", "create-an-account", "password-input", draft.elements[3].key]
    );
    assert.ok(draft.elements[3].text.length <= 120 && draft.elements[3].text.endsWith("…"));
  });

  it("produces pages that pass validation once queries are added", () => {
    const [draft] = crawlToPages([login]);
    draft.queries = [["log in", "login-btn"]];
    assert.deepEqual(validatePages([draft]), []);
  });

  it("names pages uniquely, takes a site override, and skips pages with under two usable elements", () => {
    const home = crawled("https://shop.test/", [
      { tag: "a", text: "Cart" },
      { tag: "a", text: "Help" },
    ]);
    const homeAgain = crawled("https://shop.test/", [
      { tag: "a", text: "Cart" },
      { tag: "a", text: "About" },
    ]);
    const thin = crawled("https://shop.test/empty", [{ tag: "a", text: "Only" }]);

    const drafts = crawlToPages([home, homeAgain, thin, { url: "https://x.test/" }], { site: "shop" });
    assert.deepEqual(drafts.map((p) => p.page), ["shop-home", "shop-home-2"]);
    assert.ok(drafts.every((p) => p.site === "shop"));
  });

  it("keeps one copy of a page several URLs render identically", () => {
    const wall = (url) => crawled(url, [
      { tag: "button", text: "Log In" },
      { tag: "a", text: "Forgot password" },
    ]);
    const drafts = crawlToPages([wall("https://shop.test/orders"), wall("https://shop.test/offers")]);
    assert.deepEqual(drafts.map((p) => p.url), ["https://shop.test/orders"]);
  });

  it("accepts a single crawl_and_analyze result", () => {
    assert.equal(crawlToPages(login).length, 1);
  });
});

describe("crawlScope", () => {
  it("keeps a crawl on the start page's origin and folder", () => {
    const scope = new RegExp(crawlScope("https://org.github.io/demo/index.html"));
    assert.ok(scope.test("https://org.github.io/demo/upload.html"));
    assert.ok(!scope.test("https://org.github.io/other/"));
    assert.ok(!scope.test("https://applepaydemo.apple.com/"));
    assert.ok(!scope.test("https://orgXgithub.io/demo/"));

    const root = new RegExp(crawlScope("shop.test"));
    assert.ok(root.test("https://shop.test/cart"));
    assert.ok(!root.test("https://shop.test.evil.example/"));
  });
});
