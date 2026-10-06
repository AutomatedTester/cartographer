import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SemanticHandlerGenerator } from "../../build/webmcp-semantic-handlers.js";
import { SemanticToolGenerator } from "../../build/webmcp-semantic-tools.js";
import {
  Element,
  HTMLElement,
  HTMLFormElement,
  HTMLInputElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
  createEnvironment,
  installHandlers,
} from "../helpers/fake-dom.js";

function element(overrides = {}) {
  return {
    path: "body > button",
    tag: "button",
    text: "Click me",
    locator: "#target",
    intentScore: 80,
    intentReasons: ["button tag"],
    ...overrides,
  };
}

/**
 * Generate handlers for `elements`, execute them against a fake DOM built from
 * `nodes`, and return { tools, env }.
 */
function install(elements, nodes = {}, options = {}) {
  const code = SemanticHandlerGenerator.generateHandlerCode(elements);
  const env = createEnvironment(nodes, options);
  const webmcp = installHandlers(code, env);
  return { webmcp, tools: webmcp.tools, env };
}

describe("SemanticHandlerGenerator registration", () => {
  it("registers one callable tool per critical element", () => {
    const { tools } = install([
      element({ text: "Search", locator: "#search", intentScore: 65 }),
      element({ text: "Subscribe", locator: "#sub", intentScore: 55 }),
      element({ text: "Ignored", locator: "#ignored", intentScore: 20 }),
    ]);

    assert.deepEqual(Object.keys(tools).sort(), ["search", "subscribe"]);
    assert.equal(typeof tools.search, "function");
  });

  it("publishes registeredTools matching the generated schema names", () => {
    const elements = [
      element({ text: "Add to Cart", locator: "#cart", intentScore: 90 }),
      element({ tag: "a", text: "Careers", locator: "#careers", intentScore: 70 }),
    ];
    const { webmcp } = install(elements);

    assert.deepEqual(
      webmcp.registeredTools,
      SemanticToolGenerator.generate(elements).map((s) => s.name)
    );
  });

  it("produces runnable code for an empty element list", () => {
    const { webmcp, tools } = install([]);
    assert.deepEqual(Object.keys(tools), []);
    assert.deepEqual(webmcp.registeredTools, []);
  });

  it("does not clobber an existing navigator.webmcp.tools namespace", () => {
    const code = SemanticHandlerGenerator.generateHandlerCode([
      element({ text: "New", locator: "#new" }),
    ]);
    const env = createEnvironment({});
    env.navigator.webmcp = { tools: { preexisting: () => "kept" } };
    const webmcp = installHandlers(code, env);

    assert.equal(typeof webmcp.tools.preexisting, "function");
    assert.equal(typeof webmcp.tools.new, "function");
  });
});

describe("generated click handler", () => {
  it("clicks the element matching the locator and reports success", async () => {
    const button = new HTMLElement("button");
    const { tools } = install([element({ text: "Buy", locator: "#buy" })], { "#buy": button });

    const result = await tools.buy();

    assert.equal(button.clicks, 1);
    assert.equal(result.success, true);
    assert.equal(result.message, "Tool executed successfully");
    assert.equal(typeof result.duration, "number");
  });

  it("reports failure instead of throwing when the element is missing", async () => {
    const { tools } = install([element({ text: "Buy", locator: "#buy" })], {});

    const result = await tools.buy();

    assert.equal(result.success, false);
    assert.match(result.message, /Element not found: #buy/);
  });

  it("does not click anything else on the page", async () => {
    const target = new HTMLElement("button");
    const other = new HTMLElement("button");
    const { tools } = install([element({ text: "Buy", locator: "#buy" })], {
      "#buy": target,
      "#other": other,
    });

    await tools.buy();

    assert.equal(target.clicks, 1);
    assert.equal(other.clicks, 0);
  });
});

describe("generated input handler", () => {
  const inputElement = element({
    tag: "input",
    text: "Email",
    locator: "#email",
    attributes: { type: "email" },
  });

  it("writes the supplied value and fires input then change", async () => {
    const input = new HTMLInputElement("input");
    const { tools } = install([inputElement], { "#email": input });

    const result = await tools.email({ value: "user@example.test" });

    assert.equal(input.value, "user@example.test");
    assert.deepEqual(input.eventTypes(), ["input", "change"]);
    assert.equal(input.focused, true);
    assert.equal(result.success, true);
  });

  it("bubbles the events it dispatches", async () => {
    const input = new HTMLInputElement("input");
    const { tools } = install([inputElement], { "#email": input });

    await tools.email({ value: "x" });

    assert.ok(input.events.every((e) => e.bubbles === true));
  });

  it("focuses without dispatching events when no value is given", async () => {
    const input = new HTMLInputElement("input");
    const { tools } = install([inputElement], { "#email": input });

    await tools.email();

    assert.equal(input.value, "");
    assert.deepEqual(input.eventTypes(), []);
    assert.equal(input.focused, true);
  });

  it("accepts a textarea", async () => {
    const area = new HTMLTextAreaElement("textarea");
    const { tools } = install(
      [element({ tag: "textarea", text: "Comments", locator: "#comments" })],
      { "#comments": area }
    );

    await tools.comments({ value: "hello" });

    assert.equal(area.value, "hello");
  });

  it("rejects an element that is not a text entry control", async () => {
    const notAnInput = new HTMLElement("div");
    const { tools } = install([inputElement], { "#email": notAnInput });

    const result = await tools.email({ value: "x" });

    assert.equal(result.success, false);
    assert.match(result.message, /not an input or textarea/);
  });
});

describe("generated navigate handler", () => {
  const link = element({ tag: "a", text: "Careers", locator: "#careers" });

  it("resolves once the location changes", async () => {
    const anchor = new HTMLElement("a");
    const env = createEnvironment({ "#careers": anchor }, { href: "https://example.test/" });
    anchor.onClick = () => {
      env.window.location.href = "https://example.test/careers";
    };
    const code = SemanticHandlerGenerator.generateHandlerCode([link]);
    const { tools } = installHandlers(code, env);

    const result = await tools.careers();

    assert.equal(anchor.clicks, 1);
    assert.equal(result.success, true);
    assert.equal(env.window.location.href, "https://example.test/careers");
  });

  it("fails when navigation never happens, honouring the timeout parameter", async () => {
    const anchor = new HTMLElement("a");
    const { tools } = install([link], { "#careers": anchor });

    const result = await tools.careers({ timeout: 250 });

    assert.equal(result.success, false);
    assert.match(result.message, /Navigation did not occur within timeout/);
  });
});

describe("generated submit handler", () => {
  const submitButton = element({
    tag: "button",
    text: "Sign in",
    locator: "#signin",
    attributes: { type: "submit" },
  });

  it("submits the enclosing form rather than clicking the button", async () => {
    const form = new HTMLFormElement("form");
    const button = new HTMLElement("button");
    button.parent = form;
    const { tools } = install([submitButton], { "#signin": button });

    const result = await tools.signIn();

    assert.equal(form.submitted, 1);
    assert.equal(button.clicks, 0, "should submit the form, not click the button");
    assert.equal(result.success, true);
  });

  it("falls back to clicking when the control has no enclosing form", async () => {
    const button = new HTMLElement("button");
    const { tools } = install([submitButton], { "#signin": button });

    await tools.signIn();

    assert.equal(button.clicks, 1);
  });
});

describe("generated select handler", () => {
  const select = element({ tag: "select", text: "Sort by", locator: "#sort" });

  it("sets the requested option and fires change", async () => {
    const node = new HTMLSelectElement("select", {}, ["", "price-asc", "price-desc"]);
    const { tools } = install([select], { "#sort": node });

    const result = await tools.sortBy({ optionValue: "price-desc" });

    assert.equal(node.value, "price-desc");
    assert.deepEqual(node.eventTypes(), ["change"]);
    assert.equal(result.success, true);
  });

  it("falls back to the first real option, skipping a placeholder", async () => {
    const node = new HTMLSelectElement("select", {}, ["", "price-asc", "price-desc"]);
    const { tools } = install([select], { "#sort": node });

    await tools.sortBy();

    assert.equal(node.value, "price-asc");
  });

  it("rejects an element that is not a select", async () => {
    const { tools } = install([select], { "#sort": new HTMLElement("div") });

    const result = await tools.sortBy();

    assert.equal(result.success, false);
    assert.match(result.message, /not a select element/);
  });
});

describe("generated delete handler", () => {
  const del = element({
    tag: "button",
    ariaLabel: "Delete item",
    locator: "#remove",
  });

  it("clicks a visible, enabled control", async () => {
    const button = new HTMLElement("button");
    const { tools } = install([del], { "#remove": button });

    const result = await tools.deleteItem();

    assert.equal(button.clicks, 1);
    assert.equal(result.success, true);
  });

  it("refuses to click a hidden control", async () => {
    const button = new HTMLElement("button", { display: "none" });
    const { tools } = install([del], { "#remove": button });

    const result = await tools.deleteItem();

    assert.equal(button.clicks, 0);
    assert.equal(result.success, false);
    assert.match(result.message, /hidden or not visible/);
  });

  it("refuses to click a disabled control", async () => {
    const button = new HTMLElement("button", { disabled: "" });
    const { tools } = install([del], { "#remove": button });

    const result = await tools.deleteItem();

    assert.equal(button.clicks, 0);
    assert.equal(result.success, false);
    assert.match(result.message, /disabled/);
  });
});

describe("generated handler code safety", () => {
  it("emits syntactically valid code for locators containing quotes", () => {
    const elements = [
      element({ text: "Quoted", locator: "[data-test='add-to-cart']" }),
      element({ text: "Attribute", locator: 'input[name="q"]', intentScore: 70 }),
      element({ text: "Backslash", locator: "a[href='c:\\\\x']", intentScore: 70 }),
    ];

    assert.doesNotThrow(() => install(elements));
  });

  it("resolves a single-quoted attribute locator at runtime", async () => {
    const node = new HTMLElement("button");
    const locator = "[data-test='add-to-cart']";
    const { tools } = install([element({ text: "Quoted", locator })], {
      [locator]: node,
    });

    const result = await tools.quoted();

    assert.equal(result.success, true);
    assert.equal(node.clicks, 1);
  });

  it("does not let page-derived locator text escape its string literal", () => {
    // A crafted locator must not be able to break out and run code during
    // registration. If escaping regressed, this would throw or set the flag.
    globalThis.__semanticHandlerInjection = false;
    const elements = [
      element({
        text: "Pwned",
        locator: "'); globalThis.__semanticHandlerInjection = true; ('",
      }),
    ];

    assert.doesNotThrow(() => install(elements));
    assert.equal(globalThis.__semanticHandlerInjection, false);
    delete globalThis.__semanticHandlerInjection;
  });

  it("gives every element a usable tool name even with no textual label", () => {
    const { tools } = install([
      element({ tag: "button", text: "→", locator: "#icon" }),
    ]);

    const names = Object.keys(tools);
    assert.equal(names.length, 1);
    assert.ok(names[0].length > 0, "tool name must not be empty");
    assert.equal(typeof tools[names[0]], "function");
  });

  it("disambiguates colliding tool names instead of overwriting", async () => {
    const first = new HTMLElement("button");
    const second = new HTMLElement("button");
    const { webmcp, tools } = install(
      [
        element({ text: "Login", locator: "#login-header" }),
        element({ text: "Login", locator: "#login-footer", intentScore: 70 }),
      ],
      { "#login-header": first, "#login-footer": second }
    );

    assert.equal(Object.keys(tools).length, 2, "one handler was overwritten");
    assert.deepEqual(webmcp.registeredTools, Object.keys(tools));

    await tools[webmcp.registeredTools[0]]();
    await tools[webmcp.registeredTools[1]]();
    assert.equal(first.clicks, 1);
    assert.equal(second.clicks, 1);
  });

  it("isolates failures so one broken tool does not prevent others running", async () => {
    const good = new HTMLElement("button");
    const { tools } = install(
      [
        element({ text: "Good", locator: "#good" }),
        element({ text: "Missing", locator: "#missing", intentScore: 70 }),
      ],
      { "#good": good }
    );

    const bad = await tools.missing();
    const ok = await tools.good();

    assert.equal(bad.success, false);
    assert.equal(ok.success, true);
    assert.equal(good.clicks, 1);
  });
});
