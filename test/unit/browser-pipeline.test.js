/**
 * BrowserAnalysisPipeline: the end-to-end client-side analysis path.
 *
 * 337 lines with no test. This is the component that decides which elements a
 * page is reduced to and what each one is for, so its two selection paths — ML
 * and heuristic-only — need to agree about everything except the extra floor
 * the ML path applies. They quietly do not, and that is tested below.
 *
 * ML availability is detected from browser globals, so the two paths are
 * selected here by installing or withholding `globalThis.window`, rather than
 * by reaching into the instance.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { BrowserAnalysisPipeline } from "../../build/browser-pipeline.js";
import { installFakeIndexedDb } from "../helpers/fake-indexeddb.js";

let restoreIdb = null;
let hadWindow = false;

afterEach(() => {
  restoreIdb?.();
  restoreIdb = null;
  if (hadWindow) {
    delete globalThis.window;
    hadWindow = false;
  }
});

/** Make canUseML() report true by supplying the globals it probes for. */
function enableMl() {
  globalThis.window = { indexedDB: {} };
  hadWindow = true;
}

function dom(overrides = {}) {
  return { tag: "div", isVisible: true, ...overrides };
}

/** Elements the heuristic scorer rates well above any threshold used here. */
const deleteButton = dom({ tag: "button", text: "Delete Account" });
const loginButton = dom({ tag: "button", text: "Sign in" });

describe("BrowserAnalysisPipeline.initialize", () => {
  it("resolves once the embedding cache is open", async () => {
    restoreIdb = installFakeIndexedDb();
    await assert.doesNotReject(() => new BrowserAnalysisPipeline().initialize());
  });

  // The cache is an optimisation; a browser without IndexedDB, or one that
  // refuses to open it, must still get a working pipeline.
  it("resolves even when IndexedDB is unavailable entirely", async () => {
    await assert.doesNotReject(() => new BrowserAnalysisPipeline().initialize());
  });

  it("resolves even when opening the cache fails", async () => {
    restoreIdb = installFakeIndexedDb({ failOpen: true });
    await assert.doesNotReject(() => new BrowserAnalysisPipeline().initialize());
  });

  it("leaves the pipeline usable after a cache failure", async () => {
    restoreIdb = installFakeIndexedDb({ failOpen: true });
    const pipeline = new BrowserAnalysisPipeline();
    await pipeline.initialize();

    const result = await pipeline.analyzeElements([deleteButton]);
    assert.equal(result.highIntentElements.length, 1);
  });
});

describe("BrowserAnalysisPipeline.analyzeElements: result shape", () => {
  it("reports how many elements went in and how many survived", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const elements = [deleteButton, dom({ tag: "span", text: "just text" })];

    const result = await pipeline.analyzeElements(elements);

    assert.equal(result.metrics.elementsAnalyzed, 2);
    assert.equal(result.metrics.elementsClustered, result.highIntentElements.length);
    assert.equal(result.highIntentElements.length, 1, "the span is below threshold");
  });

  it("returns an empty analysis for empty input rather than throwing", async () => {
    const result = await new BrowserAnalysisPipeline().analyzeElements([]);

    assert.deepEqual(result.highIntentElements, []);
    assert.deepEqual(result.generatedTestCases, []);
    assert.equal(result.metrics.elementsAnalyzed, 0);
  });

  it("sorts surviving elements by descending intent score", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([
      dom({ tag: "a", text: "Continue" }),
      deleteButton,
      dom({ tag: "select", text: "Choose a colour" }),
    ]);

    const scores = result.highIntentElements.map((e) => e.intentScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `got ${scores}`);
  });

  it("carries identity, locator and reasons onto every surviving element", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([
      dom({
        tag: "button",
        id: "del",
        classes: ["danger", "lg"],
        role: "button",
        ariaLabel: "Delete it",
        text: "Delete Account",
      }),
    ]);

    const [element] = result.highIntentElements;
    assert.equal(element.tag, "button");
    assert.equal(element.id, "del");
    assert.deepEqual(element.classes, ["danger", "lg"]);
    assert.equal(element.role, "button");
    assert.equal(element.ariaLabel, "Delete it");
    assert.equal(element.path, "button#del.danger.lg");
    assert.ok(element.locator.length > 0, "every element needs a locator");
    assert.ok(element.intentReasons.length > 0, "and a reason it was kept");
  });

  it("builds a path from tag alone when there is no id or class", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([
      dom({ tag: "button", text: "Delete Account" }),
    ]);
    assert.equal(result.highIntentElements[0].path, "button");
  });

  it("leaves url and title for the caller to fill in", async () => {
    const result = await new BrowserAnalysisPipeline().analyzeElements([deleteButton]);
    assert.equal(result.url, "");
    assert.equal(result.title, "");
    assert.deepEqual(result.consoleLogs, []);
  });

  it("records a non-negative analysis time", async () => {
    const result = await new BrowserAnalysisPipeline().analyzeElements([deleteButton]);
    assert.ok(result.metrics.analysisTime >= 0);
  });
});

describe("BrowserAnalysisPipeline.analyzeElements: threshold", () => {
  // score 15: an aria role (+10) and a short-but-usable label (+5), no tag
  // score at all. Chosen to sit between the two paths' effective floors.
  const weak = dom({ tag: "div", role: "button", text: "hello" });

  it("defaults to a threshold of 35", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    // select(45) + label(5) = 50 clears 35; div+role+label = 15 does not.
    const result = await pipeline.analyzeElements([
      dom({ tag: "select", text: "Choose a colour" }),
      weak,
    ]);

    assert.equal(result.highIntentElements.length, 1);
    assert.equal(result.highIntentElements[0].tag, "select");
  });

  it("honours a raised threshold", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([deleteButton], {
      intentThreshold: 95,
    });
    assert.deepEqual(result.highIntentElements, [], "90 does not clear 95");
  });

  it("honours a lowered threshold on the heuristic path", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([weak], { intentThreshold: 10 });
    assert.equal(result.highIntentElements.length, 1, "15 clears 10");
  });

  // The ML path applies a hard floor of 25 *before* consulting the caller's
  // threshold, so the same element and the same threshold give different
  // answers depending on whether ML happened to be available. Documented
  // because it makes results environment-dependent, which is the one thing a
  // scoring floor should never be.
  it("applies a hidden floor of 25 on the ML path, unlike the heuristic path", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const heuristic = await pipeline.analyzeElements([weak], {
      intentThreshold: 10,
      useML: false,
    });

    enableMl();
    const ml = await pipeline.analyzeElements([weak], { intentThreshold: 10 });

    assert.equal(heuristic.highIntentElements.length, 1);
    assert.equal(ml.highIntentElements.length, 0, "silently dropped by the 25 floor");
  });
});

describe("BrowserAnalysisPipeline.analyzeElements: path selection", () => {
  it("uses heuristics and reports device 'none' when ML is unavailable", async () => {
    const result = await new BrowserAnalysisPipeline().analyzeElements([deleteButton]);
    assert.equal(result.metrics.device, "none");
  });

  it("uses ML and reports device 'wasm' when the browser globals are present", async () => {
    enableMl();
    const result = await new BrowserAnalysisPipeline().analyzeElements([deleteButton]);
    assert.equal(result.metrics.device, "wasm");
  });

  it("reports zero LLM tokens on both the ML and heuristic paths", async () => {
    const heuristic = await new BrowserAnalysisPipeline().analyzeElements([deleteButton]);
    assert.equal(heuristic.metrics.tokensUsed, 0);

    enableMl();
    const ml = await new BrowserAnalysisPipeline().analyzeElements([deleteButton]);
    assert.equal(ml.metrics.tokensUsed, 0);
  });

  it("falls back to heuristics when the caller opts out of ML", async () => {
    enableMl();
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([deleteButton], { useML: false });

    // device still reports what the environment could do, not what was used.
    assert.equal(result.highIntentElements.length, 1);
    assert.equal(result.metrics.device, "wasm");
  });

  it("agrees on well-scoring elements regardless of path", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const elements = [deleteButton, loginButton];

    const heuristic = await pipeline.analyzeElements(elements, { useML: false });
    enableMl();
    const ml = await pipeline.analyzeElements(elements);

    assert.deepEqual(
      ml.highIntentElements.map((e) => [e.tag, e.intentScore]),
      heuristic.highIntentElements.map((e) => [e.tag, e.intentScore])
    );
  });

  it("accepts useCache without changing the outcome", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const withCache = await pipeline.analyzeElements([deleteButton], { useCache: true });
    const without = await pipeline.analyzeElements([deleteButton], { useCache: false });

    assert.deepEqual(
      withCache.highIntentElements.map((e) => e.intentScore),
      without.highIntentElements.map((e) => e.intentScore)
    );
  });
});

describe("BrowserAnalysisPipeline: generated test cases", () => {
  async function testCasesFor(elements) {
    const result = await new BrowserAnalysisPipeline().analyzeElements(elements, {
      intentThreshold: 1,
      useML: false,
    });
    return result.generatedTestCases;
  }

  it("produces one test case per surviving element, with sequential ids", async () => {
    const cases = await testCasesFor([deleteButton, loginButton]);
    assert.deepEqual(cases.map((c) => c.id), ["test_0", "test_1"]);
  });

  it("names a case after the element text", async () => {
    const [testCase] = await testCasesFor([deleteButton]);
    assert.equal(testCase.name, "Test button: Delete Account");
  });

  it("falls back from text to ariaLabel to id to a generic label", async () => {
    const [byAria] = await testCasesFor([
      dom({ tag: "button", ariaLabel: "Close dialog" }),
    ]);
    assert.match(byAria.name, /Close dialog/);

    const [byId] = await testCasesFor([dom({ tag: "button", id: "go" })]);
    assert.match(byId.name, /go/);

    const [generic] = await testCasesFor([dom({ tag: "button" })]);
    assert.match(generic.name, /element/);
  });

  it("assigns priority from the intent score", async () => {
    // 90 -> critical, 45 -> high, 15 -> medium
    const [critical] = await testCasesFor([deleteButton]);
    const [high] = await testCasesFor([dom({ tag: "textarea", text: "Your comments" })]);
    const [medium] = await testCasesFor([
      dom({ tag: "div", role: "button", text: "hello" }),
    ]);

    assert.equal(critical.priority, "critical");
    assert.equal(high.priority, "high");
    assert.equal(medium.priority, "medium");
  });

  it("gives every case preconditions, steps and expected results", async () => {
    const [testCase] = await testCasesFor([deleteButton]);

    assert.ok(testCase.preconditions.length > 0);
    assert.equal(testCase.steps.length, 3);
    assert.ok(testCase.expectedResults.length > 0);
    assert.ok(
      testCase.steps.some((s) => s.includes(testCase.locator)),
      "a step must name the locator the tester has to use"
    );
  });

  it("tags each case with high-intent and the element tag", async () => {
    const [testCase] = await testCasesFor([deleteButton]);
    assert.deepEqual(testCase.tags, ["high-intent", "button"]);
  });

  it("keeps a reference back to the element that produced it", async () => {
    const [testCase] = await testCasesFor([deleteButton]);
    assert.equal(testCase.sourceElement.text, "Delete Account");
    assert.equal(testCase.intentScore, testCase.sourceElement.intentScore);
  });
});

describe("BrowserAnalysisPipeline: action type detection", () => {
  async function actionFor(element) {
    const result = await new BrowserAnalysisPipeline().analyzeElements([element], {
      intentThreshold: 1,
      useML: false,
    });
    return result.generatedTestCases[0].actionType;
  }

  it("treats inputs and textareas as input", async () => {
    assert.equal(await actionFor(dom({ tag: "input", text: "Your name" })), "input");
    assert.equal(await actionFor(dom({ tag: "textarea", text: "Comments" })), "input");
  });

  it("treats a select as select", async () => {
    assert.equal(await actionFor(dom({ tag: "select", text: "Choose one" })), "select");
  });

  it("treats delete and remove wording as a delete action", async () => {
    assert.equal(await actionFor(dom({ tag: "button", text: "Delete Account" })), "delete");
    assert.equal(await actionFor(dom({ tag: "button", text: "Remove item" })), "delete");
  });

  it("treats submit and search wording as a submit action", async () => {
    assert.equal(await actionFor(dom({ tag: "button", text: "Submit" })), "submit");
    assert.equal(await actionFor(dom({ tag: "button", text: "Search products" })), "submit");
  });

  it("treats a link as navigation", async () => {
    assert.equal(await actionFor(dom({ tag: "a", text: "Continue" })), "navigate");
  });

  it("falls back to click for anything else", async () => {
    assert.equal(await actionFor(dom({ tag: "button", text: "Add to basket" })), "click");
  });

  // Wording is checked before the tag, so a link whose label says 'Delete' is
  // a delete, not a navigation. That ordering is deliberate and worth pinning:
  // reversing it would turn destructive links into harmless-looking nav tests.
  it("lets destructive wording win over the link tag", async () => {
    assert.equal(await actionFor(dom({ tag: "a", text: "Delete Account" })), "delete");
  });

  // ...but the tag wins for form controls, so an input labelled 'Submit' is
  // still something you type into.
  it("lets the input tag win over submit wording", async () => {
    assert.equal(await actionFor(dom({ tag: "input", text: "Submit" })), "input");
  });
});

describe("BrowserAnalysisPipeline.exportJSON", () => {
  it("round-trips the analysis result", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([deleteButton]);

    const parsed = JSON.parse(pipeline.exportJSON(result));

    assert.equal(parsed.highIntentElements.length, 1);
    assert.equal(parsed.highIntentElements[0].text, "Delete Account");
    assert.equal(parsed.metrics.elementsAnalyzed, 1);
  });

  it("produces indented output, not one line", () => {
    const pipeline = new BrowserAnalysisPipeline();
    const json = pipeline.exportJSON({ url: "", title: "", highIntentElements: [], consoleLogs: [] });
    assert.ok(json.includes("\n"), "should be pretty-printed");
  });
});

describe("BrowserAnalysisPipeline.exportMarkdown", () => {
  it("summarises counts and timings", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([deleteButton, loginButton]);

    const md = pipeline.exportMarkdown(result);

    assert.match(md, /^# Analysis Results/);
    assert.match(md, /Elements Analyzed: 2/);
    assert.match(md, /High-Intent Elements: 2/);
    assert.match(md, /Test Cases Generated: 2/);
  });

  it("lists every high-intent element with its score, locator and reasons", async () => {
    const pipeline = new BrowserAnalysisPipeline();
    const result = await pipeline.analyzeElements([deleteButton]);

    const md = pipeline.exportMarkdown(result);

    assert.match(md, /### Delete Account/);
    assert.match(md, /\*\*Tag:\*\* button/);
    assert.match(md, /\*\*Score:\*\* 90/);
    assert.match(md, /\*\*Locator:\*\* `.+`/);
    assert.match(md, /\*\*Reasons:\*\* .+/);
  });

  it("reports 'unknown' rather than blank when metrics are absent", () => {
    const md = new BrowserAnalysisPipeline().exportMarkdown({
      url: "",
      title: "",
      highIntentElements: [],
      consoleLogs: [],
    });

    assert.match(md, /Elements Analyzed: unknown/);
    assert.match(md, /Test Cases Generated: 0/);
    assert.match(md, /Analysis Time: 0ms/);
  });

  it("falls back to ariaLabel then tag for an element heading", () => {
    const pipeline = new BrowserAnalysisPipeline();
    const md = pipeline.exportMarkdown({
      url: "",
      title: "",
      consoleLogs: [],
      highIntentElements: [
        { tag: "button", ariaLabel: "Close", locator: "#a", intentScore: 1, intentReasons: [] },
        { tag: "section", locator: "#b", intentScore: 1, intentReasons: [] },
      ],
    });

    assert.match(md, /### Close/);
    assert.match(md, /### section/);
  });

  it("renders an empty analysis without crashing", () => {
    const md = new BrowserAnalysisPipeline().exportMarkdown({
      url: "",
      title: "",
      highIntentElements: [],
      consoleLogs: [],
      metrics: { elementsAnalyzed: 0, analysisTime: 0 },
    });
    assert.match(md, /High-Intent Elements: 0/);
  });
});
