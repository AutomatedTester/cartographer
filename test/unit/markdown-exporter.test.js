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
