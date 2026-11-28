/**
 * MultiPageCrawler: BFS traversal, URL handling and failure classification.
 *
 * 706 lines with no test, and the component that decides how much of a site
 * ever gets seen. Its failures are all of the quiet kind: a depth guard off by
 * one, an exclude pattern that matches too much, a relative href resolved
 * against the wrong base — each one shrinks the crawl without producing an
 * error, so the output still looks like a successful run of a smaller site.
 *
 * MultiPageCrawler builds its own SiteCrawler, so there is no constructor seam
 * to inject through. These tests replace the instance field after construction.
 * That is reaching past `private`, and it is the deliberate trade: the
 * alternative is a real Chrome for assertions that are purely about queueing
 * and string handling. The browser-coupled remainder — the click strategies
 * and the post-click login flow — is left to the integration suite rather than
 * reproduced against a mock deep enough to be testing itself.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  MultiPageCrawler,
  CRAWL_DENY_LIST,
  deniedReason,
} from "../../build/multi-page-crawler.js";

// The crawler narrates every page, element and queue transition to stderr. At
// one line per element that buries the actual test output, including the
// failure messages, so it is captured for the duration of each test.
let realError = null;
beforeEach(() => {
  realError = console.error;
  console.error = () => {};
});
afterEach(() => {
  console.error = realError;
});

/**
 * A stand-in for SiteCrawler.
 *
 * @param {object} options
 * @param {Record<string, object|Function>} [options.pages] analysis per URL
 * @param {object} [options.driver] WebDriver stand-in, or null
 */
function fakeSiteCrawler({ pages = {}, driver = null } = {}) {
  return {
    initCalls: 0,
    closeCalls: 0,
    requested: [],
    async init() {
      this.initCalls += 1;
    },
    async close() {
      this.closeCalls += 1;
    },
    getDriver() {
      return driver;
    },
    async crawlAndAnalyze(url, intentThreshold, options) {
      this.requested.push({ url, intentThreshold, options });
      const entry = pages[url];
      if (typeof entry === "function") return entry();
      return (
        entry ?? {
          url,
          title: "Untitled",
          highIntentElements: [],
          consoleLogs: [],
        }
      );
    },
  };
}

/** Analysis result for a page offering the given navigation targets. */
function pageWith(targets, extra = {}) {
  return {
    title: "Page",
    highIntentElements: targets.map((target, i) => ({
      path: `body > a`,
      tag: "a",
      locator: `#link-${i}`,
      text: `Link ${i}`,
      intentScore: 70,
      intentReasons: ["a"],
      navigates: true,
      navigationTarget: target,
    })),
    consoleLogs: [],
    ...extra,
  };
}

/** Build a crawler with its SiteCrawler replaced, returning both. */
function build(config, crawlerOptions) {
  const crawler = new MultiPageCrawler({ startUrl: "https://shop.test/", ...config });
  const fake = fakeSiteCrawler(crawlerOptions);
  crawler.baseCrawler = fake;
  return { crawler, fake };
}

/** URLs actually requested from the underlying crawler, in order. */
async function crawledUrls(config, crawlerOptions) {
  const { crawler, fake } = build(config, crawlerOptions);
  await crawler.crawl();
  return fake.requested.map((r) => r.url);
}

describe("MultiPageCrawler: start url normalisation", () => {
  it("adds https:// when the start url has no protocol", async () => {
    const urls = await crawledUrls({ startUrl: "shop.test/landing" });
    assert.deepEqual(urls, ["https://shop.test/landing"]);
  });

  it("leaves an https url alone", async () => {
    const urls = await crawledUrls({ startUrl: "https://shop.test/x" });
    assert.deepEqual(urls, ["https://shop.test/x"]);
  });

  it("leaves an http url alone rather than upgrading it", async () => {
    const urls = await crawledUrls({ startUrl: "http://shop.test/x" });
    assert.deepEqual(urls, ["http://shop.test/x"]);
  });
});

describe("MultiPageCrawler: browser lifecycle", () => {
  it("initialises the browser once and closes it", async () => {
    const { crawler, fake } = build({}, {});
    await crawler.crawl();

    assert.equal(fake.initCalls, 1);
    assert.equal(fake.closeCalls, 1);
  });

  it("closes the browser even when the crawl throws", async () => {
    const { crawler, fake } = build({}, {});
    fake.init = async () => {
      throw new Error("driver would not start");
    };

    await assert.rejects(() => crawler.crawl(), /driver would not start/);
    assert.equal(fake.closeCalls, 1, "a failed init must still release the driver");
  });
});

describe("MultiPageCrawler: breadth-first traversal", () => {
  it("follows navigation targets discovered on the start page", async () => {
    const urls = await crawledUrls(
      {},
      {
        pages: {
          "https://shop.test/": pageWith([
            "https://shop.test/a",
            "https://shop.test/b",
          ]),
        },
      }
    );

    assert.deepEqual(urls, [
      "https://shop.test/",
      "https://shop.test/a",
      "https://shop.test/b",
    ]);
  });

  it("visits breadth-first, not depth-first", async () => {
    const urls = await crawledUrls(
      {},
      {
        pages: {
          "https://shop.test/": pageWith([
            "https://shop.test/a",
            "https://shop.test/b",
          ]),
          "https://shop.test/a": pageWith(["https://shop.test/a1"]),
          "https://shop.test/b": pageWith(["https://shop.test/b1"]),
        },
      }
    );

    assert.deepEqual(urls, [
      "https://shop.test/",
      "https://shop.test/a",
      "https://shop.test/b",
      "https://shop.test/a1",
      "https://shop.test/b1",
    ]);
  });

  it("never crawls the same url twice", async () => {
    const urls = await crawledUrls(
      {},
      {
        pages: {
          "https://shop.test/": pageWith([
            "https://shop.test/a",
            "https://shop.test/a",
          ]),
          "https://shop.test/a": pageWith(["https://shop.test/"]),
        },
      }
    );

    assert.deepEqual(urls, ["https://shop.test/", "https://shop.test/a"]);
  });

  it("stops at maxPages", async () => {
    const pages = { "https://shop.test/": pageWith([1, 2, 3, 4, 5].map((n) => `https://shop.test/${n}`)) };
    const urls = await crawledUrls({ maxPages: 3 }, { pages });

    assert.equal(urls.length, 3);
  });

  it("does not follow links beyond maxDepth", async () => {
    const urls = await crawledUrls(
      { maxDepth: 1 },
      {
        pages: {
          "https://shop.test/": pageWith(["https://shop.test/a"]),
          "https://shop.test/a": pageWith(["https://shop.test/a1"]),
        },
      }
    );

    assert.deepEqual(
      urls,
      ["https://shop.test/", "https://shop.test/a"],
      "depth 2 is past the limit"
    );
  });

  it("crawls only the start page at maxDepth 0", async () => {
    const urls = await crawledUrls(
      { maxDepth: 0 },
      { pages: { "https://shop.test/": pageWith(["https://shop.test/a"]) } }
    );

    assert.deepEqual(urls, ["https://shop.test/"]);
  });

  it("passes the configured intent threshold and timeouts down to each page", async () => {
    const { crawler, fake } = build(
      {
        intentThreshold: 42,
        pageLoadTimeout: 1234,
        scriptTimeoutMs: 2345,
        analysisTimeoutMs: 3456,
        modelLoadTimeoutMs: 4567,
      },
      {}
    );
    await crawler.crawl();

    const [call] = fake.requested;
    assert.equal(call.intentThreshold, 42);
    assert.deepEqual(call.options, {
      scriptTimeoutMs: 2345,
      pageLoadTimeoutMs: 1234,
      analyzerTimeoutMs: 3456,
      analyzerInitTimeoutMs: 4567,
    });
  });

  it("defaults to an intent threshold of 25 and ten pages", async () => {
    const { crawler, fake } = build({}, {});
    await crawler.crawl();
    assert.equal(fake.requested[0].intentThreshold, 25);
  });
});

describe("MultiPageCrawler: url resolution", () => {
  async function targetsFrom(navigationTarget, startUrl = "https://shop.test/catalog/") {
    const urls = await crawledUrls(
      { startUrl },
      { pages: { [startUrl]: pageWith([navigationTarget]) } }
    );
    return urls[1];
  }

  it("keeps an absolute url as-is", async () => {
    assert.equal(
      await targetsFrom("https://other.test/page"),
      "https://other.test/page"
    );
  });

  it("resolves a root-relative url against the host", async () => {
    assert.equal(await targetsFrom("/cart"), "https://shop.test/cart");
  });

  it("resolves a relative url against the current directory", async () => {
    assert.equal(await targetsFrom("item"), "https://shop.test/catalog/item");
  });

  it("strips a fragment from a resolved relative url", async () => {
    assert.equal(await targetsFrom("item#reviews"), "https://shop.test/catalog/item");
  });

  // As a browser does: the last path segment is a file, not a folder. Treating
  // it as a folder sent every link on .../index.html to .../index.html/page,
  // which on a static host is a 404 page crawled in place of the real one.
  it("resolves against the page's folder when the path ends in a file", async () => {
    assert.equal(
      await targetsFrom("permissions.html", "https://org.github.io/demo/index.html"),
      "https://org.github.io/demo/permissions.html"
    );
    assert.equal(
      await targetsFrom("item", "https://shop.test/catalog"),
      "https://shop.test/item"
    );
  });

  it("resolves a parent-relative url", async () => {
    assert.equal(await targetsFrom("../about"), "https://shop.test/about");
  });
});

describe("MultiPageCrawler: navigation target extraction", () => {
  it("ignores elements that do not navigate", async () => {
    const urls = await crawledUrls(
      {},
      {
        pages: {
          "https://shop.test/": {
            title: "Page",
            consoleLogs: [],
            highIntentElements: [
              { tag: "button", locator: "#b", text: "Click", intentScore: 60, intentReasons: [], navigates: false, navigationTarget: "/nope" },
            ],
          },
        },
      }
    );

    assert.deepEqual(urls, ["https://shop.test/"]);
  });

  // extractNavigationTargets has a fallback that reads `allNavigationLinks`
  // off the page when no element declared a target. The analyzer does emit
  // that list, but crawlSinglePage builds its CrawledPage from only url,
  // title, timestamp, highIntentElements, generatedTestCases and consoleLogs —
  // allNavigationLinks is dropped on the way in. So the fallback reads
  // undefined on every real crawl and the branch is dead.
  //
  // The consequence is not cosmetic: on a page where nothing is marked as
  // navigating, the crawl stops dead at one page instead of falling back to
  // the link list that was collected for exactly this case. Asserted as-is so
  // the test fails if the field is ever plumbed through, which is the moment
  // this comment stops being true.
  it("drops allNavigationLinks before the fallback can use them", async () => {
    const urls = await crawledUrls(
      {},
      {
        pages: {
          "https://shop.test/": {
            title: "Page",
            consoleLogs: [],
            highIntentElements: [],
            allNavigationLinks: ["https://shop.test/from-fallback"],
          },
        },
      }
    );

    assert.deepEqual(
      urls,
      ["https://shop.test/"],
      "the fallback list never reaches extractNavigationTargets"
    );
  });

  it("prefers declared targets over the fallback list", async () => {
    const urls = await crawledUrls(
      {},
      {
        pages: {
          "https://shop.test/": pageWith(["https://shop.test/declared"], {
            allNavigationLinks: ["https://shop.test/ignored"],
          }),
        },
      }
    );

    assert.deepEqual(urls, ["https://shop.test/", "https://shop.test/declared"]);
  });

  it("copes with a page that has no navigation information at all", async () => {
    const urls = await crawledUrls(
      {},
      { pages: { "https://shop.test/": { title: "Page", consoleLogs: [], highIntentElements: [] } } }
    );
    assert.deepEqual(urls, ["https://shop.test/"]);
  });
});

describe("MultiPageCrawler: url patterns", () => {
  const pages = {
    "https://shop.test/": pageWith([
      "https://shop.test/products/1",
      "https://shop.test/admin/secret",
      "https://shop.test/blog/post",
    ]),
  };

  it("skips urls matching an exclude pattern", async () => {
    const urls = await crawledUrls({ urlPatterns: { exclude: ["/admin/"] } }, { pages });
    assert.ok(!urls.some((u) => u.includes("/admin/")));
    assert.ok(urls.includes("https://shop.test/products/1"));
  });

  it("crawls only urls matching an include pattern", async () => {
    const urls = await crawledUrls(
      { urlPatterns: { include: ["shop.test/$", "/products/"] } },
      { pages }
    );
    assert.deepEqual(urls, ["https://shop.test/", "https://shop.test/products/1"]);
  });

  // The include list is applied to the start url as well as to everything it
  // links to, so an include pattern written to describe the *interesting*
  // pages silently produces an empty crawl unless it also admits the entry
  // point. Easy to get wrong, and it fails as a clean result rather than an
  // error.
  it("crawls nothing when the include pattern excludes the start url", async () => {
    const urls = await crawledUrls({ urlPatterns: { include: ["/products/"] } }, { pages });
    assert.deepEqual(urls, []);
  });

  it("lets exclude win over include", async () => {
    const urls = await crawledUrls(
      { urlPatterns: { include: ["shop.test"], exclude: ["/admin/"] } },
      { pages }
    );
    assert.ok(!urls.some((u) => u.includes("/admin/")));
  });

  it("accepts everything when no patterns are configured", async () => {
    const urls = await crawledUrls({}, { pages });
    assert.equal(urls.length, 4);
  });

  it("ignores an unparseable pattern instead of failing the crawl", async () => {
    const urls = await crawledUrls({ urlPatterns: { exclude: ["[unclosed"] } }, { pages });
    assert.equal(urls.length, 4, "a broken pattern must not silently block the crawl");
  });

  it("rejects everything when no include pattern matches", async () => {
    const urls = await crawledUrls({ urlPatterns: { include: ["nothing-matches"] } }, { pages });
    assert.deepEqual(urls, []);
  });
});

describe("MultiPageCrawler: failure handling", () => {
  it("records a failed page and carries on with the rest", async () => {
    const { crawler } = build(
      {},
      {
        pages: {
          "https://shop.test/": pageWith([
            "https://shop.test/broken",
            "https://shop.test/fine",
          ]),
          "https://shop.test/broken": () => {
            throw new Error("page load failed");
          },
        },
      }
    );

    const result = await crawler.crawl();

    assert.equal(result.crawlErrors.length, 1);
    assert.equal(result.crawlErrors[0].url, "https://shop.test/broken");
    assert.equal(result.summary.failedPages, 1);
    assert.equal(result.summary.pagesVisited, 2, "the other two still landed");
  });

  it("treats an analysis error in the payload as a page failure", async () => {
    const { crawler } = build(
      {},
      { pages: { "https://shop.test/": { title: "x", consoleLogs: [], highIntentElements: [], error: "analyzer blew up" } } }
    );

    const result = await crawler.crawl();

    assert.equal(result.crawlErrors.length, 1);
    assert.match(result.crawlErrors[0].message, /analyzer blew up/);
    assert.equal(result.summary.pagesVisited, 0);
  });

  it("records the depth at which a page failed", async () => {
    const { crawler } = build(
      {},
      {
        pages: {
          "https://shop.test/": pageWith(["https://shop.test/deep"]),
          "https://shop.test/deep": () => {
            throw new Error("nope");
          },
        },
      }
    );

    const result = await crawler.crawl();
    assert.equal(result.crawlErrors[0].depth, 1);
  });

  // The phase is what tells an operator whether to look at the network, the
  // analyzer or the page itself, so a misclassification sends them to the
  // wrong place.
  const phases = [
    ["Timeout waiting for page", "analyze"],
    ["script did not return", "analyze"],
    ["could not navigate to url", "navigate"],
    ["page load interrupted", "navigate"],
    [
      "Chrome could not load https://shop.test/: ERR_CONNECTION_REFUSED (the connection was refused). It showed its error page instead.",
      "navigate",
    ],
    ["Chrome could not load https://shop.test/: ERR_TIMED_OUT (the request timed out)", "navigate"],
    ["failed to extract elements", "extract"],
    ["something else entirely", "unknown"],
  ];

  for (const [message, expected] of phases) {
    it(`classifies "${message}" as the ${expected} phase`, async () => {
      const { crawler } = build(
        {},
        {
          pages: {
            "https://shop.test/": () => {
              throw new Error(message);
            },
          },
        }
      );

      const result = await crawler.crawl();
      assert.equal(result.crawlErrors[0].phase, expected);
    });
  }

  it("classifies a non-Error throw without crashing", async () => {
    const { crawler } = build(
      {},
      {
        pages: {
          "https://shop.test/": () => {
            throw "a bare string";
          },
        },
      }
    );

    const result = await crawler.crawl();
    assert.equal(result.crawlErrors[0].message, "a bare string");
    assert.equal(result.crawlErrors[0].phase, "unknown");
  });
});

describe("MultiPageCrawler: result summary", () => {
  it("counts pages, elements and workflows", async () => {
    const { crawler } = build(
      {},
      {
        pages: {
          "https://shop.test/": pageWith([
            "https://shop.test/a",
            "https://shop.test/b",
          ]),
        },
      }
    );

    const result = await crawler.crawl();

    assert.equal(result.summary.pagesVisited, 3);
    assert.equal(result.summary.failedPages, 0);
    assert.equal(result.summary.totalElements, 2, "only the start page had elements");
    assert.equal(result.summary.workflowsDetected, result.detectedWorkflows.length);
  });

  it("reports timing and the configured concurrency", async () => {
    const { crawler } = build({ concurrencyLimit: 7 }, {});
    const result = await crawler.crawl();

    assert.equal(result.performance.concurrency, 7);
    assert.ok(result.performance.totalTime >= 0);
    assert.ok(result.performance.avgTimePerPage >= 0);
  });

  it("reports zero average time rather than dividing by zero when nothing was crawled", async () => {
    const { crawler } = build({ urlPatterns: { include: ["no-match"] } }, {});
    const result = await crawler.crawl();

    assert.equal(result.summary.pagesVisited, 0);
    assert.equal(result.performance.avgTimePerPage, 0);
  });

  it("attaches the session, its pages and inferred journeys", async () => {
    const { crawler } = build(
      {},
      { pages: { "https://shop.test/": pageWith(["https://shop.test/a"]) } }
    );

    const result = await crawler.crawl();

    assert.equal(result.session.pages.length, 2);
    assert.equal(result.session.startUrl, "https://shop.test/");
    assert.ok(Array.isArray(result.inferredJourneys));
    assert.equal(result.session.inferredJourneys, result.inferredJourneys);
  });

  it("records the page title, falling back to Untitled", async () => {
    const { crawler } = build(
      {},
      {
        pages: {
          "https://shop.test/": { consoleLogs: [], highIntentElements: [] },
        },
      }
    );

    const result = await crawler.crawl();
    assert.equal(result.session.pages[0].title, "Untitled");
  });

  it("skips workflow detection when it is switched off", async () => {
    const { crawler } = build({ detectWorkflows: false }, {});
    const result = await crawler.crawl();

    assert.deepEqual(result.detectedWorkflows, []);
  });
});

describe("MultiPageCrawler: credentials and login gating", () => {
  /** A driver reporting whether a login form is present. */
  function fakeDriver({ passwordInputs = 0, usernameInputs = 0 } = {}) {
    return {
      findElementsCalls: [],
      async findElements(by) {
        const selector = JSON.stringify(by);
        this.findElementsCalls.push(selector);
        if (selector.includes("password")) {
          return Array.from({ length: passwordInputs }, () => ({}));
        }
        return Array.from({ length: usernameInputs }, () => ({}));
      },
      async getCurrentUrl() {
        return "https://shop.test/";
      },
    };
  }

  it("loads supplied credentials into session state", async () => {
    const { crawler } = build(
      { credentials: { username: "ada", password: "hunter2" } },
      {}
    );
    const result = await crawler.crawl();

    assert.equal(result.session.sessionState.username, "ada");
    assert.equal(result.session.sessionState.password, "hunter2");
  });

  it("ignores a half-supplied credential pair", async () => {
    const { crawler } = build({ credentials: { username: "ada", password: "" } }, {});
    const result = await crawler.crawl();

    assert.equal(result.session.sessionState.username, undefined);
  });

  it("does not probe for a login form when there are no credentials", async () => {
    const driver = fakeDriver({ passwordInputs: 1, usernameInputs: 1 });
    const { crawler } = build({}, { driver });

    await crawler.crawl();

    assert.deepEqual(driver.findElementsCalls, [], "no credentials, no login work");
  });

  it("probes for a login form when credentials are present", async () => {
    const driver = fakeDriver();
    const { crawler } = build(
      { credentials: { username: "ada", password: "hunter2" } },
      { driver }
    );

    await crawler.crawl();

    assert.ok(driver.findElementsCalls.length > 0, "should have looked for a form");
  });

  it("skips login handling when auto-login is disabled", async () => {
    const driver = fakeDriver({ passwordInputs: 1, usernameInputs: 1 });
    const { crawler } = build(
      {
        credentials: { username: "ada", password: "hunter2" },
        enableAutoLogin: false,
      },
      { driver }
    );

    await crawler.crawl();

    assert.deepEqual(driver.findElementsCalls, []);
  });

  it("completes the crawl when no driver is available for login", async () => {
    const { crawler } = build(
      { credentials: { username: "ada", password: "hunter2" } },
      { driver: null }
    );

    await assert.doesNotReject(() => crawler.crawl());
  });

  it("records a login failure in session state rather than aborting", async () => {
    const driver = fakeDriver({ passwordInputs: 1, usernameInputs: 1 });
    // The real LoginHandler will not find fields on this bare driver, so the
    // login attempt fails; the crawl must survive it.
    driver.findElement = async () => {
      throw new Error("no such element");
    };
    driver.executeScript = async () => null;
    driver.manage = () => ({ setTimeouts: async () => {} });

    const { crawler } = build(
      { credentials: { username: "ada", password: "hunter2" } },
      { driver }
    );

    const result = await crawler.crawl();
    const state = result.session.sessionState;

    assert.ok(
      state.lastLoginFailure || state.lastLoginError,
      "a failed login must leave a trace in session state"
    );
    assert.equal(result.summary.pagesVisited, 1, "and must not abort the crawl");
  });
});

describe("MultiPageCrawler: button navigation", () => {
  /** An element that claims to navigate but names no target. */
  function navButton(overrides = {}) {
    return {
      path: "body > button",
      tag: "button",
      locator: "#go",
      text: "Open catalog",
      intentScore: 80,
      intentReasons: ["button"],
      navigates: true,
      ...overrides,
    };
  }

  // The crawler reads the "before" url *after* issuing the click, then polls
  // for it to change. A fake that updates synchronously on click would make
  // before and after identical and the poll would spin for its full 5s budget.
  // So navigation lands one read later, as it does in a real browser.
  it("queues a url discovered by clicking a targetless button", async () => {
    let currentUrl = "https://shop.test/";
    let pendingUrl = null;
    const clicked = [];
    const driver = {
      async findElement() {
        return {
          click: async () => {
            clicked.push("by-id");
            pendingUrl = "https://shop.test/catalog";
          },
        };
      },
      async findElements() {
        return [];
      },
      actions() {
        return { move: () => ({ perform: async () => {} }), click: () => ({ perform: async () => {} }) };
      },
      async getCurrentUrl() {
        const value = currentUrl;
        if (pendingUrl) {
          currentUrl = pendingUrl;
          pendingUrl = null;
        }
        return value;
      },
      async executeScript() {
        return null;
      },
    };

    const { crawler, fake } = build(
      {},
      {
        driver,
        pages: {
          "https://shop.test/": {
            title: "Home",
            consoleLogs: [],
            highIntentElements: [navButton({ id: "go" })],
          },
        },
      }
    );

    await crawler.crawl();

    assert.ok(clicked.length > 0, "the button should have been clicked");
    assert.deepEqual(fake.requested.map((r) => r.url), [
      "https://shop.test/",
      "https://shop.test/catalog",
    ]);
  });

  it("carries on when no click strategy finds the button", async () => {
    const driver = {
      async findElement() {
        throw new Error("no such element");
      },
      async findElements() {
        return [];
      },
      actions() {
        return { move: () => ({ perform: async () => {} }), click: () => ({ perform: async () => {} }) };
      },
      async getCurrentUrl() {
        return "https://shop.test/";
      },
      async executeScript() {
        return null;
      },
    };

    const { crawler, fake } = build(
      {},
      {
        driver,
        pages: {
          "https://shop.test/": {
            title: "Home",
            consoleLogs: [],
            highIntentElements: [navButton({ id: "missing" })],
          },
        },
      }
    );

    await crawler.crawl();

    assert.deepEqual(fake.requested.map((r) => r.url), ["https://shop.test/"]);
  });

  it("does nothing when there is no driver to click with", async () => {
    const { crawler, fake } = build(
      {},
      {
        driver: null,
        pages: {
          "https://shop.test/": {
            title: "Home",
            consoleLogs: [],
            highIntentElements: [navButton({ id: "go" })],
          },
        },
      }
    );

    await crawler.crawl();
    assert.deepEqual(fake.requested.map((r) => r.url), ["https://shop.test/"]);
  });
});

describe("MultiPageCrawler: deny-list for links and buttons", () => {
  // A crawl with credentials must not sign itself out, and no crawl may
  // delete, buy or submit anything on a real site just by exploring it.

  /** A link element with the given target and text. */
  function link(target, text = "Link", extra = {}) {
    return {
      path: "body > a",
      tag: "a",
      locator: "a",
      text,
      intentScore: 70,
      intentReasons: ["a"],
      navigates: true,
      navigationTarget: target,
      ...extra,
    };
  }

  function homeWith(elements) {
    return {
      pages: {
        "https://shop.test/": { title: "Home", consoleLogs: [], highIntentElements: elements },
      },
    };
  }

  const deniedUrls = [
    "https://shop.test/logout",
    "https://shop.test/log-out",
    "https://shop.test/users/sign_out",
    "https://shop.test/account/signOut",
    "https://shop.test/session?action=logout",
    "https://shop.test/items/5/delete",
    "https://shop.test/cart/remove?id=3",
    "https://shop.test/newsletter/unsubscribe",
    "https://shop.test/account/deactivate",
    "https://shop.test/buy-now/42",
    "https://shop.test/place-order",
  ];
  for (const url of deniedUrls) {
    it(`does not follow ${url}`, async () => {
      const { crawler, fake } = build({}, homeWith([link(url), link("https://shop.test/about")]));
      const result = await crawler.crawl();
      assert.deepEqual(fake.requested.map((r) => r.url), [
        "https://shop.test/",
        "https://shop.test/about",
      ]);
      assert.equal(result.crawlErrors.length, 0, "a skipped link is not an error");
    });
  }

  it("does not follow a harmless-looking url whose link text says log out", async () => {
    const urls = await crawledUrls({}, homeWith([link("https://shop.test/session/end", "Log out")]));
    assert.deepEqual(urls, ["https://shop.test/"]);
  });

  it("does not follow a link whose aria-label says delete", async () => {
    const urls = await crawledUrls(
      {},
      homeWith([link("https://shop.test/x/9", "", { ariaLabel: "Delete item" })])
    );
    assert.deepEqual(urls, ["https://shop.test/"]);
  });

  it("still follows a plain /checkout page link, since loading a page buys nothing", async () => {
    const urls = await crawledUrls({}, homeWith([link("https://shop.test/checkout", "Checkout")]));
    assert.deepEqual(urls, ["https://shop.test/", "https://shop.test/checkout"]);
  });

  it("does not match words that merely contain a denied word", async () => {
    const urls = await crawledUrls(
      {},
      homeWith([link("https://shop.test/blog/deleted-scenes", "Deleted scenes")])
    );
    assert.deepEqual(urls, ["https://shop.test/", "https://shop.test/blog/deleted-scenes"]);
  });

  it("logs each skipped link to stderr", async () => {
    const lines = [];
    console.error = (...args) => lines.push(args.join(" "));
    await crawledUrls({}, homeWith([link("https://shop.test/logout", "Sign out")]));
    assert.ok(
      lines.some((l) => l.includes("[multi-page-crawler]") && /deny-list/i.test(l) && l.includes("/logout")),
      "expected a [multi-page-crawler] deny-list line naming the url"
    );
  });

  it("does not crawl a denied url discovered by clicking a button", async () => {
    let currentUrl = "https://shop.test/";
    let pendingUrl = null;
    const driver = {
      async findElement() {
        return { click: async () => { pendingUrl = "https://shop.test/logout"; } };
      },
      async findElements() { return []; },
      actions() {
        return { move: () => ({ perform: async () => {} }), click: () => ({ perform: async () => {} }) };
      },
      async getCurrentUrl() {
        const value = currentUrl;
        if (pendingUrl) { currentUrl = pendingUrl; pendingUrl = null; }
        return value;
      },
      async executeScript() { return null; },
    };
    const { crawler, fake } = build({}, { driver, ...homeWith([
      { tag: "button", locator: "#menu", id: "menu", text: "Menu", intentScore: 80, intentReasons: [], navigates: true },
    ]) });
    await crawler.crawl();
    assert.deepEqual(fake.requested.map((r) => r.url), ["https://shop.test/"]);
  });

  /** A driver that records every click and every JS lookup it is asked to do. */
  function recordingDriver() {
    const clicked = [];
    const driver = {
      async findElement(by) {
        return { click: async () => { clicked.push(String(by.value ?? by)); } };
      },
      async findElements() { return []; },
      actions() {
        return { move: () => ({ perform: async () => {} }), click: () => ({ perform: async () => { clicked.push("actions"); } }) };
      },
      async getCurrentUrl() { return "https://shop.test/"; },
      async executeScript() { return null; },
    };
    return { driver, clicked };
  }

  const deniedButtons = [
    { id: "logout-btn", text: "Logout" },
    { text: "Sign out" },
    { ariaLabel: "Delete account" },
    { text: "Place order" },
    { text: "Buy now" },
    { text: "Pay now" },
    { text: "Checkout" },
    { text: "Confirm" },
    { text: "Unsubscribe" },
    { text: "Close account" },
    { text: "Cancel account" },
  ];
  for (const fields of deniedButtons) {
    it(`never clicks a button described by ${JSON.stringify(fields)}`, async () => {
      const { driver, clicked } = recordingDriver();
      const { crawler } = build({}, { driver, ...homeWith([
        { tag: "button", locator: "button", intentScore: 80, intentReasons: [], navigates: true, text: "", ...fields },
      ]) });
      const result = await crawler.crawl();
      assert.deepEqual(clicked, [], "the button must not be clicked");
      assert.equal(result.crawlErrors.length, 0);
    });
  }

  it("still clicks an ordinary button", async () => {
    const { driver, clicked } = recordingDriver();
    const { crawler } = build({}, { driver, ...homeWith([
      { tag: "button", locator: "#more", id: "more", text: "Show more", intentScore: 80, intentReasons: [], navigates: true },
    ]) });
    await crawler.crawl();
    assert.ok(clicked.length > 0);
  });

  it("exposes the deny-list as one constant", () => {
    assert.ok(Array.isArray(CRAWL_DENY_LIST.always));
    assert.ok(Array.isArray(CRAWL_DENY_LIST.clickOnly));
    assert.ok(CRAWL_DENY_LIST.always.includes("logout"));
    assert.ok(CRAWL_DENY_LIST.clickOnly.includes("checkout"));
  });

  it("deniedReason separates following from clicking", () => {
    assert.equal(deniedReason(["/checkout"], "follow"), null);
    assert.equal(deniedReason(["Checkout"], "click"), "checkout");
    assert.equal(deniedReason(["/account/sign-out"], "follow"), "sign out");
    assert.equal(deniedReason(["Show more", undefined, ""], "click"), null);
  });
});
