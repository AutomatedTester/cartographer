/**
 * Just enough DOM to run src/aria-collector.ts in Node.
 *
 * The collector is shipped to the browser as serialised source, so the only
 * way to test it without Chrome is to give it the handful of DOM APIs it
 * touches: children/childNodes/parentElement, attributes, getElementById,
 * getComputedStyle and location. Pages are written with h():
 *
 *   h("div", { role: "button" }, "Save")
 *   h("nav", { $style: { display: "none" } }, h("a", { href: "/" }, "Home"))
 *
 * `$style` sets the computed style the collector sees; every other key is an
 * attribute. Strings become text nodes.
 */
import { collectAriaSnapshot } from "../../build/aria-collector.js";
import { ARIA_ROLES, auditAriaSnapshot } from "../../build/aria-auditor.js";

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

class FakeElement {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    const { $style, ...rest } = attrs;
    this.style = { display: "block", visibility: "visible", ...($style ?? {}) };
    this.attributes = Object.entries(rest).map(([name, value]) => ({ name, value: String(value) }));
    this.parentElement = null;
    this.childNodes = children.map((c) => (typeof c === "string" ? new FakeText(c) : c));
    this.children = this.childNodes.filter((c) => c.nodeType === 1);
    for (const child of this.children) child.parentElement = this;
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }

  getAttribute(name) {
    const found = this.attributes.find((a) => a.name === name);
    return found ? found.value : null;
  }

  hasAttribute(name) {
    return this.attributes.some((a) => a.name === name);
  }
}

/** Build an element. */
export function h(tag, attrs = {}, ...children) {
  return new FakeElement(tag, attrs, children.flat());
}

/**
 * Run the real collector over a fake page.
 *
 * @param {FakeElement[]|FakeElement} bodyChildren
 * @param {{ maxElements?: number, title?: string, url?: string }} [options]
 */
export function snapshotOf(bodyChildren, options = {}) {
  const body = h("body", {}, ...[bodyChildren].flat());
  const byId = (id, el = body) => {
    if (el.id === id) return el;
    for (const child of el.children) {
      const found = byId(id, child);
      if (found) return found;
    }
    return null;
  };

  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = {
    body,
    title: options.title ?? "Fixture",
    getElementById: (id) => byId(id),
  };
  globalThis.window = {
    location: { href: options.url ?? "https://example.test/page" },
    getComputedStyle: (el) => el.style,
  };
  try {
    return collectAriaSnapshot([...ARIA_ROLES], options.maxElements);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
}

/** Collect and audit a fake page in one step. */
export function auditOf(bodyChildren, options = {}) {
  return auditAriaSnapshot(snapshotOf(bodyChildren, options));
}

/** Rule ids reported, in order. */
export function ruleIds(report) {
  return report.findings.map((f) => f.ruleId);
}
