/**
 * Minimal DOM test double.
 *
 * SemanticHandlerGenerator emits JavaScript source that is meant to run in a
 * browser. Asserting on that source as text only proves the string contains
 * certain characters. This harness lets the emitted code actually execute, so
 * tests can assert on observable effects (did the right element get clicked,
 * did the input receive the value, was the form submitted).
 */

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
  }
}

export class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.clicks = 0;
    this.events = [];
    this.focused = false;
    this.parent = null;
    /** Optional side effect invoked on click, used to simulate navigation. */
    this.onClick = null;
  }

  click() {
    this.clicks += 1;
    if (this.onClick) this.onClick(this);
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  getAttribute(name) {
    return this.hasAttribute(name) ? this.attrs[name] : null;
  }

  dispatchEvent(event) {
    this.events.push(event);
    return true;
  }

  focus() {
    this.focused = true;
  }

  /** Only tag-name selectors are needed by the generated handlers. */
  closest(selector) {
    let node = this;
    while (node) {
      if (node.tagName.toLowerCase() === selector.toLowerCase()) return node;
      node = node.parent;
    }
    return null;
  }

  querySelectorAll() {
    return [];
  }

  /** Names of events dispatched on this element, in order. */
  eventTypes() {
    return this.events.map((e) => e.type);
  }
}

export class HTMLElement extends Element {}

export class HTMLInputElement extends HTMLElement {
  constructor(tag = "input", attrs = {}) {
    super(tag, attrs);
    this.value = attrs.value ?? "";
  }
}

export class HTMLTextAreaElement extends HTMLElement {
  constructor(tag = "textarea", attrs = {}) {
    super(tag, attrs);
    this.value = attrs.value ?? "";
  }
}

export class HTMLOptionElement extends HTMLElement {
  constructor(value) {
    super("option", {});
    this.value = value;
  }
}

export class HTMLSelectElement extends HTMLElement {
  constructor(tag = "select", attrs = {}, optionValues = []) {
    super(tag, attrs);
    this.options = optionValues.map((v) => new HTMLOptionElement(v));
    this.value = attrs.value ?? "";
  }

  querySelectorAll(selector) {
    return selector === "option" ? this.options : [];
  }
}

export class HTMLFormElement extends HTMLElement {
  constructor(tag = "form", attrs = {}) {
    super(tag, attrs);
    this.submitted = 0;
  }

  submit() {
    this.submitted += 1;
  }
}

/**
 * Build a fake browser environment.
 *
 * @param {Record<string, Element>} elementsByLocator map of CSS locator to element
 * @param {{ href?: string }} [options]
 */
export function createEnvironment(elementsByLocator = {}, options = {}) {
  const navigator = {};
  const document = {
    querySelector: (selector) =>
      Object.prototype.hasOwnProperty.call(elementsByLocator, selector)
        ? elementsByLocator[selector]
        : null,
  };
  const window = {
    location: { href: options.href ?? "https://example.test/" },
    getComputedStyle: (el) => ({
      display: el.attrs.display ?? "block",
      visibility: el.attrs.visibility ?? "visible",
    }),
  };
  let clock = 0;
  const performance = { now: () => (clock += 1) };
  const logs = [];
  const console = { log: (...args) => logs.push(args.join(" ")) };

  return { navigator, document, window, performance, console, logs };
}

/**
 * Execute generated handler registration code against a fake environment and
 * return the resulting `navigator.webmcp` object.
 *
 * `new Function` is intentional and confined to tests: the whole point is to
 * run the generator's output. `code` always comes from
 * SemanticHandlerGenerator applied to in-repo fixtures, never from user or
 * network input, and the function body is passed whole rather than built by
 * interpolation. Do not reuse this helper on untrusted strings.
 *
 * @param {string} code source emitted by SemanticHandlerGenerator
 * @param {ReturnType<typeof createEnvironment>} env
 */
export function installHandlers(code, env) {
  const run = new Function(
    "navigator",
    "document",
    "window",
    "performance",
    "console",
    "Event",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLFormElement",
    code
  );
  run(
    env.navigator,
    env.document,
    env.window,
    env.performance,
    env.console,
    Event,
    Element,
    HTMLElement,
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLSelectElement,
    HTMLFormElement
  );
  return env.navigator.webmcp;
}
