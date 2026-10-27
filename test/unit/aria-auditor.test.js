/**
 * The ARIA advisory rules.
 *
 * Each rule is checked from both sides: the bad pattern produces advice, and
 * the correct version of the same markup produces none. The second half
 * matters as much as the first. Advice that fires on good ARIA teaches people
 * to ignore the tool, and the point of the tool is that bad ARIA gets noticed.
 *
 * Pages are built with the fake DOM in helpers/aria-dom.js and run through the
 * real collector, so these exercise the same path a crawl does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { h, auditOf, ruleIds } from "../helpers/aria-dom.js";
import {
  ARIA_ROLES,
  ARIA_ADVISORY_PREAMBLE,
  auditAriaSnapshot,
  failedAriaAudit,
} from "../../build/aria-auditor.js";

/** The findings for one rule. */
function findings(report, ruleId) {
  return report.findings.filter((f) => f.ruleId === ruleId);
}

/** Exactly one finding for a rule; returns it. */
function one(report, ruleId) {
  const found = findings(report, ruleId);
  assert.equal(found.length, 1, `expected one ${ruleId}, got ${JSON.stringify(ruleIds(report))}`);
  return found[0];
}

describe("ARIA advisory: report shape", () => {
  it("is always advisory and carries every field a reader needs", () => {
    const report = auditOf([h("div", { id: "fake", role: "buton" }, "Save")]);

    assert.equal(report.advisory, true);
    const f = one(report, "invalid-role");
    for (const field of ["title", "problem", "userExperience", "advice", "ifRemoved", "reference"]) {
      assert.ok(typeof f[field] === "string" && f[field].length > 0, `${field} is empty`);
    }
    assert.equal(f.locator, "#fake");
    assert.equal(f.snippet, '<div id="fake" role="buton">');
    assert.ok(["high", "medium", "low"].includes(f.severity));
    assert.ok(["remove-aria", "change-aria", "add-aria", "use-native-html"].includes(f.fix));
    assert.equal(typeof f.safeToRemove, "boolean");
  });

  it("says nothing about a page with no ARIA problems", () => {
    const report = auditOf([
      h("header", {}, h("nav", { "aria-label": "Primary" }, h("a", { href: "/" }, "Home"))),
      h("main", {},
        h("button", { "aria-expanded": "false", "aria-controls": "menu" }, "Menu"),
        h("ul", { id: "menu" }, h("li", {}, "One")),
        h("div", { role: "tablist" },
          h("button", { role: "tab", "aria-selected": "true" }, "First"),
          h("button", { role: "tab", "aria-selected": "false", tabindex: "-1" }, "Second")
        ),
        h("label", { for: "q" }, "Search"),
        h("input", { id: "q", type: "search", "aria-describedby": "q-help" }),
        h("p", { id: "q-help" }, "Try a product name"),
        h("button", { "aria-label": "Save draft" }, "Save"),
        h("div", { role: "button", tabindex: "0" }, "Custom but operable"),
        h("img", { src: "x.png", alt: "", "aria-describedby": "q-help" }),
        h("span", { "aria-hidden": "true" }, "★")
      ),
      h("footer", {}, "©"),
    ]);

    assert.deepEqual(ruleIds(report), []);
    assert.deepEqual(report.summary, { total: 0, high: 0, medium: 0, low: 0, safeToRemove: 0 });
    assert.ok(report.elementsWithAria > 0);
  });

  it("orders findings high, then medium, then low", () => {
    const report = auditOf([
      h("button", { id: "low", role: "button" }, "Redundant"),
      h("div", { id: "medium", role: "widget" }, "Abstract"),
      h("div", { id: "high", role: "button" }, "Unreachable"),
    ]);

    assert.deepEqual(report.findings.map((f) => f.severity), ["high", "medium", "low"]);
    assert.deepEqual(
      { high: report.summary.high, medium: report.summary.medium, low: report.summary.low },
      { high: 1, medium: 1, low: 1 }
    );
  });

  it("counts the advice that is fixed by deleting ARIA with nothing lost", () => {
    const report = auditOf([
      h("div", { id: "a", role: "nonsense" }, "x"),          // safe
      h("span", { id: "b", "aria-lable": "x" }),            // safe
      h("div", { id: "c", role: "button" }, "Unreachable"), // not safe
    ]);

    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.safeToRemove, 2);
  });

  it("carries the snapshot's coverage figures", () => {
    const report = auditAriaSnapshot({
      url: "u", title: "t", elements: [], elementsScanned: 42, truncated: true,
    });

    assert.equal(report.elementsScanned, 42);
    assert.equal(report.truncated, true);
    assert.equal(report.elementsWithAria, 0);
  });

  it("turns a collector failure into an empty advisory report rather than a throw", () => {
    const report = failedAriaAudit("https://x.test/", new Error("script timeout"));

    assert.equal(report.advisory, true);
    assert.equal(report.error, "script timeout");
    assert.deepEqual(report.findings, []);
    assert.equal(failedAriaAudit("u", "plain string").error, "plain string");
  });

  it("frames the report with the first rule of ARIA", () => {
    assert.match(ARIA_ADVISORY_PREAMBLE, /No ARIA is better than bad ARIA/);
    assert.match(ARIA_ADVISORY_PREAMBLE, /not a WCAG conformance verdict/);
  });

  it("knows only concrete roles", () => {
    assert.ok(ARIA_ROLES.includes("button"));
    assert.ok(!ARIA_ROLES.includes("widget"));
  });
});

describe("ARIA advisory: invalid-role", () => {
  it("flags a role no browser recognises and says deleting it loses nothing", () => {
    const f = one(auditOf([h("div", { id: "x", role: "buton" }, "Save")]), "invalid-role");

    assert.equal(f.safeToRemove, true);
    assert.match(f.ifRemoved, /^Nothing/);
    assert.match(f.userExperience, /plain content with no role/);
  });

  it("explains abstract roles separately", () => {
    const f = one(auditOf([h("div", { role: "landmark" }, "x")]), "invalid-role");
    assert.match(f.problem, /abstract role/);
  });

  it("says what the user hears instead when the element has native semantics", () => {
    const f = one(auditOf([h("button", { role: "clicky" }, "Go")]), "invalid-role");
    assert.match(f.userExperience, /a button/);
  });

  it("stays quiet when a later token is a valid fallback", () => {
    assert.deepEqual(findings(auditOf([h("div", { role: "switch2 checkbox", tabindex: "0", "aria-checked": "false" }, "x")]), "invalid-role"), []);
  });
});

describe("ARIA advisory: redundant-role", () => {
  it("flags a role the element already has, with nothing lost by removing it", () => {
    const f = one(auditOf([h("button", { role: "button" }, "Go")]), "redundant-role");

    assert.equal(f.severity, "low");
    assert.equal(f.safeToRemove, true);
    assert.match(f.ifRemoved, /Nothing\. The <button> element already gives users the button role/);
  });

  it("warns that role=list on a list may be doing real work in Safari", () => {
    const f = one(auditOf([h("ul", { role: "list" }, h("li", {}, "a"))]), "redundant-role");

    assert.equal(f.safeToRemove, false);
    assert.match(f.ifRemoved, /VoiceOver/);
    assert.match(f.advice, /list-style: none/);
  });

  it("stays quiet when the role changes the element's semantics", () => {
    assert.deepEqual(findings(auditOf([h("a", { href: "/", role: "button" }, "Go")]), "redundant-role"), []);
  });
});

describe("ARIA advisory: native-semantics-overridden", () => {
  it("flags a native control given a non-interactive role", () => {
    const f = one(auditOf([h("button", { role: "heading" }, "Open")]), "native-semantics-overridden");

    assert.equal(f.severity, "high");
    assert.match(f.userExperience, /not told it can be operated/);
    assert.match(f.ifRemoved, /The "heading" announcement/);
    assert.equal(f.safeToRemove, false);
  });

  it("allows widget roles that keep the control interactive", () => {
    const report = auditOf([
      h("div", { role: "tablist" }, h("button", { role: "tab" }, "One")),
      h("a", { href: "#", role: "button" }, "Go"),
      h("button", { role: "switch", "aria-checked": "false" }, "Wi-Fi"),
    ]);
    assert.deepEqual(findings(report, "native-semantics-overridden"), []);
  });
});

describe("ARIA advisory: widget-not-focusable", () => {
  it("flags a control role on something the keyboard can't reach", () => {
    const f = one(auditOf([h("div", { id: "save", role: "button" }, "Save")]), "widget-not-focusable");

    assert.equal(f.severity, "high");
    assert.equal(f.fix, "use-native-html");
    assert.match(f.userExperience, /Tab never reaches it/);
    assert.match(f.ifRemoved, /promise the element can't keep/);
  });

  it("stays quiet for focusable, native, disabled and hidden controls", () => {
    const report = auditOf([
      h("div", { role: "button", tabindex: "0" }, "Focusable"),
      h("div", { role: "tab", tabindex: "-1" }, "Roving"),
      h("a", { href: "/", role: "button" }, "Native"),
      h("div", { role: "button", "aria-disabled": "true" }, "Disabled"),
      h("div", { "aria-hidden": "true" }, h("div", { role: "button" }, "Hidden")),
      h("div", { role: "listbox", tabindex: "0", "aria-label": "Fruit" }, h("div", { role: "option" }, "Apple")),
    ]);
    assert.deepEqual(findings(report, "widget-not-focusable"), []);
  });
});

describe("ARIA advisory: aria-hidden-focusable", () => {
  it("flags aria-hidden on a focusable element", () => {
    const f = one(auditOf([h("a", { href: "/", "aria-hidden": "true" }, "Home")]), "aria-hidden-focusable");

    assert.equal(f.severity, "high");
    assert.match(f.problem, /The element itself is focusable/);
    assert.match(f.ifRemoved, /would hear this content again/);
  });

  it("counts focusable content inside an aria-hidden container", () => {
    const f = one(auditOf([
      h("div", { "aria-hidden": "true" }, h("button", {}, "a"), h("button", {}, "b")),
    ]), "aria-hidden-focusable");
    assert.match(f.problem, /contains 2 focusable elements/);
  });

  it("uses the singular for one focusable descendant", () => {
    const f = one(auditOf([h("div", { "aria-hidden": "true" }, h("button", {}, "a"))]), "aria-hidden-focusable");
    assert.match(f.problem, /contains 1 focusable element\./);
  });

  it("stays quiet for decorative hidden content and for elements taken out of the tab order", () => {
    const report = auditOf([
      h("span", { "aria-hidden": "true" }, "★"),
      h("div", { "aria-hidden": "false" }, h("button", {}, "x")),
      h("div", { tabindex: "-1", "aria-hidden": "true" }, "scroll target"),
    ]);
    assert.deepEqual(findings(report, "aria-hidden-focusable"), []);
  });
});

describe("ARIA advisory: presentation-conflict", () => {
  it("flags role=presentation on something focusable", () => {
    const f = one(auditOf([h("button", { role: "presentation" }, "Go")]), "presentation-conflict");

    assert.equal(f.safeToRemove, true);
    assert.match(f.title, /the element is focusable/);
    assert.match(f.ifRemoved, /already ignore role="presentation"/);
  });

  it("flags role=none combined with a name", () => {
    const f = one(auditOf([h("div", { role: "none", "aria-label": "Layout" }, "x")]), "presentation-conflict");
    assert.match(f.problem, /aria-label/);
    assert.match(f.advice, /contradict/);
  });

  it("calls role=presentation on an alt=\"\" image redundant rather than conflicting", () => {
    const report = auditOf([h("img", { src: "x.png", alt: "", role: "presentation" })]);
    assert.deepEqual(ruleIds(report), ["redundant-role"]);
  });

  it("stays quiet for a plain presentational table", () => {
    assert.deepEqual(ruleIds(auditOf([h("table", { role: "presentation" }, h("tr", {}, h("td", {}, "x")))])), []);
  });
});

describe("ARIA advisory: broken-idref", () => {
  it("flags each attribute whose id is missing", () => {
    const report = auditOf([
      h("button", { "aria-describedby": "nope", "aria-controls": "gone" }, "Go"),
    ]);

    const found = findings(report, "broken-idref");
    assert.deepEqual(found.map((f) => f.title).sort(), [
      "aria-controls points at an id that does not exist",
      "aria-describedby points at an id that does not exist",
    ]);
    assert.ok(found.every((f) => f.safeToRemove && /^Nothing/.test(f.ifRemoved)));
  });

  it("is high when the broken labelledby leaves the control nameless", () => {
    const f = one(auditOf([h("div", { role: "dialog", "aria-labelledby": "missing" })]), "broken-idref");

    assert.equal(f.severity, "high");
    assert.match(f.userExperience, /no name at all/);
  });

  it("says what the name falls back to when there is one", () => {
    const f = one(auditOf([h("button", { "aria-labelledby": "missing" }, "Pay")]), "broken-idref");

    assert.equal(f.severity, "medium");
    assert.match(f.userExperience, /announced as "Pay"/);
  });

  it("is high for a broken active descendant", () => {
    const f = one(auditOf([
      h("div", { role: "listbox", tabindex: "0", "aria-label": "x", "aria-activedescendant": "opt-9" }, h("div", { role: "option" }, "a")),
    ]), "broken-idref");
    assert.equal(f.severity, "high");
  });
});

describe("ARIA advisory: label-not-in-name", () => {
  it("flags an aria-label that replaces the visible text", () => {
    const f = one(auditOf([h("button", { "aria-label": "Submit form" }, "Send")]), "label-not-in-name");

    assert.match(f.userExperience, /click Send/);
    assert.match(f.ifRemoved, /The name becomes the visible text "Send"/);
    assert.match(f.ifRemoved, /"Submit form" is lost/);
    assert.equal(f.safeToRemove, false);
  });

  it("applies to aria-labelledby too", () => {
    const report = auditOf([
      h("span", { id: "l" }, "Delete item"),
      h("button", { "aria-labelledby": "l" }, "Remove"),
    ]);
    one(report, "label-not-in-name");
  });

  it("stays quiet when the visible text is in the name, ignoring case and punctuation", () => {
    const report = auditOf([
      h("button", { "aria-label": "Save draft" }, "Save"),
      h("a", { href: "/", "aria-label": "read more: about pricing" }, "Read more…"),
      h("button", { "aria-label": "Close dialog" }, h("span", { "aria-hidden": "true" }, "×")),
      h("a", { href: "/cart", "aria-label": "Shopping cart" }, "🛒 ", h("span", {}, "3")),
    ]);
    assert.deepEqual(findings(report, "label-not-in-name"), []);
  });
});

describe("ARIA advisory: missing-name", () => {
  it("flags an explicit control role with no name, and says this one needs more, not less", () => {
    const f = one(auditOf([h("div", { role: "button", tabindex: "0" })]), "missing-name");

    assert.equal(f.severity, "high");
    assert.equal(f.fix, "add-aria");
    assert.match(f.userExperience, /announces just "button"/);
    assert.match(f.ifRemoved, /more ARIA \(or visible text\), not less/);
  });

  it("suggests alt-style naming for images", () => {
    const f = one(auditOf([h("div", { role: "img" })]), "missing-name");
    assert.match(f.advice, /decorative/);
  });

  it("stays quiet when a name exists or the element is hidden", () => {
    const report = auditOf([
      h("div", { role: "button", tabindex: "0", title: "Help" }),
      h("div", { role: "img", "aria-label": "Chart" }),
      h("div", { "aria-hidden": "true" }, h("div", { role: "img" })),
    ]);
    assert.deepEqual(findings(report, "missing-name"), []);
  });
});

describe("ARIA advisory: required-context", () => {
  it("flags a tab with no tablist", () => {
    const f = one(auditOf([h("button", { role: "tab" }, "One")]), "required-context");

    assert.match(f.title, /tab is not inside a tablist/);
    assert.match(f.advice, /role="tablist"/);
  });

  it("flags a listitem outside a list and names what it is in instead", () => {
    const f = one(auditOf([h("nav", {}, h("div", { role: "listitem" }, "x"))]), "required-context");
    assert.match(f.problem, /a navigation/);
  });

  it("accepts the right container, even through wrappers", () => {
    const report = auditOf([
      h("ul", {}, h("div", {}, h("span", { role: "listitem" }, "a"))),
      h("div", { role: "menu" }, h("div", { role: "menuitem", tabindex: "-1" }, "Cut")),
      h("table", {}, h("tbody", {}, h("tr", {}, h("td", { role: "cell" }, "1")))),
    ]);
    assert.deepEqual(findings(report, "required-context"), []);
  });
});

describe("ARIA advisory: required-owned", () => {
  it("flags an empty tablist", () => {
    const f = one(auditOf([h("div", { role: "tablist" }, h("button", {}, "Not a tab"))]), "required-owned");

    assert.match(f.title, /tablist contains no tab/);
    assert.match(f.ifRemoved, /more honest than an empty tablist/);
  });

  it("stays quiet while the container is busy loading", () => {
    assert.deepEqual(findings(auditOf([h("div", { role: "list", "aria-busy": "true" })]), "required-owned"), []);
  });

  it("accepts owned children found through aria-owns", () => {
    const report = auditOf([
      h("div", { role: "listbox", tabindex: "0", "aria-label": "x", "aria-owns": "o1" }),
      h("div", { id: "o1", role: "option" }, "a"),
    ]);
    assert.deepEqual(findings(report, "required-owned"), []);
  });
});

describe("ARIA advisory: invalid-attribute-value", () => {
  it("flags a state value browsers don't understand and says what they use instead", () => {
    const f = one(auditOf([h("button", { "aria-expanded": "yes" }, "Menu")]), "invalid-attribute-value");

    assert.equal(f.severity, "medium");
    assert.match(f.userExperience, /undefined \(not expandable\)/);
    assert.match(f.userExperience, /opposite of what the page shows/);
    assert.equal(f.safeToRemove, true);
  });

  it("is low for attributes that are not user-facing states", () => {
    const f = one(auditOf([h("div", { "aria-live": "loud" }, "x")]), "invalid-attribute-value");
    assert.equal(f.severity, "low");
  });

  it("accepts valid values regardless of case and surrounding space", () => {
    const report = auditOf([h("button", { "aria-pressed": " TRUE ", "aria-haspopup": "menu" }, "B")]);
    assert.deepEqual(findings(report, "invalid-attribute-value"), []);
  });
});

describe("ARIA advisory: unknown-attribute", () => {
  it("suggests the attribute that was probably meant", () => {
    const f = one(auditOf([h("button", { "aria-lable": "Close" }, "×")]), "unknown-attribute");

    assert.match(f.problem, /Did you mean aria-label\?/);
    assert.equal(f.fix, "change-aria");
    assert.equal(f.ifRemoved, "Nothing. Unknown attributes are already ignored.");
  });

  it("recommends removal when nothing is close", () => {
    const f = one(auditOf([h("div", { "aria-somethingelse": "1" })]), "unknown-attribute");
    assert.equal(f.fix, "remove-aria");
  });
});

describe("ARIA advisory: prohibited-name", () => {
  it("flags aria-label on a plain div", () => {
    const f = one(auditOf([h("div", { "aria-label": "Product details" }, "…")]), "prohibited-name");

    assert.match(f.userExperience, /never hear "Product details"/);
    assert.equal(f.safeToRemove, true);
  });

  it("flags names on text-level roles", () => {
    one(auditOf([h("p", { "aria-labelledby": "x" }, "Para"), h("span", { id: "x" }, "label")]), "prohibited-name");
  });

  it("stays quiet on roles that can be named", () => {
    const report = auditOf([
      h("div", { role: "region", "aria-label": "Filters" }),
      h("div", { role: "group", "aria-label": "Size" }),
      h("svg", { "aria-label": "Logo" }),
    ]);
    assert.deepEqual(findings(report, "prohibited-name"), []);
  });
});

describe("ARIA advisory: unsupported-state", () => {
  it("flags aria-checked on a button and suggests aria-pressed or a switch", () => {
    const f = one(auditOf([h("button", { "aria-checked": "true" }, "Bold")]), "unsupported-state");

    assert.match(f.advice, /aria-pressed/);
    assert.match(f.userExperience, /can't tell whether it is on, off or selected/);
  });

  it("flags aria-selected on a link and suggests aria-current", () => {
    const f = one(auditOf([h("a", { href: "/", "aria-selected": "true" }, "Home")]), "unsupported-state");
    assert.match(f.advice, /aria-current/);
  });

  it("flags aria-pressed on a non-button", () => {
    one(auditOf([h("div", { role: "checkbox", tabindex: "0", "aria-pressed": "true", "aria-checked": "true" }, "x")]), "unsupported-state");
  });

  it("stays quiet when the state matches the role", () => {
    const report = auditOf([
      h("button", { "aria-pressed": "true" }, "Bold"),
      h("input", { type: "checkbox", "aria-checked": "mixed", "aria-label": "All" }),
      h("div", { role: "tablist" }, h("button", { role: "tab", "aria-selected": "true" }, "One")),
    ]);
    assert.deepEqual(findings(report, "unsupported-state"), []);
  });
});

describe("ARIA advisory: landmarks", () => {
  it("flags more than one main", () => {
    const report = auditOf([h("main", {}, "a"), h("div", { role: "main" }, "b")]);
    const f = one(report, "duplicate-main");

    assert.match(f.problem, /2 main landmarks/);
    assert.equal(f.safeToRemove, true, "the second came from role=main, which can go");
  });

  it("does not call two native mains safe to delete", () => {
    const f = one(auditOf([h("main", {}, "a"), h("main", {}, "b")]), "duplicate-main");
    assert.equal(f.safeToRemove, false);
  });

  it("flags several unnamed landmarks of the same kind and asks for names, not removal", () => {
    const f = one(auditOf([h("nav", {}, "a"), h("nav", {}, "b")]), "indistinguishable-landmarks");

    assert.equal(f.fix, "add-aria");
    assert.match(f.ifRemoved, /not bad ARIA to remove/);
  });

  it("does not count unnamed forms as landmarks", () => {
    const report = auditOf([
      h("form", { "aria-describedby": "h" }, h("button", {}, "Add")),
      h("form", { "aria-describedby": "h" }, h("button", {}, "Add")),
      h("p", { id: "h" }, "help"),
    ]);
    assert.deepEqual(findings(report, "indistinguishable-landmarks"), []);
  });

  it("stays quiet when duplicate landmarks are named", () => {
    const report = auditOf([
      h("nav", { "aria-label": "Primary" }, "a"),
      h("nav", { "aria-label": "Footer" }, "b"),
      h("aside", {}, "only one"),
    ]);
    assert.deepEqual(ruleIds(report), []);
  });
});

describe("ARIA advisory: links-as-menu", () => {
  it("flags site navigation built as a menubar, once for the whole menu", () => {
    const report = auditOf([
      h("nav", {},
        h("ul", { role: "menubar" },
          h("li", { role: "none" }, h("a", { id: "home", href: "/", role: "menuitem" }, "Home")),
          h("li", { role: "none" }, h("a", { id: "shop", href: "/shop", role: "menuitem" }, "Shop"))
        )
      ),
    ]);
    const f = one(report, "links-as-menu");

    assert.match(f.title, /2 links are exposed as menu items/);
    assert.match(f.problem, /#home, #shop/);
    assert.match(f.userExperience, /arrow keys/);
    assert.match(f.ifRemoved, /list of links/);
    assert.equal(f.safeToRemove, true);
  });

  it("uses the singular for one link", () => {
    const f = one(auditOf([h("div", { role: "menu" }, h("a", { href: "/", role: "menuitem" }, "Home"))]), "links-as-menu");
    assert.match(f.title, /1 link is exposed/);
    assert.match(f.problem, /is a link given/);
  });

  it("stays quiet for a real application menu", () => {
    const report = auditOf([
      h("div", { role: "menu", "aria-label": "Edit" },
        h("div", { role: "menuitem", tabindex: "-1" }, "Cut"),
        h("button", { role: "menuitemcheckbox", "aria-checked": "false" }, "Wrap")
      ),
    ]);
    assert.deepEqual(ruleIds(report), []);
  });
});
