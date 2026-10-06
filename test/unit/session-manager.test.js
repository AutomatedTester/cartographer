import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SessionManager } from "../../build/session-manager.js";

const config = { startUrl: "https://shop.test/", maxPages: 10, maxDepth: 3 };

function page(url, elements = []) {
  return {
    url,
    title: url,
    timestamp: 1,
    highIntentElements: elements,
    consoleLogs: [],
  };
}

describe("SessionManager identity", () => {
  it("generates a session id when none is supplied", () => {
    const mgr = new SessionManager(config.startUrl, config);
    assert.ok(mgr.getSessionId().length > 0);
  });

  it("uses a supplied session id", () => {
    const mgr = new SessionManager(config.startUrl, config, "fixed-id");
    assert.equal(mgr.getSessionId(), "fixed-id");
  });

  it("gives two sessions different ids", () => {
    const a = new SessionManager(config.startUrl, config);
    const b = new SessionManager(config.startUrl, config);
    assert.notEqual(a.getSessionId(), b.getSessionId());
  });

  it("records the start url on the session", () => {
    const mgr = new SessionManager(config.startUrl, config);
    assert.equal(mgr.getSession().startUrl, config.startUrl);
  });
});

describe("SessionManager page tracking", () => {
  it("accumulates added pages", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/a"));
    mgr.addPage(page("https://shop.test/b"));

    assert.equal(mgr.getSession().pages.length, 2);
  });

  it("looks a page up by url", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/cart"));

    assert.equal(mgr.getPageByUrl("https://shop.test/cart").url, "https://shop.test/cart");
    assert.equal(mgr.getPageByUrl("https://shop.test/missing"), undefined);
  });

  it("tallies analysed and high-intent elements in metadata", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/a", [{ locator: "#a", intentScore: 90 }]));
    mgr.addPage(page("https://shop.test/b", [
      { locator: "#b", intentScore: 80 },
      { locator: "#c", intentScore: 70 },
    ]));

    const { metadata } = mgr.getSession();
    assert.equal(metadata.totalPages, 2);
    assert.equal(metadata.totalHighIntentElements, 3);
  });
});

describe("SessionManager visit tracking", () => {
  it("reports a url as unvisited until marked", () => {
    const mgr = new SessionManager(config.startUrl, config);
    assert.equal(mgr.isVisited("https://shop.test/x"), false);

    mgr.markAsVisited("https://shop.test/x");
    assert.equal(mgr.isVisited("https://shop.test/x"), true);
  });

  it("is idempotent when marking the same url twice", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.markAsVisited("https://shop.test/x");
    mgr.markAsVisited("https://shop.test/x");
    assert.equal(mgr.isVisited("https://shop.test/x"), true);
  });

  it("surfaces discovered links that have not been visited", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/"));
    mgr.recordNavigation("https://shop.test/", [
      "https://shop.test/products",
      "https://shop.test/cart",
    ]);

    const unvisited = mgr.getUnvisitedLinks();
    assert.ok(unvisited.includes("https://shop.test/products"));
    assert.ok(unvisited.includes("https://shop.test/cart"));
  });

  it("drops links from the unvisited set once they are visited", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/"));
    mgr.recordNavigation("https://shop.test/", [
      "https://shop.test/products",
      "https://shop.test/cart",
    ]);
    mgr.markAsVisited("https://shop.test/products");

    const unvisited = mgr.getUnvisitedLinks();
    assert.ok(!unvisited.includes("https://shop.test/products"));
    assert.ok(unvisited.includes("https://shop.test/cart"));
  });

  it("de-duplicates a link discovered from two different pages", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/a"));
    mgr.addPage(page("https://shop.test/b"));
    mgr.recordNavigation("https://shop.test/a", ["https://shop.test/cart"]);
    mgr.recordNavigation("https://shop.test/b", ["https://shop.test/cart"]);

    const unvisited = mgr.getUnvisitedLinks();
    assert.equal(
      unvisited.filter((u) => u === "https://shop.test/cart").length,
      1
    );
  });

  it("only reports links whose source page was added to the session", () => {
    // getUnvisitedLinks() walks session.pages, so navigation recorded for a
    // page that was never added is invisible. MultiPageCrawler relies on this
    // ordering (addPage before the links are consumed); a caller that records
    // navigation without adding the page gets silence, not an error.
    const mgr = new SessionManager(config.startUrl, config);
    mgr.recordNavigation("https://shop.test/never-added", [
      "https://shop.test/orphan",
    ]);

    assert.deepEqual(mgr.getUnvisitedLinks(), []);
  });
});

describe("SessionManager state bag", () => {
  it("starts empty", () => {
    assert.deepEqual(new SessionManager(config.startUrl, config).getState(), {});
  });

  it("stores and overwrites values", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.updateState("authToken", "abc");
    assert.equal(mgr.getState().authToken, "abc");

    mgr.updateState("authToken", "def");
    assert.equal(mgr.getState().authToken, "def");
  });

  it("keeps independent state per session", () => {
    const a = new SessionManager(config.startUrl, config);
    const b = new SessionManager(config.startUrl, config);
    a.updateState("k", 1);

    assert.equal(b.getState().k, undefined);
  });
});

describe("SessionManager finalize", () => {
  it("stamps an end time and the final page count", async () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/a"));

    const session = await mgr.finalize();

    assert.ok(session.metadata.endTime >= session.metadata.startTime);
    assert.equal(session.metadata.totalPages, 1);
  });
});

describe("SessionManager serialisation", () => {
  it("round-trips through JSON preserving pages and state", () => {
    const mgr = new SessionManager(config.startUrl, config, "round-trip");
    mgr.addPage(page("https://shop.test/a", [{ locator: "#a", intentScore: 90 }]));
    mgr.updateState("authToken", "abc");
    mgr.markAsVisited("https://shop.test/a");

    const restored = SessionManager.fromJSON(mgr.toJSON(), config);

    assert.equal(restored.getSessionId(), "round-trip");
    assert.equal(restored.getSession().pages.length, 1);
    assert.equal(restored.getState().authToken, "abc");
    assert.equal(restored.getPageByUrl("https://shop.test/a").url, "https://shop.test/a");
  });

  it("emits parseable JSON", () => {
    const mgr = new SessionManager(config.startUrl, config);
    mgr.addPage(page("https://shop.test/a"));
    assert.doesNotThrow(() => JSON.parse(mgr.toJSON()));
  });
});
