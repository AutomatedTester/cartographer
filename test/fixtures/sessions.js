/**
 * Builders for CrawlSession / CrawledPage / HighIntentElement shapes.
 *
 * Several suites need a session to hand to a detector, and each was growing
 * its own near-identical trio of helpers. One vocabulary means a change to the
 * session shape is a change in one place, and means two suites describing the
 * same page describe it the same way.
 *
 * These are deliberately minimal: only the fields the consumers actually read,
 * so a test states the thing it depends on rather than burying it in noise.
 */

/**
 * A high-intent element.
 *
 * @param {object} [overrides] any HighIntentElement field
 */
export function element(overrides = {}) {
  return {
    path: "body > input",
    tag: "input",
    locator: "#field",
    intentScore: 80,
    intentReasons: ["input"],
    ...overrides,
  };
}

/**
 * A crawled page.
 *
 * @param {string} url
 * @param {object[]} [elements]
 */
export function page(url, elements = []) {
  return {
    url,
    title: url,
    timestamp: 1,
    highIntentElements: elements,
    consoleLogs: [],
  };
}

/**
 * A crawl session wrapping the given pages, with consistent metadata.
 *
 * @param {object[]} pages
 */
export function session(pages) {
  return {
    sessionId: "s1",
    startUrl: pages[0]?.url ?? "https://shop.test/",
    pages,
    metadata: {
      startTime: 0,
      totalPages: pages.length,
      totalElementsAnalyzed: pages.length,
      totalHighIntentElements: pages.reduce(
        (n, p) => n + (p.highIntentElements?.length ?? 0),
        0
      ),
    },
    sessionState: {},
    workflows: [],
  };
}

/** A link element that navigates to `target`. */
export function link(locator, text, target) {
  return element({
    tag: "a",
    locator,
    text,
    navigates: true,
    navigationTarget: target,
  });
}

/** A text input carrying `name`. */
export function input(locator, text, type = "text") {
  return element({
    tag: "input",
    locator,
    text,
    attributes: { type, name: text.toLowerCase().replace(/\s+/g, "") },
  });
}

/** A submit button. */
export function submit(locator, text) {
  return element({
    tag: "button",
    locator,
    text,
    attributes: { type: "submit" },
  });
}
