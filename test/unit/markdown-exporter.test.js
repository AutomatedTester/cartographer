import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MarkdownExporter } from "../../build/markdown-exporter.js";
import { TestCaseGenerator } from "../../build/test-case-generator.js";

function element(overrides = {}) {
  return {
    path: "body > button",
    tag: "button",
    text: "Submit",
    locator: "#submit",
    intentScore: 60,
    intentReasons: ["button tag"],
    ...overrides,
  };
}

/** Elements spanning every priority band. */
const mixedElements = [
  element({ text: "Checkout", locator: "#checkout", intentScore: 95 }),
  element({ text: "Search", locator: "#search", intentScore: 45 }),
  element({ text: "Filter", locator: "#filter", intentScore: 35 }),
  element({ text: "Footer link", locator: "#footer", intentScore: 10, tag: "a" }),
];

function analysisResult(overrides = {}) {
  const highIntentElements = overrides.highIntentElements ?? mixedElements;
  return {
    url: "https://example.test/cart",
    title: "Cart Page",
    highIntentElements,
    generatedTestCases: TestCaseGenerator.generate(highIntentElements, "Cart Page"),
    consoleLogs: [],
    ...overrides,
  };
}

describe("MarkdownExporter.exportFull", () => {
  it("includes the page url and title", () => {
    const md = MarkdownExporter.exportFull(analysisResult());
    assert.match(md, /https:\/\/example\.test\/cart/);
    assert.match(md, /Cart Page/);
  });

  it("includes every high-intent element locator", () => {
    const md = MarkdownExporter.exportFull(analysisResult());
    for (const el of mixedElements) {
      assert.ok(md.includes(el.locator), `missing locator ${el.locator}`);
    }
  });

  it("renders without test cases present", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({ generatedTestCases: undefined })
    );
    assert.ok(md.length > 0);
    assert.match(md, /example\.test/);
  });

  it("renders for a page with no high-intent elements", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({ highIntentElements: [], generatedTestCases: [] })
    );
    assert.ok(md.length > 0, "should still produce a report");
  });

  it("produces valid markdown headings", () => {
    const md = MarkdownExporter.exportFull(analysisResult());
    const headings = md.match(/^#{1,4} .+$/gm) ?? [];
    assert.ok(headings.length >= 3, `expected several headings, got ${headings.length}`);
    assert.ok(headings[0].startsWith("# "), "first heading should be level 1");
  });

  it("surfaces an analysis error when one is present", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({ error: "model load timed out" })
    );
    assert.match(md, /model load timed out/);
  });

  it("reports zero LLM tokens and the ML device in the summary", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({
        metrics: {
          device: "webnn",
          modelLoadTime: 120.4,
          analysisTime: 80.6,
          deduplicationTime: 3.2,
          elementsAnalyzed: 12,
          elementsClustered: 4,
          tokensUsed: 0,
        },
      })
    );
    assert.match(md, /\*\*Analysis Device:\*\* WEBNN \(browser-side ML/);
    assert.match(md, /\*\*LLM Tokens Used:\*\* 0 \(no cloud LLM calls/);
    assert.match(md, /### Performance Metrics/);
    assert.match(md, /\*\*Model Load Time:\*\* 120ms/);
    assert.match(md, /\*\*Elements After Clustering:\*\* 4/);
  });

  it("renders the reported token count rather than a fixed zero", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({ metrics: { device: "wasm", tokensUsed: 42 } })
    );
    const tokenLines = md.split("\n").filter((l) => l.includes("LLM Tokens Used"));
    assert.equal(tokenLines.length, 2, "summary and performance metrics both report tokens");
    for (const line of tokenLines) {
      assert.match(line, /\*\*LLM Tokens Used:\*\* 42\b/);
    }
  });

  it("does not claim ML inference when the heuristic fallback ran", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({ metrics: { device: "none", tokensUsed: 0 } })
    );
    assert.match(md, /\*\*Analysis Device:\*\* none \(heuristic scoring/);
    assert.doesNotMatch(md, /browser-side ML/);
  });

  it("says the device is unknown rather than guessing when metrics are absent", () => {
    const md = MarkdownExporter.exportFull(analysisResult());
    assert.match(md, /\*\*Analysis Device:\*\* unknown/);
    assert.match(md, /\*\*LLM Tokens Used:\*\* 0/);
    assert.doesNotMatch(md, /### Performance Metrics/);
  });

  it("renders partial metrics without throwing", () => {
    const md = MarkdownExporter.exportFull(
      analysisResult({ metrics: { elementsAnalyzed: 0, analysisTime: 0 } })
    );
    assert.match(md, /\*\*DOM Analysis Time:\*\* 0ms/);
    assert.match(md, /\*\*Model Load Time:\*\* unknown/);
  });
});

describe("MarkdownExporter.exportTestCases", () => {
  it("reports the total number of test cases", () => {
    const testCases = TestCaseGenerator.generate(mixedElements, "Cart");
    const md = MarkdownExporter.exportTestCases(testCases);
    assert.match(md, new RegExp(`\\*\\*Total Test Cases:\\*\\* ${testCases.length}`));
  });

  it("orders priority groups from critical down to low", () => {
    const md = MarkdownExporter.exportTestCases(
      TestCaseGenerator.generate(mixedElements, "Cart")
    );

    const positions = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
      .map((p) => md.toUpperCase().indexOf(p))
      .filter((i) => i >= 0);

    const sorted = [...positions].sort((a, b) => a - b);
    assert.deepEqual(positions, sorted, "priority groups are out of order");
  });

  it("omits priority groups that have no test cases", () => {
    const md = MarkdownExporter.exportTestCases(
      TestCaseGenerator.generate(
        [element({ text: "Only critical", locator: "#c", intentScore: 95 })],
        "Page"
      )
    );
    assert.doesNotMatch(md, /LOW Priority/i);
  });

  it("handles an empty list", () => {
    const md = MarkdownExporter.exportTestCases([]);
    assert.match(md, /Total Test Cases:\*\* 0/);
  });
});

describe("MarkdownExporter.exportTestCasesList", () => {
  it("lists each test case with locator, type and score", () => {
    const testCases = TestCaseGenerator.generate(
      [element({ text: "Checkout", locator: "#checkout", intentScore: 95 })],
      "Cart"
    );
    const md = MarkdownExporter.exportTestCasesList(testCases);

    assert.match(md, /`#checkout`/);
    assert.match(md, /Type: click/);
    assert.match(md, /Score: 95/);
  });

  it("counts the entries in each priority heading", () => {
    const testCases = TestCaseGenerator.generate(
      [
        element({ text: "A", locator: "#a", intentScore: 90 }),
        element({ text: "B", locator: "#b", intentScore: 80 }),
      ],
      "Page"
    );
    const md = MarkdownExporter.exportTestCasesList(testCases);
    assert.match(md, /CRITICAL Priority \(2\)/);
  });

  it("handles an empty list without throwing", () => {
    assert.doesNotThrow(() => MarkdownExporter.exportTestCasesList([]));
  });

  it("does not let element text break out of the markdown list", () => {
    const testCases = TestCaseGenerator.generate(
      [element({ text: "Weird `backtick` and **bold**", locator: "#w", intentScore: 95 })],
      "Page"
    );
    const md = MarkdownExporter.exportTestCasesList(testCases);

    // Every locator line must remain a single list item.
    const locatorLines = md.split("\n").filter((l) => l.includes("Locator:"));
    assert.equal(locatorLines.length, 1);
    assert.match(locatorLines[0], /^\s+- Locator: `#w`$/);
  });
});

// ===========================================================================
// Workflow exporters
//
// These four are what `export_workflow_visualization` returns to the MCP
// client, i.e. the entire user-visible product of workflow detection. All of
// them were untested: lines 239-414 of the module, every workflow format it
// can emit. A detector that works and an exporter that drops half the result
// are indistinguishable from the outside.
// ===========================================================================

function action(overrides = {}) {
  return {
    pageUrl: "https://shop.test/cart",
    elementLocator: "#checkout",
    actionType: "click",
    timestamp: 1,
    ...overrides,
  };
}

function workflow(overrides = {}) {
  return {
    id: "wf_1",
    name: "checkout_flow",
    pageSequence: ["https://shop.test/cart", "https://shop.test/pay"],
    actionSequence: [action()],
    stateTransitions: [],
    confidence: 82,
    tags: ["ecommerce", "checkout"],
    ...overrides,
  };
}

describe("MarkdownExporter.exportDetectedWorkflows", () => {
  it("reports the total and lists each workflow", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([
      workflow(),
      workflow({ id: "wf_2", name: "login_flow", tags: ["auth"] }),
    ]);

    assert.match(md, /^# Detected Workflows/);
    assert.match(md, /\*\*Total Workflows Found:\*\* 2/);
    assert.match(md, /### checkout_flow/);
    assert.match(md, /### login_flow/);
  });

  it("says so plainly when nothing was detected", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([]);

    assert.match(md, /\*\*Total Workflows Found:\*\* 0/);
    assert.match(md, /No workflows detected/);
    assert.ok(!md.includes("## Workflow Summary"), "no empty summary section");
  });

  it("groups by the first tag and averages confidence per group", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([
      workflow({ confidence: 80, tags: ["auth"] }),
      workflow({ id: "wf_2", confidence: 90, tags: ["auth"] }),
      workflow({ id: "wf_3", confidence: 60, tags: ["ecommerce"] }),
    ]);

    assert.match(md, /\*\*auth:\*\* 2 workflows \(avg confidence: 85%\)/);
    assert.match(md, /\*\*ecommerce:\*\* 1 workflows \(avg confidence: 60%\)/);
  });

  it("files an untagged workflow under 'unknown' instead of dropping it", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([
      workflow({ tags: [] }),
      workflow({ id: "wf_2", tags: undefined }),
    ]);

    assert.match(md, /\*\*unknown:\*\* 2 workflows/);
  });

  it("rounds an average confidence rather than emitting a fraction", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([
      workflow({ confidence: 80, tags: ["auth"] }),
      workflow({ id: "wf_2", confidence: 81, tags: ["auth"] }),
    ]);

    assert.match(md, /avg confidence: 81%/);
  });

  it("lists pages and actions for each workflow", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([workflow()]);

    assert.match(md, /\*\*ID:\*\* `wf_1`/);
    assert.match(md, /\*\*Confidence:\*\* 82%/);
    assert.match(md, /\*\*Tags:\*\* `ecommerce` `checkout`/);
    assert.match(md, /1\. https:\/\/shop\.test\/cart/);
    assert.match(md, /\*\*Actions:\*\*/);
    assert.match(md, /1\. click on \/cart/);
  });

  it("omits the pages and actions headings when there are none", () => {
    const md = MarkdownExporter.exportDetectedWorkflows([
      workflow({ pageSequence: [], actionSequence: [] }),
    ]);

    assert.ok(!md.includes("**Pages:**"));
    assert.ok(!md.includes("**Actions:**"));
  });

  it("survives a workflow missing its optional arrays", () => {
    assert.doesNotThrow(() =>
      MarkdownExporter.exportDetectedWorkflows([
        { id: "w", name: "bare", confidence: 10 },
      ])
    );
  });
});

describe("MarkdownExporter.exportWorkflowSequence", () => {
  it("heads the document with the workflow name, confidence and id", () => {
    const md = MarkdownExporter.exportWorkflowSequence(workflow());

    assert.match(md, /^# Workflow: checkout_flow/);
    assert.match(md, /\*\*Confidence:\*\* 82%/);
    assert.match(md, /\*\*ID:\*\* `wf_1`/);
    assert.match(md, /\*\*Tags:\*\* `ecommerce` `checkout`/);
  });

  it("draws the page sequence as a fenced flow of paths", () => {
    const md = MarkdownExporter.exportWorkflowSequence(workflow());

    assert.match(md, /## Page Sequence/);
    assert.match(md, /```\n1\. \/cart\n     ↓\n2\. \/pay\n```/);
  });

  it("numbers each action and names its locator", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({
        actionSequence: [
          action({ actionType: "input", elementLocator: "#email" }),
          action({ actionType: "submit", elementLocator: "#go" }),
        ],
      })
    );

    assert.match(md, /1\. \*\*input\*\*: on \/cart/);
    assert.match(md, /   - Locator: #email/);
    assert.match(md, /2\. \*\*submit\*\*: on \/cart/);
  });

  it("includes a resulting navigation and action data when present", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({
        actionSequence: [
          action({
            resultingNavigation: "https://shop.test/thanks",
            actionData: { email: "a@b.test" },
          }),
        ],
      })
    );

    assert.match(md, /- Navigates to: https:\/\/shop\.test\/thanks/);
    assert.match(md, /- Data: \{"email":"a@b\.test"\}/);
  });

  it("omits the data line for empty action data rather than printing {}", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({ actionSequence: [action({ actionData: {} })] })
    );
    assert.ok(!md.includes("- Data:"));
  });

  it("renders state transitions with their changes", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({
        stateTransitions: [
          {
            fromPage: "https://shop.test/cart",
            toPage: "https://shop.test/pay",
            action: action({ actionType: "click", elementLocator: "#next" }),
            stateChanges: { loggedIn: true },
          },
        ],
      })
    );

    assert.match(md, /## State Transitions/);
    assert.match(md, /\*\*\/cart\*\* → \*\*\/pay\*\*/);
    assert.match(md, /- Action: click on #next/);
    assert.match(md, /- State Changes: \{"loggedIn":true\}/);
  });

  it("omits the state changes line when nothing changed", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({
        stateTransitions: [
          {
            fromPage: "https://shop.test/a",
            toPage: "https://shop.test/b",
            action: action(),
            stateChanges: {},
          },
        ],
      })
    );
    assert.ok(!md.includes("- State Changes:"));
  });

  it("omits every optional section for a bare workflow", () => {
    const md = MarkdownExporter.exportWorkflowSequence({
      id: "w",
      name: "bare",
      confidence: 5,
      pageSequence: [],
      actionSequence: [],
      stateTransitions: [],
      tags: [],
    });

    assert.match(md, /# Workflow: bare/);
    assert.ok(!md.includes("## Page Sequence"));
    assert.ok(!md.includes("## Actions Performed"));
    assert.ok(!md.includes("## State Transitions"));
    assert.ok(!md.includes("**Tags:**"));
  });

  // extractPathFromUrl falls back to the raw string when URL parsing fails,
  // so a malformed page url degrades the diagram rather than throwing.
  it("prints a malformed url verbatim instead of throwing", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({ pageSequence: ["not-a-url"] })
    );
    assert.match(md, /1\. not-a-url/);
  });

  it("renders a root url as /", () => {
    const md = MarkdownExporter.exportWorkflowSequence(
      workflow({ pageSequence: ["https://shop.test"] })
    );
    assert.match(md, /1\. \//);
  });
});

describe("MarkdownExporter.exportWorkflowComparison", () => {
  it("builds a table row per workflow", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      workflow(),
      workflow({ id: "wf_2", name: "login_flow", tags: ["auth"], confidence: 70 }),
    ]);

    assert.match(md, /^# Workflow Comparison/);
    assert.match(md, /\*\*Workflows Compared:\*\* 2/);
    assert.match(md, /\| Workflow \| Type \| Pages \| Actions \| Confidence \|/);
    assert.match(md, /\| checkout_flow \| ecommerce \| 2 \| 1 \| 82% \|/);
    assert.match(md, /\| login_flow \| auth \| 2 \| 1 \| 70% \|/);
  });

  it("counts missing sequences as zero rather than printing undefined", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      { id: "w", name: "bare", confidence: 10 },
    ]);
    assert.match(md, /\| bare \| unknown \| 0 \| 0 \| 10% \|/);
  });

  it("omits the comparison section for a single workflow", () => {
    const md = MarkdownExporter.exportWorkflowComparison([workflow()]);
    assert.ok(!md.includes("## Common Patterns"));
  });

  it("flags two workflows that walk the same pages", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      workflow(),
      workflow({ id: "wf_2", name: "duplicate_flow" }),
    ]);

    assert.match(md, /## Common Patterns/);
    assert.match(md, /\*\*Duplicate Page Sequences Detected:\*\*/);
    assert.match(md, /https:\/\/shop\.test\/cart → https:\/\/shop\.test\/pay/);
  });

  it("reports a duplicated sequence once, however many workflows share it", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      workflow(),
      workflow({ id: "wf_2" }),
      workflow({ id: "wf_3" }),
    ]);

    const mentions = md
      .split("\n")
      .filter((l) => l.trim().startsWith("- https://shop.test/cart →"));
    assert.equal(mentions.length, 1);
  });

  it("says nothing about duplicates when every sequence differs", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      workflow({ pageSequence: ["https://shop.test/a"] }),
      workflow({ id: "wf_2", pageSequence: ["https://shop.test/b"] }),
    ]);

    assert.ok(!md.includes("Duplicate Page Sequences"));
  });

  it("tallies how many workflows use each action type", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      workflow({ actionSequence: [action({ actionType: "click" })] }),
      workflow({
        id: "wf_2",
        pageSequence: ["https://shop.test/x"],
        actionSequence: [
          action({ actionType: "click" }),
          action({ actionType: "input" }),
        ],
      }),
    ]);

    assert.match(md, /\*\*Common Action Types:\*\*/);
    assert.match(md, /- click \(in 2\/2 workflows\)/);
    assert.match(md, /- input \(in 1\/2 workflows\)/);
  });

  it("omits the action type list when no workflow has actions", () => {
    const md = MarkdownExporter.exportWorkflowComparison([
      workflow({ actionSequence: [], pageSequence: ["https://shop.test/a"] }),
      workflow({ id: "wf_2", actionSequence: [], pageSequence: ["https://shop.test/b"] }),
    ]);

    assert.ok(!md.includes("Common Action Types"));
  });

  it("handles an empty workflow list without throwing", () => {
    const md = MarkdownExporter.exportWorkflowComparison([]);
    assert.match(md, /\*\*Workflows Compared:\*\* 0/);
  });
});
