/**
 * LoginHandler against a fake WebDriver.
 *
 * The login path decides whether a crawl gets behind authentication at all, so
 * a wrong "login succeeded" silently halves the crawl. None of this needs a
 * real browser: LoginHandler only talks to the driver interface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LoginHandler } from "../../build/login-handler.js";

/** A fake WebElement. */
function webElement(attrs = {}) {
  return {
    attrs,
    sentKeys: [],
    cleared: 0,
    clicks: 0,
    async getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    async getTagName() {
      return attrs.tagName ?? "input";
    },
    async isDisplayed() {
      return attrs.displayed !== false;
    },
    async isEnabled() {
      return attrs.enabled !== false;
    },
    async sendKeys(...keys) {
      this.sentKeys.push(keys.join(""));
    },
    async clear() {
      this.cleared += 1;
    },
    async click() {
      this.clicks += 1;
    },
    async getText() {
      return attrs.text ?? "";
    },
    async findElements() {
      return [];
    },
  };
}

/**
 * Fake driver.
 *
 * @param {object} opts
 * @param {(selector: string) => any[]} opts.find  elements per CSS selector
 * @param {string[]} opts.urls  successive getCurrentUrl() results
 */
function fakeDriver({ find = () => [], urls = ["https://shop.test/login"] } = {}) {
  let urlIndex = 0;
  const queried = [];
  return {
    queried,
    async getCurrentUrl() {
      const url = urls[Math.min(urlIndex, urls.length - 1)];
      urlIndex += 1;
      return url;
    },
    async findElements(locator) {
      const selector = String(locator?.value ?? locator);
      queried.push(selector);
      try {
        return find(selector) ?? [];
      } catch {
        return [];
      }
    },
    async findElement(locator) {
      const found = await this.findElements(locator);
      if (!found.length) throw new Error("NoSuchElementError");
      return found[0];
    },
    async wait(condition, _timeout) {
      // Evaluate once; the production code tolerates a timeout.
      const ok = await condition();
      if (!ok) throw new Error("TimeoutError");
      return ok;
    },
    async executeScript() {
      return null;
    },
    manage() {
      return { logs: () => ({ get: async () => [] }) };
    },
  };
}

/** Match a selector against a tiny table of fake elements. */
function selectorTable(table) {
  return (selector) => {
    for (const [pattern, elements] of table) {
      if (selector.includes(pattern)) return elements;
    }
    return [];
  };
}

describe("LoginHandler.findLoginFields", () => {
  it("finds a username and a password field", async () => {
    const username = webElement({ type: "text", name: "username", id: "username" });
    const password = webElement({ type: "password", name: "password", id: "password" });

    const handler = new LoginHandler(
      fakeDriver({
        find: selectorTable([
          ["password", [password]],
          ["username", [username]],
          ["text", [username]],
        ]),
      })
    );

    const fields = await handler.findLoginFields();
    const types = fields.map((f) => f.type);

    assert.ok(types.includes("password"), `no password field found: ${JSON.stringify(types)}`);
    assert.ok(types.includes("username"), `no username field found: ${JSON.stringify(types)}`);
  });

  it("returns nothing on a page with no form fields", async () => {
    const handler = new LoginHandler(fakeDriver({ find: () => [] }));
    assert.deepEqual(await handler.findLoginFields(), []);
  });

  it("does not throw when the driver rejects a selector", async () => {
    const handler = new LoginHandler(
      fakeDriver({
        find: () => {
          throw new Error("invalid selector");
        },
      })
    );

    await assert.doesNotReject(() => handler.findLoginFields());
  });

  it("matches a password field on type alone, without a visibility check", async () => {
    // Documented, not endorsed: findLoginFields selects on
    // input[type="password"] and never calls isDisplayed(). A hidden or
    // honeypot field therefore counts as a login field, and the subsequent
    // fill attempt is what fails. Filling is wrapped in try/catch so this
    // degrades rather than crashing, but it does mean a decoy field can be
    // preferred over the real one.
    const hidden = webElement({ type: "password", name: "password", displayed: false });
    const handler = new LoginHandler(
      fakeDriver({ find: selectorTable([["password", [hidden]]]) })
    );

    const fields = await handler.findLoginFields();
    assert.ok(
      fields.some((f) => f.type === "password"),
      "current behaviour: the field is matched regardless of visibility"
    );
  });
});

describe("LoginHandler.validateLoginSuccess", () => {
  it("reports success when the url changes and the form is gone", async () => {
    const handler = new LoginHandler(
      fakeDriver({
        urls: ["https://shop.test/dashboard"],
        find: () => [],
      })
    );

    const result = await handler.validateLoginSuccess("https://shop.test/login");

    assert.equal(result.success, true);
    assert.equal(result.currentUrl, "https://shop.test/dashboard");
    assert.equal(result.loginFormStillVisible, false);
  });

  it("reports failure when the login form is still on screen", async () => {
    const password = webElement({ type: "password", name: "password" });
    const handler = new LoginHandler(
      fakeDriver({
        urls: ["https://shop.test/login"],
        find: selectorTable([["password", [password]]]),
      })
    );

    const result = await handler.validateLoginSuccess("https://shop.test/login");

    assert.equal(result.success, false);
    assert.equal(result.loginFormStillVisible, true);
    assert.match(result.reason, /inconclusive/i);
  });

  it("treats a logout link as evidence of a logged-in session", async () => {
    const logout = webElement({ tagName: "a", href: "/logout" });
    const handler = new LoginHandler(
      fakeDriver({
        urls: ["https://shop.test/dashboard"],
        find: selectorTable([['href*="logout"', [logout]]]),
      })
    );

    const result = await handler.validateLoginSuccess("https://shop.test/login");

    assert.equal(result.hasLogoutButton, true);
    assert.equal(result.success, true);
  });

  it("always reports the current url, including on the failure path", async () => {
    const handler = new LoginHandler(
      fakeDriver({ urls: ["https://shop.test/login"], find: () => [] })
    );

    const result = await handler.validateLoginSuccess("https://shop.test/login");
    assert.equal(result.currentUrl, "https://shop.test/login");
  });

  it("explains an inconclusive result with the signals it checked", async () => {
    const handler = new LoginHandler(
      fakeDriver({ urls: ["https://shop.test/login"], find: () => [] })
    );

    const result = await handler.validateLoginSuccess("https://shop.test/login");

    assert.match(result.reason, /URL changed=/);
    assert.match(result.reason, /logout button=/);
    assert.match(result.reason, /login form still visible=/);
  });

  it("honours a short maxWaitTime without hanging", async () => {
    const handler = new LoginHandler(
      fakeDriver({ urls: ["https://shop.test/login"], find: () => [] })
    );

    const started = Date.now();
    await handler.validateLoginSuccess("https://shop.test/login", { maxWaitTime: 50 });
    assert.ok(Date.now() - started < 5000, "validation should not hang");
  });
});

describe("LoginHandler.fillLoginForm", () => {
  it("types the credentials into the matching fields", async () => {
    const username = webElement({ type: "text", name: "username", id: "username" });
    const password = webElement({ type: "password", name: "password", id: "password" });

    const handler = new LoginHandler(
      fakeDriver({
        find: selectorTable([
          ["password", [password]],
          ["username", [username]],
          ["text", [username]],
        ]),
      })
    );

    await handler.fillLoginForm("admin", "password123");

    assert.ok(
      password.sentKeys.join("").includes("password123"),
      `password field received ${JSON.stringify(password.sentKeys)}`
    );
    assert.ok(
      username.sentKeys.join("").includes("admin"),
      `username field received ${JSON.stringify(username.sentKeys)}`
    );
  });

  it("reports a missing form rather than silently doing nothing", async () => {
    const handler = new LoginHandler(fakeDriver({ find: () => [] }));

    await assert.rejects(
      () => handler.fillLoginForm("admin", "password123"),
      /No login form fields found/
    );
  });

  it("clears a field before typing into it", async () => {
    const username = webElement({ type: "text", name: "username", id: "username" });
    const password = webElement({ type: "password", name: "password", id: "password" });

    const handler = new LoginHandler(
      fakeDriver({
        find: selectorTable([
          ["password", [password]],
          ["username", [username]],
          ["text", [username]],
        ]),
      })
    );

    await handler.fillLoginForm("admin", "password123");

    assert.ok(password.cleared > 0, "password field was not cleared before typing");
  });

  it("does not leak the password into the username field", async () => {
    const username = webElement({ type: "text", name: "username", id: "username" });
    const password = webElement({ type: "password", name: "password", id: "password" });

    const handler = new LoginHandler(
      fakeDriver({
        find: selectorTable([
          ["password", [password]],
          ["username", [username]],
          ["text", [username]],
        ]),
      })
    );

    await handler.fillLoginForm("admin", "password123");

    assert.ok(
      !username.sentKeys.join("").includes("password123"),
      "the password was typed into the username field"
    );
  });
});
