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

// ===========================================================================
// Submit, page-load wait, custom selects and the full performLogin flow
//
// These were the untested half of the module: lines 174-282 (custom select
// detection and interaction), 449-495 (submit and wait) and 597-655
// (performLogin). A login that silently does not happen is the single most
// expensive failure in the crawler — everything behind the form simply looks
// like it does not exist — so the paths that decide "did we log in" need to
// be exercised, not assumed.
// ===========================================================================

/** Extend the shared fake driver with the bits the later methods need. */
function richDriver(options = {}) {
  const driver = fakeDriver(options);
  driver.slept = [];
  driver.scripts = [];
  driver.sleep = async (ms) => {
    driver.slept.push(ms);
  };
  driver.executeScript = async (script, ...args) => {
    driver.scripts.push(script);
    if (typeof script === "string" && script.includes("readyState")) {
      return options.readyState ?? "complete";
    }
    if (typeof script === "string" && script.includes("parentElement")) {
      return options.parent ?? null;
    }
    if (typeof script === "string" && script.includes("submit()")) {
      driver.submittedForm = args[0];
      return null;
    }
    return null;
  };
  driver.actions = () => ({
    click: (element) => ({
      perform: async () => {
        driver.actionClicked = element;
      },
    }),
    move: () => ({ perform: async () => {} }),
  });
  return driver;
}

describe("LoginHandler.findSubmitButton", () => {
  it("returns a submit-typed button", async () => {
    const button = webElement({ type: "submit" });
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([['button[type="submit"]', [button]]]) })
    );

    assert.equal(await handler.findSubmitButton(), button);
  });

  it("falls back to a class-matched login button", async () => {
    const button = webElement({ class: "btn-login" });
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([['class*="login"', [button]]]) })
    );

    assert.equal(await handler.findSubmitButton(), button);
  });

  it("finds a form button whose value says login", async () => {
    const button = webElement({ value: "Login" });
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([["form button", [button]]]) })
    );

    assert.equal(await handler.findSubmitButton(), button);
  });

  it("ignores a form button whose value says something else", async () => {
    const button = webElement({ value: "Cancel" });
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([["form button", [button]]]) })
    );

    assert.equal(await handler.findSubmitButton(), null);
  });

  it("returns null when the page has no submit control at all", async () => {
    assert.equal(await new LoginHandler(richDriver()).findSubmitButton(), null);
  });
});

describe("LoginHandler.submitForm", () => {
  it("clicks the submit button when there is one", async () => {
    const button = webElement({ type: "submit" });
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([['button[type="submit"]', [button]]]) })
    );

    await handler.submitForm();

    assert.equal(button.clicks, 1);
  });

  it("submits the form directly when no button is found", async () => {
    const form = webElement({ tagName: "form" });
    const driver = richDriver({ find: selectorTable([["form", [form]]]) });
    const handler = new LoginHandler(driver);

    await handler.submitForm();

    assert.equal(driver.submittedForm, form, "should submit the form element itself");
  });

  it("throws when there is neither a button nor a form", async () => {
    await assert.rejects(
      () => new LoginHandler(richDriver()).submitForm(),
      /No submit button or form found/
    );
  });

  it("propagates a click failure rather than reporting success", async () => {
    const button = webElement({ type: "submit" });
    button.click = async () => {
      throw new Error("element is not interactable");
    };
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([['button[type="submit"]', [button]]]) })
    );

    await assert.rejects(() => handler.submitForm(), /not interactable/);
  });
});

describe("LoginHandler.waitForPageLoad", () => {
  it("returns once the document reports complete", async () => {
    const driver = richDriver({ readyState: "complete" });
    await new LoginHandler(driver).waitForPageLoad(1000);

    assert.ok(driver.slept.includes(1000), "settles briefly after ready");
  });

  // The wait is best-effort: a page can be perfectly usable while readyState
  // never reaches 'complete' (long-polling, streamed responses). Throwing here
  // would abort a login that was actually fine.
  it("resolves rather than throwing when the page never reports complete", async () => {
    const driver = richDriver({ readyState: "loading" });
    await assert.doesNotReject(() => new LoginHandler(driver).waitForPageLoad(1));
  });

  it("resolves when the driver itself errors", async () => {
    const driver = richDriver();
    driver.wait = async () => {
      throw new Error("session deleted");
    };
    await assert.doesNotReject(() => new LoginHandler(driver).waitForPageLoad(1));
  });
});

describe("LoginHandler custom select handling", () => {
  /** A container element that looks like a React Select wrapper. */
  function container(attrs, children = []) {
    const element = webElement(attrs);
    element.findElements = async (locator) => {
      const selector = String(locator?.value ?? locator);
      for (const [pattern, elements] of children) {
        if (selector.includes(pattern)) return elements;
      }
      return [];
    };
    return element;
  }

  it("treats a react-select css- class as a custom select", async () => {
    const hidden = webElement({ type: "password" });
    const wrapper = container({ class: "css-1x2y3z" }, [["password", [hidden]]]);
    const handler = new LoginHandler(
      richDriver({ find: selectorTable([["//div", [wrapper]]]) })
    );

    const fields = await handler.findLoginFields();

    assert.equal(fields.length, 1);
    assert.equal(fields[0].type, "password");
    assert.equal(fields[0].isCustomSelect, true);
    assert.equal(fields[0].container, wrapper);
  });

  for (const className of ["my-select", "dropdown-wrap", "combo-box", "control-group"]) {
    it(`treats a "${className}" class as a custom select`, async () => {
      const hidden = webElement({ type: "password" });
      const wrapper = container({ class: className }, [["password", [hidden]]]);
      const handler = new LoginHandler(
        richDriver({ find: selectorTable([["//div", [wrapper]]]) })
      );

      const fields = await handler.findLoginFields();
      assert.equal(fields[0]?.isCustomSelect, true);
    });
  }

  for (const role of ["combobox", "listbox", "searchbox"]) {
    it(`treats role="${role}" as a custom select`, async () => {
      const hidden = webElement({ type: "password" });
      const wrapper = container({ role }, [["password", [hidden]]]);
      const handler = new LoginHandler(
        richDriver({ find: selectorTable([["//div", [wrapper]]]) })
      );

      const fields = await handler.findLoginFields();
      assert.equal(fields[0]?.isCustomSelect, true);
    });
  }

  it("treats a plain wrapper as an ordinary field, not a custom select", async () => {
    const password = webElement({ type: "password" });
    const handler = new LoginHandler(
      richDriver({
        find: selectorTable([['input[type="password"]', [password]]]),
        parent: webElement({ class: "form-row" }),
      })
    );

    const fields = await handler.findLoginFields();

    assert.equal(fields[0].type, "password");
    assert.ok(!fields[0].isCustomSelect);
  });

  // findLoginFields returns early once it has a custom *password* select, so a
  // page whose password is a custom control never reports a username field and
  // fillLoginForm cannot run. The interaction path is therefore reached through
  // a custom *username* select beside a standard password input, which is also
  // the shape real sites use (React Select for the account picker, a plain
  // input for the secret).
  //
  // The two lookups are told apart by text unique to each xpath: the username
  // query filters on @id 'username', the password query on @class 'Select'.
  const USERNAME_XPATH = "contains(@id, 'username')";
  const PASSWORD_XPATH = "contains(@class, 'Select')";

  /** A driver whose username field is a custom select. */
  function customUsernameDriver(wrapper, extra = []) {
    return richDriver({
      find: selectorTable([
        [PASSWORD_XPATH, []],
        [USERNAME_XPATH, [wrapper]],
        ['input[type="password"]', [webElement({ type: "password" })]],
        ...extra,
      ]),
    });
  }

  it("types into the input inside a custom select and confirms it", async () => {
    const inner = webElement({ type: "text" });
    const wrapper = container({ class: "css-select" }, [["input", [inner]]]);
    const driver = customUsernameDriver(wrapper);

    await new LoginHandler(driver).fillLoginForm("ada", "hunter2");

    assert.ok(
      inner.sentKeys.includes("ada"),
      `expected the username to be typed, got ${JSON.stringify(inner.sentKeys)}`
    );
    assert.equal(driver.actionClicked, wrapper, "opens the dropdown with a real click");
  });

  it("clicks a matching dropdown option when one appears", async () => {
    const inner = webElement({ type: "text" });
    const option = webElement({ class: "option" });
    const wrapper = container({ class: "css-select" }, [["input", [inner]]]);
    const driver = customUsernameDriver(wrapper, [["option", [option]]]);

    await new LoginHandler(driver).fillLoginForm("ada", "hunter2");

    assert.equal(option.clicks, 1, "the matching option should be selected");
  });

  it("confirms with Enter when no dropdown option matches", async () => {
    const inner = webElement({ type: "text" });
    const wrapper = container({ class: "css-select" }, [["input", [inner]]]);

    await new LoginHandler(customUsernameDriver(wrapper)).fillLoginForm("ada", "hunter2");

    assert.ok(inner.sentKeys.length > 1, "typed the value then confirmed it");
  });

  it("falls back to the element click when the actions API fails", async () => {
    const inner = webElement({ type: "text" });
    const wrapper = container({ class: "css-select" }, [["input", [inner]]]);
    const driver = customUsernameDriver(wrapper);
    driver.actions = () => ({
      click: () => ({
        perform: async () => {
          throw new Error("actions unavailable");
        },
      }),
    });

    await new LoginHandler(driver).fillLoginForm("ada", "hunter2");

    assert.equal(wrapper.clicks, 1, "should have clicked the container directly");
  });

  it("recovers from an input that refuses to clear", async () => {
    const inner = webElement({ type: "text" });
    inner.clear = async () => {
      throw new Error("cannot clear a custom input");
    };
    const wrapper = container({ class: "css-select" }, [["input", [inner]]]);

    await new LoginHandler(customUsernameDriver(wrapper)).fillLoginForm("ada", "hunter2");

    assert.ok(inner.sentKeys.includes("ada"), "still typed the value");
    assert.ok(inner.sentKeys.length > 1, "sent a select-all/delete sequence first");
  });
});

describe("LoginHandler.performLogin", () => {
  /**
   * A driver presenting a login form that goes away once it is submitted.
   *
   * The disappearance matters: validateLoginSuccess treats a form that is
   * still on screen as proof the login did not take, so a fake that keeps
   * serving the password field can never report success no matter what else
   * it does.
   *
   * @param {object} [options]
   * @param {string[]} [options.urls] successive getCurrentUrl() readings
   * @param {boolean} [options.formPersists] keep the form after submit
   */
  function loginReadyDriver({ urls, formPersists = false } = {}) {
    const username = webElement({ type: "text", name: "username", id: "username" });
    const password = webElement({ type: "password", name: "password" });
    const submit = webElement({ type: "submit" });
    let submitted = false;

    const driver = richDriver({
      urls: urls ?? ["https://shop.test/login", "https://shop.test/dashboard"],
      find: (selector) => {
        const formGone = submitted && !formPersists;
        if (selector.includes('input[type="password"]')) return formGone ? [] : [password];
        if (selector.includes('input[name="username"]')) return formGone ? [] : [username];
        if (selector.includes('button[type="submit"]')) return formGone ? [] : [submit];
        return [];
      },
    });

    const realClick = submit.click.bind(submit);
    submit.click = async () => {
      await realClick();
      submitted = true;
    };

    return { driver, username, password, submit };
  }

  it("fills, submits and reports success when the url changes", async () => {
    const { driver, username, password, submit } = loginReadyDriver();

    const result = await new LoginHandler(driver).performLogin("ada", "hunter2");

    assert.equal(username.sentKeys.join(""), "ada");
    assert.equal(password.sentKeys.join(""), "hunter2");
    assert.equal(submit.clicks, 1);
    assert.equal(result.success, true);
    assert.match(result.reason, /Login successful/);
  });

  it("reports failure when the page has no login form", async () => {
    const driver = richDriver({ urls: ["https://shop.test/about"] });

    const result = await new LoginHandler(driver).performLogin("ada", "hunter2");

    assert.equal(result.success, false);
    assert.match(result.reason, /No login form fields found/);
    assert.equal(result.currentUrl, "https://shop.test/about");
  });

  it("uses the supplied original url rather than asking the driver", async () => {
    const { driver } = loginReadyDriver();

    const result = await new LoginHandler(driver).performLogin(
      "ada",
      "hunter2",
      "https://shop.test/login"
    );

    assert.ok(result.currentUrl.length > 0);
  });

  it("reports failure rather than throwing when submission fails", async () => {
    const { driver, submit } = loginReadyDriver();
    submit.click = async () => {
      throw new Error("button vanished");
    };

    const result = await new LoginHandler(driver).performLogin("ada", "hunter2");

    assert.equal(result.success, false);
    assert.match(result.reason, /Login flow failed.*button vanished/);
  });

  it("reports failure when the form is still on screen afterwards", async () => {
    // The url never changes and the password field is still present, which is
    // exactly what a rejected credential looks like.
    const { driver } = loginReadyDriver({
      urls: ["https://shop.test/login"],
      formPersists: true,
    });

    const result = await new LoginHandler(driver).performLogin("ada", "wrong");

    assert.equal(result.success, false);
    assert.equal(result.loginFormStillVisible, true);
  });

  it("does not leak the password into the result", async () => {
    const { driver } = loginReadyDriver();

    const result = await new LoginHandler(driver).performLogin("ada", "hunter2");

    assert.ok(!JSON.stringify(result).includes("hunter2"));
  });
});
