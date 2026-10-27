/**
 * The in-page ARIA collector, run against a fake DOM.
 *
 * The rules in aria-auditor.ts are only as good as what the collector tells
 * them: if it gets focusability or the accessible name wrong, every rule
 * downstream gives the wrong advice. These pin the DOM-facing decisions.
 * integration/aria-audit.test.js checks the same function in real Chrome.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { h, snapshotOf } from "../helpers/aria-dom.js";
import { collectAriaSnapshot } from "../../build/aria-collector.js";

/** The single collected element matching a locator. */
function only(snapshot, locator) {
  const found = snapshot.elements.filter((e) => e.locator === locator);
  assert.equal(found.length, 1, `expected one element at ${locator}, got ${JSON.stringify(snapshot.elements.map((e) => e.locator))}`);
  return found[0];
}

describe("ARIA collector: what gets collected", () => {
  it("collects elements carrying role or aria-*, landmarks and custom focus targets, and nothing else", () => {
    const snap = snapshotOf([
      h("div", { id: "plain" }, "just text"),
      h("div", { id: "roled", role: "note" }, "a note"),
      h("span", { id: "labelled", "aria-label": "x" }),
      h("nav", { id: "nav" }, h("a", { id: "home", href: "/" }, "Home")),
      h("div", { id: "custom", tabindex: "0" }, "focus me"),
      h("button", { id: "btn" }, "native, no aria"),
    ]);

    assert.deepEqual(
      snap.elements.map((e) => e.locator).sort(),
      ["#custom", "#labelled", "#nav", "#roled"]
    );
    assert.equal(snap.elementsScanned, 7);
    assert.equal(snap.truncated, false);
  });

  it("skips content that is not rendered, including descendants of hidden ancestors", () => {
    const snap = snapshotOf([
      h("div", { id: "gone", role: "button", $style: { display: "none" } }),
      h("div", { $style: { display: "none" } }, h("span", { id: "inside", role: "img" })),
      h("div", { id: "invisible", role: "button", $style: { visibility: "hidden" } }),
      h("div", { id: "attr-hidden", role: "button", hidden: "" }),
      h("div", { id: "shown", role: "button" }, "Go"),
    ]);

    assert.deepEqual(snap.elements.map((e) => e.locator), ["#shown"]);
  });

  it("marks the snapshot as truncated when the element cap is hit", () => {
    const snap = snapshotOf(
      [1, 2, 3, 4].map((n) => h("span", { id: `s${n}`, "aria-label": `n${n}` })),
      { maxElements: 2 }
    );

    assert.equal(snap.elements.length, 2);
    assert.equal(snap.truncated, true);
  });

  it("reports the page url and title", () => {
    const snap = snapshotOf([], { url: "https://shop.test/x", title: "Shop" });
    assert.equal(snap.url, "https://shop.test/x");
    assert.equal(snap.title, "Shop");
  });

  it("copes with a document that has no body", () => {
    const saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = { body: null, title: "", getElementById: () => null };
    globalThis.window = { location: { href: "about:blank" }, getComputedStyle: () => ({}) };
    try {
      const snap = collectAriaSnapshot(["button"]);
      assert.deepEqual(snap.elements, []);
      assert.equal(snap.title, "Untitled");
    } finally {
      Object.assign(globalThis, saved);
    }
  });
});

describe("ARIA collector: roles", () => {
  it("takes the first valid token of the role attribute, falling back to the native role", () => {
    const snap = snapshotOf([
      h("div", { id: "fallback", role: "fancy button" }, "x"),
      h("button", { id: "bogus", role: "nonsense" }, "x"),
      h("div", { id: "upper", role: "BUTTON" }, "x"),
    ]);

    assert.equal(only(snap, "#fallback").effectiveRole, "button");
    assert.equal(only(snap, "#bogus").effectiveRole, "button");
    assert.equal(only(snap, "#bogus").implicitRole, "button");
    assert.equal(only(snap, "#upper").effectiveRole, "button");
  });

  it("computes native roles for the elements the rules care about", () => {
    const cases = [
      [h("a", { id: "x", href: "/", "aria-label": "l" }), "link"],
      [h("a", { id: "x", "aria-label": "l" }), "generic"],
      [h("input", { id: "x", type: "checkbox", "aria-label": "l" }), "checkbox"],
      [h("input", { id: "x", type: "radio", "aria-label": "l" }), "radio"],
      [h("input", { id: "x", type: "submit", "aria-label": "l" }), "button"],
      [h("input", { id: "x", type: "range", "aria-label": "l" }), "slider"],
      [h("input", { id: "x", type: "number", "aria-label": "l" }), "spinbutton"],
      [h("input", { id: "x", type: "search", "aria-label": "l" }), "searchbox"],
      [h("input", { id: "x", "aria-label": "l" }), "textbox"],
      [h("input", { id: "x", type: "hidden", "aria-label": "l" }), null],
      [h("select", { id: "x", "aria-label": "l" }), "combobox"],
      [h("select", { id: "x", multiple: "", "aria-label": "l" }), "listbox"],
      [h("textarea", { id: "x", "aria-label": "l" }), "textbox"],
      [h("main", { id: "x" }), "main"],
      [h("aside", { id: "x" }), "complementary"],
      [h("header", { id: "x" }), "banner"],
      [h("footer", { id: "x" }), "contentinfo"],
      [h("search", { id: "x" }), "search"],
      [h("form", { id: "x", "aria-label": "l" }), "form"],
      [h("form", { id: "x", "aria-describedby": "l" }), "generic"],
      [h("section", { id: "x", "aria-label": "l" }), "region"],
      [h("section", { id: "x", "aria-describedby": "l" }), "generic"],
      [h("article", { id: "x", "aria-label": "l" }), "article"],
      [h("h3", { id: "x", "aria-label": "l" }), "heading"],
      [h("ul", { id: "x", "aria-label": "l" }), "list"],
      [h("li", { id: "x", "aria-label": "l" }), "listitem"],
      [h("table", { id: "x", "aria-label": "l" }), "table"],
      [h("tbody", { id: "x", "aria-label": "l" }), "rowgroup"],
      [h("tr", { id: "x", "aria-label": "l" }), "row"],
      [h("td", { id: "x", "aria-label": "l" }), "cell"],
      [h("th", { id: "x", "aria-label": "l" }), "columnheader"],
      [h("img", { id: "x", alt: "", "aria-label": "l" }), "presentation"],
      [h("img", { id: "x", alt: "a", "aria-label": "l" }), "img"],
      [h("dialog", { id: "x", "aria-label": "l" }), "dialog"],
      [h("option", { id: "x", "aria-label": "l" }), "option"],
      [h("progress", { id: "x", "aria-label": "l" }), "progressbar"],
      [h("meter", { id: "x", "aria-label": "l" }), "meter"],
      [h("hr", { id: "x", "aria-label": "l" }), "separator"],
      [h("fieldset", { id: "x", "aria-label": "l" }), "group"],
      [h("output", { id: "x", "aria-label": "l" }), "status"],
      [h("p", { id: "x", "aria-label": "l" }), "paragraph"],
      [h("span", { id: "x", "aria-label": "l" }), "generic"],
      [h("my-widget", { id: "x", "aria-label": "l" }), "generic"],
      [h("svg", { id: "x", "aria-label": "l" }), null],
    ];

    for (const [el, expected] of cases) {
      const snap = snapshotOf([el]);
      assert.equal(
        only(snap, "#x").implicitRole,
        expected,
        `${el.tagName.toLowerCase()} ${JSON.stringify(el.attributes)}`
      );
    }
  });

  it("only treats header and footer as page landmarks outside sectioning content", () => {
    const snap = snapshotOf([
      h("header", { id: "page-header" }),
      h("article", {}, h("header", { id: "article-header", "aria-label": "x" })),
    ]);

    assert.equal(only(snap, "#page-header").implicitRole, "banner");
    assert.equal(only(snap, "#article-header").implicitRole, "generic");
  });
});

describe("ARIA collector: focus", () => {
  it("knows which elements a keyboard user can reach", () => {
    const snap = snapshotOf([
      h("div", { id: "plain", role: "button" }, "x"),
      h("div", { id: "zero", role: "button", tabindex: "0" }, "x"),
      h("div", { id: "minus", role: "tab", tabindex: "-1" }, "x"),
      h("div", { id: "junk", role: "button", tabindex: "abc" }, "x"),
      h("button", { id: "native", "aria-pressed": "false" }, "x"),
      h("button", { id: "off", disabled: "", "aria-pressed": "false" }, "x"),
      h("div", { id: "edit", role: "textbox", contenteditable: "true" }),
      h("iframe", { id: "frame", "aria-label": "x" }),
      h("video", { id: "video", controls: "", "aria-label": "x" }),
      h("summary", { id: "summary", "aria-label": "x" }),
    ]);

    const focus = (loc) => [only(snap, loc).focusable, only(snap, loc).tabbable];
    assert.deepEqual(focus("#plain"), [false, false]);
    assert.deepEqual(focus("#zero"), [true, true]);
    assert.deepEqual(focus("#minus"), [true, false]);
    assert.deepEqual(focus("#junk"), [false, false]);
    assert.deepEqual(focus("#native"), [true, true]);
    assert.deepEqual(focus("#off"), [false, false]);
    assert.deepEqual(focus("#edit"), [true, true]);
    assert.deepEqual(focus("#frame"), [true, true]);
    assert.deepEqual(focus("#video"), [true, true]);
    assert.equal(only(snap, "#summary").nativelyInteractive, true);
    assert.equal(only(snap, "#off").disabled, true);
  });

  it("counts focusable descendants of aria-hidden content", () => {
    const snap = snapshotOf([
      h("div", { id: "hidden", "aria-hidden": "true" },
        h("a", { href: "/a" }, "a"),
        h("div", {}, h("button", {}, "b")),
        h("button", { $style: { display: "none" } }, "not rendered")
      ),
    ]);

    assert.equal(only(snap, "#hidden").focusableDescendants, 2);
  });

  it("treats aria-disabled as disabled", () => {
    const snap = snapshotOf([h("div", { id: "d", role: "button", "aria-disabled": "TRUE" }, "x")]);
    assert.equal(only(snap, "#d").disabled, true);
  });
});

describe("ARIA collector: accessible names", () => {
  it("prefers aria-labelledby, then aria-label, then content", () => {
    const snap = snapshotOf([
      h("span", { id: "lbl" }, "From label"),
      h("div", { id: "a", role: "button", "aria-labelledby": "lbl", "aria-label": "ignored" }, "content"),
      h("div", { id: "b", role: "button", "aria-label": "  Spaced   out " }, "content"),
      h("div", { id: "c", role: "button" }, "Content ", h("img", { alt: "icon" }), h("span", { "aria-hidden": "true" }, "hidden")),
      h("div", { id: "d", role: "button", "aria-labelledby": "missing" }, "fallback"),
    ]);

    assert.deepEqual([only(snap, "#a").accessibleName, only(snap, "#a").nameSource], ["From label", "aria-labelledby"]);
    assert.deepEqual([only(snap, "#b").accessibleName, only(snap, "#b").nameSource], ["Spaced out", "aria-label"]);
    assert.deepEqual([only(snap, "#c").accessibleName, only(snap, "#c").nameSource], ["Content icon", "content"]);
    assert.equal(only(snap, "#c").visibleText, "Content icon");
    assert.deepEqual([only(snap, "#d").accessibleName, only(snap, "#d").nameSource], ["fallback", "content"]);
  });

  it("does not name roles from content when the role does not allow it", () => {
    const snap = snapshotOf([h("div", { id: "dlg", role: "dialog" }, "Lots of text")]);
    assert.deepEqual([only(snap, "#dlg").accessibleName, only(snap, "#dlg").nameSource], ["", "none"]);
  });

  it("names form controls from their label, value or alt", () => {
    const snap = snapshotOf([
      h("label", { for: "email" }, "Email"),
      h("input", { id: "email", "aria-required": "true" }),
      h("label", {}, "Wrapped ", h("input", { id: "wrapped", type: "checkbox", "aria-checked": "true" })),
      h("input", { id: "submit", type: "submit", "aria-describedby": "x" }),
      h("input", { id: "submit-value", type: "submit", value: "Pay", "aria-describedby": "x" }),
      h("input", { id: "reset", type: "reset", "aria-describedby": "x" }),
      h("input", { id: "plain-button", type: "button", "aria-describedby": "x" }),
      h("input", { id: "image", type: "image", alt: "Go", "aria-describedby": "x" }),
      h("input", { id: "placeholder", placeholder: "Search", "aria-describedby": "x" }),
      h("img", { id: "pic", alt: "A cat", "aria-describedby": "x" }),
      h("div", { id: "titled", role: "dialog", title: "Settings" }),
    ]);

    const name = (loc) => only(snap, loc).accessibleName;
    assert.equal(name("#email"), "Email");
    assert.equal(name("#wrapped"), "Wrapped");
    assert.equal(name("#submit"), "Submit");
    assert.equal(name("#submit-value"), "Pay");
    assert.equal(name("#reset"), "Reset");
    assert.equal(name("#plain-button"), "");
    assert.equal(name("#image"), "Go");
    assert.equal(name("#placeholder"), "Search");
    assert.equal(name("#pic"), "A cat");
    assert.deepEqual([name("#titled"), only(snap, "#titled").nameSource], ["Settings", "title"]);
  });
});

describe("ARIA collector: relationships", () => {
  it("lists idrefs that point at nothing", () => {
    const snap = snapshotOf([
      h("span", { id: "here" }, "here"),
      h("div", { id: "x", role: "button", "aria-describedby": "here gone also-gone", "aria-controls": "here" }, "x"),
    ]);

    assert.deepEqual(only(snap, "#x").missingIdrefs, { "aria-describedby": ["gone", "also-gone"] });
  });

  it("finds the nearest meaningful parent role, looking through wrappers", () => {
    const snap = snapshotOf([
      h("div", { role: "tablist" }, h("div", {}, h("span", { role: "none" }, h("div", { id: "tab", role: "tab" }, "One")))),
      h("div", { id: "lonely", role: "tab" }, "Two"),
    ]);

    assert.equal(only(snap, "#tab").parentRole, "tablist");
    assert.equal(only(snap, "#lonely").parentRole, null);
  });

  it("finds owned roles through wrappers and aria-owns, ignoring hidden children", () => {
    const snap = snapshotOf([
      h("div", { id: "list", role: "listbox", "aria-owns": "far missing" },
        h("div", {}, h("div", { role: "option" }, "a")),
        h("div", { role: "option", $style: { display: "none" } }, "hidden")
      ),
      h("div", { id: "far", role: "option" }, "b"),
    ]);

    assert.deepEqual(only(snap, "#list").ownedRoles, ["option", "option"]);
  });

  it("marks elements inside an aria-hidden subtree", () => {
    const snap = snapshotOf([
      h("div", { "aria-hidden": "true" }, h("div", { id: "inner", role: "button" }, "x")),
    ]);

    assert.equal(only(snap, "#inner").inAriaHiddenSubtree, true);
  });
});

describe("ARIA collector: locators and snippets", () => {
  it("uses the id when it is a safe selector, else a path anchored on the nearest id", () => {
    const snap = snapshotOf([
      h("div", { id: "wrap" },
        h("span", { "aria-label": "first" }),
        h("span", { "aria-label": "second" })
      ),
      h("section", {}, h("p", { "aria-label": "deep" })),
      h("div", { id: "1bad", role: "note" }, "x"),
    ]);

    assert.deepEqual(snap.elements.map((e) => e.locator), [
      "#wrap > span:nth-of-type(1)",
      "#wrap > span:nth-of-type(2)",
      "body > section > p",
      "body > div:nth-of-type(2)",
    ]);
  });

  it("shows the opening tag as authored and truncates long ones", () => {
    const snap = snapshotOf([
      h("input", { id: "a", type: "checkbox", checked: "", "aria-label": "Agree" }),
      h("div", { id: "b", role: "note", "aria-label": "x".repeat(300) }),
    ]);

    assert.equal(only(snap, "#a").snippet, '<input id="a" type="checkbox" checked aria-label="Agree">');
    assert.equal(only(snap, "#b").snippet.length, 201);
    assert.ok(only(snap, "#b").snippet.endsWith("...>"));
  });
});
