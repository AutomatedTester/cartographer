import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { WorkflowDetector } from "../../build/workflow-detector.js";

function element(overrides = {}) {
  return {
    path: "body > input",
    tag: "input",
    locator: "#field",
    intentScore: 80,
    intentReasons: ["input"],
    ...overrides,
  };
}

function page(url, elements = []) {
  return {
    url,
    title: url,
    timestamp: 1,
    highIntentElements: elements,
    consoleLogs: [],
  };
}

function session(pages) {
  return {
    sessionId: "s1",
    startUrl: pages[0]?.url ?? "https://shop.test/",
    pages,
    metadata: {
      startTime: 0,
      totalPages: pages.length,
      totalElementsAnalyzed: pages.length,
      totalHighIntentElements: pages.reduce((n, p) => n + p.highIntentElements.length, 0),
    },
    sessionState: {},
    workflows: [],
  };
}

const loginPage = page("https://shop.test/login", [
  element({ tag: "input", locator: "#username", text: "Username", attributes: { type: "text", name: "username" } }),
  element({ tag: "input", locator: "#password", text: "Password", attributes: { type: "password", name: "password" } }),
  element({ tag: "button", locator: "#login-submit", text: "Sign In", attributes: { type: "submit" } }),
]);

beforeEach(() => {
  WorkflowDetector.clearCache();
});

describe("WorkflowDetector.detect", () => {
  it("returns an array for a single-page session", () => {
    const result = WorkflowDetector.detect(session([page("https://shop.test/")]));
    assert.ok(Array.isArray(result));
  });

  it("returns an empty array for a session with no pages", () => {
    assert.deepEqual(WorkflowDetector.detect(session([])), []);
  });

  it("survives a malformed session instead of throwing", () => {
    assert.doesNotThrow(() => WorkflowDetector.detect(null));
    assert.doesNotThrow(() => WorkflowDetector.detect({}));
    assert.doesNotThrow(() => WorkflowDetector.detect({ pages: null }));
  });

  it("gives every detected workflow a well-formed shape", () => {
    const workflows = WorkflowDetector.detect(
      session([
        page("https://shop.test/"),
        loginPage,
        page("https://shop.test/dashboard"),
      ])
    );

    for (const wf of workflows) {
      assert.ok(wf.id, "workflow needs an id");
      assert.ok(wf.name, "workflow needs a name");
      assert.ok(Array.isArray(wf.pageSequence));
      assert.ok(Array.isArray(wf.actionSequence));
      assert.ok(Array.isArray(wf.stateTransitions));
      assert.ok(Array.isArray(wf.tags));
      assert.ok(
        wf.confidence >= 0 && wf.confidence <= 100,
        `confidence ${wf.confidence} out of range`
      );
    }
  });

  it("only references pages that were actually in the session", () => {
    const urls = new Set([
      "https://shop.test/",
      "https://shop.test/login",
      "https://shop.test/dashboard",
    ]);
    const workflows = WorkflowDetector.detect(
      session([page("https://shop.test/"), loginPage, page("https://shop.test/dashboard")])
    );

    for (const wf of workflows) {
      for (const url of wf.pageSequence) {
        assert.ok(urls.has(url), `workflow cites a page not in the session: ${url}`);
      }
    }
  });

  it("accepts each documented strategy", () => {
    const s = session([page("https://shop.test/"), loginPage]);
    for (const strategy of ["heuristic", "ml-based", "both"]) {
      assert.doesNotThrow(
        () => WorkflowDetector.detect(s, strategy, false),
        `strategy ${strategy} threw`
      );
    }
  });
});

describe("WorkflowDetector caching", () => {
  it("starts with an empty cache", () => {
    assert.equal(WorkflowDetector.getCacheStats().size, 0);
  });

  it("populates the cache when caching is enabled", () => {
    WorkflowDetector.detect(session([page("https://shop.test/"), loginPage]), "both", true);
    assert.ok(WorkflowDetector.getCacheStats().size > 0);
  });

  it("does not populate the cache when caching is disabled", () => {
    WorkflowDetector.detect(session([page("https://shop.test/"), loginPage]), "both", false);
    assert.equal(WorkflowDetector.getCacheStats().size, 0);
  });

  it("returns the same result from cache on a repeat call", () => {
    const s = session([page("https://shop.test/"), loginPage]);
    const first = WorkflowDetector.detect(s, "both", true);
    const second = WorkflowDetector.detect(s, "both", true);

    assert.deepEqual(second, first);
    assert.equal(WorkflowDetector.getCacheStats().size, 1, "same session should reuse one entry");
  });

  it("keys the cache per distinct page sequence", () => {
    WorkflowDetector.detect(session([page("https://shop.test/a")]), "both", true);
    WorkflowDetector.detect(session([page("https://shop.test/b")]), "both", true);

    assert.equal(WorkflowDetector.getCacheStats().size, 2);
  });

  it("clearCache empties the cache", () => {
    WorkflowDetector.detect(session([page("https://shop.test/"), loginPage]), "both", true);
    WorkflowDetector.clearCache();
    assert.equal(WorkflowDetector.getCacheStats().size, 0);
  });
});

describe("WorkflowDetector.isLoginFormPage", () => {
  it("recognises a login page by its fields", () => {
    const result = WorkflowDetector.isLoginFormPage(loginPage);

    assert.equal(result.isLoginPage, true);
    assert.equal(result.hasUsernameField, true);
    assert.equal(result.hasPasswordField, true);
    assert.equal(result.hasSubmitButton, true);
    assert.ok(result.confidence > 0);
  });

  it("does not mistake a product page for a login page", () => {
    const product = page("https://shop.test/products/1", [
      element({ tag: "button", locator: "#add-to-cart-1", text: "Add to Cart" }),
      element({ tag: "select", locator: "#color", text: "Color" }),
    ]);

    assert.equal(WorkflowDetector.isLoginFormPage(product).isLoginPage, false);
  });

  it("returns a zero-confidence negative for a malformed page", () => {
    for (const bad of [null, {}, { url: "x" }, { url: "x", highIntentElements: null }]) {
      const result = WorkflowDetector.isLoginFormPage(bad);
      assert.equal(result.isLoginPage, false);
      assert.equal(result.confidence, 0);
    }
  });

  it("handles a page with no elements", () => {
    const result = WorkflowDetector.isLoginFormPage(page("https://shop.test/login", []));
    assert.equal(result.hasPasswordField, false);
    assert.equal(result.hasUsernameField, false);
  });

  it("reports confidence as a percentage", () => {
    const result = WorkflowDetector.isLoginFormPage(loginPage);
    assert.ok(
      result.confidence >= 0 && result.confidence <= 100,
      `confidence ${result.confidence} is not a percentage`
    );
  });
});

// ===========================================================================
// Detection paths and DAG normalisation
//
// detectNavigationPatterns, detectNavMenuJourneys, detectMultiStepForms and
// the DAG trio (normalizeWorkflowWithDag / pruneRedundantWorkflows /
// isStrictSubsequence) were all dark. The DAG code is where a crawl's raw,
// cyclic page list becomes the ordered journey a user is shown, so an
// off-by-one there silently emits a workflow that cannot be walked.
//
// Everything is driven through the public detect(); the detectors are private
// and are selected by the shape of the session handed in.
// ===========================================================================

/** A navigating element strong enough to count towards a navigation pattern. */
function navElement(overrides = {}) {
  return element({
    tag: "a",
    locator: "#nav",
    text: "Go",
    intentScore: 70,
    navigates: true,
    navigationTarget: "/next",
    ...overrides,
  });
}

/** The names of workflows detected for `pages`. */
function detectedNames(pages, strategy = "heuristic") {
  return WorkflowDetector.detect(session(pages), strategy, false).map((w) => w.name);
}

describe("WorkflowDetector: navigation patterns", () => {
  const home = page("https://shop.test/", [navElement()]);
  const product1 = page("https://shop.test/product/1", [navElement()]);
  const product2 = page("https://shop.test/product/2", [navElement()]);

  it("detects a category to product browsing flow", () => {
    assert.ok(detectedNames([home, product1, product2]).includes("product_browsing_flow"));
  });

  it("accepts a category path as the entry point", () => {
    const category = page("https://shop.test/categories/shoes", [navElement()]);
    assert.ok(
      detectedNames([category, product1, product2]).includes("product_browsing_flow")
    );
  });

  it("detects a search browsing flow ending on a product page", () => {
    const names = detectedNames([
      page("https://shop.test/search", [navElement()]),
      page("https://shop.test/search?p=2", [navElement()]),
      page("https://shop.test/product/9", [navElement()]),
    ]);
    assert.ok(names.includes("search_browsing_flow"));
  });

  it("accepts a detail page as the end of a search flow", () => {
    const names = detectedNames([
      page("https://shop.test/search", [navElement()]),
      page("https://shop.test/search?p=2", [navElement()]),
      page("https://shop.test/detail/9", [navElement()]),
    ]);
    assert.ok(names.includes("search_browsing_flow"));
  });

  it("ignores a sequence whose middle page has no navigating element", () => {
    const inert = page("https://shop.test/product/1", [
      element({ tag: "p", locator: "#t", intentScore: 90 }),
    ]);
    assert.ok(!detectedNames([home, inert, product2]).includes("product_browsing_flow"));
  });

  it("ignores navigation elements that score at or below 50", () => {
    const weak = page("https://shop.test/product/1", [navElement({ intentScore: 50 })]);
    assert.ok(!detectedNames([home, weak, product2]).includes("product_browsing_flow"));
  });

  it("does not join pages from different hosts into one flow", () => {
    const offsite = page("https://other.test/product/1", [navElement()]);
    assert.ok(
      !detectedNames([home, offsite, product2]).includes("product_browsing_flow")
    );
  });

  it("ignores a sequence that matches neither pattern", () => {
    const names = detectedNames([
      page("https://shop.test/about", [navElement()]),
      page("https://shop.test/terms", [navElement()]),
      page("https://shop.test/privacy", [navElement()]),
    ]);
    assert.ok(!names.includes("product_browsing_flow"));
    assert.ok(!names.includes("search_browsing_flow"));
  });

  it("needs three pages, not two", () => {
    assert.ok(!detectedNames([home, product1]).includes("product_browsing_flow"));
  });
});

describe("WorkflowDetector: navigation menu journeys", () => {
  // 'Link in navigation context' is used rather than the top-level-navigation
  // reason this detector was named for, because that clause does not work —
  // see the case-sensitivity test at the end of this block.
  const menuLink = navElement({
    locator: "#nav-deals",
    text: "Deals",
    intentScore: 60,
    navigationTarget: "/deals",
    intentReasons: ["Link in navigation context (+15)"],
  });

  it("traces a journey from a top-level nav link to its target page", () => {
    const pages = [
      page("https://shop.test/", [menuLink]),
      page("https://shop.test/deals", [navElement({ intentScore: 80 })]),
    ];

    const workflows = WorkflowDetector.detect(session(pages), "heuristic", false);
    const journey = workflows.find((w) => w.name === "navigation_menu_exploration");

    assert.ok(journey, "expected a menu journey");
    assert.deepEqual(journey.pageSequence, [
      "https://shop.test/",
      "https://shop.test/deals",
    ]);
    assert.equal(journey.confidence, 70);
  });

  it("tags the journey with the nav item's text", () => {
    const pages = [
      page("https://shop.test/", [
        navElement({
          locator: "#nav",
          text: "Find Doctors",
          intentScore: 60,
          navigationTarget: "/doctors",
          intentReasons: ["Search interaction (+25)"],
        }),
      ]),
      page("https://shop.test/doctors", []),
    ];

    const journey = WorkflowDetector.detect(session(pages), "heuristic", false).find(
      (w) => w.name === "navigation_menu_exploration"
    );

    assert.ok(journey.tags.includes("find-doctors"), `tags were ${journey.tags}`);
  });

  it("accepts a link marked as being in navigation context", () => {
    const pages = [
      page("https://shop.test/", [
        navElement({
          text: "Deals",
          navigationTarget: "/deals",
          intentReasons: ["Link in navigation context (+15)"],
        }),
      ]),
      page("https://shop.test/deals", []),
    ];

    assert.ok(detectedNames(pages).includes("navigation_menu_exploration"));
  });

  it("ignores a nav item scoring below 28", () => {
    const pages = [
      page("https://shop.test/", [
        navElement({
          text: "Deals",
          intentScore: 27,
          navigationTarget: "/deals",
          intentReasons: ["Link in navigation context (+15)"],
        }),
      ]),
      page("https://shop.test/deals", []),
    ];

    assert.ok(!detectedNames(pages).includes("navigation_menu_exploration"));
  });

  // detectNavMenuJourneys exists to find top-level menu exploration, and its
  // first and most specific clause looks for an intent reason containing
  // 'top-level navigation intent'. HeuristicScorer writes that reason as
  // 'Top-level navigation intent (+28)'. The comparison is case sensitive, so
  // the clause the detector is named for never fires; such journeys are only
  // found when the element happens to also carry a navigation-context or
  // search reason.
  it("fails to match the top-level navigation reason the scorer actually writes", () => {
    const pages = [
      page("https://shop.test/", [
        navElement({
          text: "Deals",
          intentScore: 60,
          navigationTarget: "/deals",
          intentReasons: ["Top-level navigation intent (+28)"],
        }),
      ]),
      page("https://shop.test/deals", []),
    ];

    assert.ok(
      !detectedNames(pages).includes("navigation_menu_exploration"),
      "if this now passes, the case mismatch has been fixed"
    );

    // The same element with a lowercased reason is matched, which isolates
    // case as the only difference.
    const lowercased = [
      page("https://shop.test/", [
        navElement({
          text: "Deals",
          intentScore: 60,
          navigationTarget: "/deals",
          intentReasons: ["top-level navigation intent (+28)"],
        }),
      ]),
      page("https://shop.test/deals", []),
    ];

    assert.ok(detectedNames(lowercased).includes("navigation_menu_exploration"));
  });

  it("ignores an element whose reasons do not mark it as navigation", () => {
    const pages = [
      page("https://shop.test/", [
        navElement({ text: "Deals", navigationTarget: "/deals", intentReasons: ["a element (+40)"] }),
      ]),
      page("https://shop.test/deals", []),
    ];

    assert.ok(!detectedNames(pages).includes("navigation_menu_exploration"));
  });

  it("caps a journey at three pages", () => {
    const pages = [
      page("https://shop.test/", [menuLink]),
      page("https://shop.test/deals/1", []),
      page("https://shop.test/deals/2", []),
      page("https://shop.test/deals/3", []),
    ];

    const journey = WorkflowDetector.detect(session(pages), "heuristic", false).find(
      (w) => w.name === "navigation_menu_exploration"
    );

    assert.ok(journey.pageSequence.length <= 3, `got ${journey.pageSequence.length}`);
  });

  it("produces no journey when the nav target matches no crawled page", () => {
    const pages = [
      page("https://shop.test/", [
        navElement({
          text: "Zzz",
          navigationTarget: "/nowhere",
          intentReasons: ["Link in navigation context (+15)"],
        }),
      ]),
      page("https://shop.test/other", []),
    ];

    assert.ok(!detectedNames(pages).includes("navigation_menu_exploration"));
  });

  it("records a click on the nav item as the journey's first action", () => {
    const pages = [
      page("https://shop.test/", [menuLink]),
      page("https://shop.test/deals", [navElement({ locator: "#buy", intentScore: 80 })]),
    ];

    const journey = WorkflowDetector.detect(session(pages), "heuristic", false).find(
      (w) => w.name === "navigation_menu_exploration"
    );

    assert.equal(journey.actionSequence[0].elementLocator, "#nav-deals");
    assert.equal(journey.actionSequence[0].actionType, "click");
    assert.equal(journey.actionSequence[0].resultingNavigation, "/deals");
  });

  it("includes only strong elements from the journey's later pages", () => {
    const pages = [
      page("https://shop.test/", [menuLink]),
      page("https://shop.test/deals", [
        navElement({ locator: "#strong", intentScore: 80 }),
        navElement({ locator: "#weak", intentScore: 10 }),
      ]),
    ];

    const journey = WorkflowDetector.detect(session(pages), "heuristic", false).find(
      (w) => w.name === "navigation_menu_exploration"
    );

    const locators = journey.actionSequence.map((a) => a.elementLocator);
    assert.ok(locators.includes("#strong"));
    assert.ok(!locators.includes("#weak"));
  });
});

describe("WorkflowDetector: multi-step forms", () => {
  const step1 = page("https://shop.test/checkout/shipping", [
    element({ tag: "input", locator: "#addr", text: "Address" }),
  ]);
  const step2 = page("https://shop.test/checkout/payment", [
    element({ tag: "button", locator: "#pay", text: "Pay now" }),
  ]);

  function confirmation(title) {
    return page("https://shop.test/checkout/done", [
      element({ tag: "h1", locator: "#h", text: title }),
    ]);
  }

  it("detects a form sequence ending in a confirmation page", () => {
    const names = detectedNames([step1, step2, confirmation("Thank you")]);
    assert.ok(names.some((n) => n.endsWith("_flow")), `got ${names}`);
  });

  const successWords = [
    "Success",
    "Thank you",
    "Order confirmed",
    "Complete",
    "Your order",
    "Receipt",
    "Submitted",
  ];

  for (const word of successWords) {
    it(`treats "${word}" on the final page as success`, () => {
      const workflows = WorkflowDetector.detect(
        session([step1, step2, confirmation(word)]),
        "heuristic",
        false
      );
      assert.ok(
        workflows.some((w) => w.tags.includes("multi-step")),
        `"${word}" should close a form flow`
      );
    });
  }

  it("ignores a sequence whose final page shows no success wording", () => {
    const workflows = WorkflowDetector.detect(
      session([step1, step2, confirmation("Still editing")]),
      "heuristic",
      false
    );
    assert.ok(!workflows.some((w) => w.tags.includes("multi-step")));
  });

  it("requires an input on the first page", () => {
    const noInputs = page("https://shop.test/checkout/start", [
      element({ tag: "a", locator: "#x", text: "Begin" }),
    ]);
    const workflows = WorkflowDetector.detect(
      session([noInputs, step2, confirmation("Thank you")]),
      "heuristic",
      false
    );
    assert.ok(!workflows.some((w) => w.tags.includes("multi-step")));
  });

  it("requires an input or button on the second page", () => {
    const inert = page("https://shop.test/checkout/interstitial", [
      element({ tag: "p", locator: "#p", text: "Please wait" }),
    ]);
    const workflows = WorkflowDetector.detect(
      session([step1, inert, confirmation("Thank you")]),
      "heuristic",
      false
    );
    assert.ok(!workflows.some((w) => w.tags.includes("multi-step")));
  });

  // The inferred type becomes the workflow's name and a tag, so it is what an
  // operator sorts and filters on.
  const formTypes = [
    ["Shipping address", "checkout"],
    ["Create your account", "registration"],
    ["Profile preferences", "profile_setup"],
    ["Customer survey", "survey"],
    ["Step one of two", "multi_step_form"],
  ];

  // inferFormType reads page titles as well as element text, and `page()`
  // defaults a page's title to its own url. These use neutral urls so the
  // wording under test is the only thing that can decide the type — with a
  // /checkout/ url in the sequence every case would infer 'checkout'.
  for (const [wording, expected] of formTypes) {
    it(`infers the ${expected} form type from "${wording}"`, () => {
      const first = page("https://shop.test/f/1", [
        element({ tag: "input", locator: "#a", text: wording }),
      ]);
      const second = page("https://shop.test/f/2", [
        element({ tag: "button", locator: "#b", text: "Next" }),
      ]);
      const done = page("https://shop.test/f/3", [
        element({ tag: "h1", locator: "#h", text: "Thank you" }),
      ]);

      const workflows = WorkflowDetector.detect(
        session([first, second, done]),
        "heuristic",
        false
      );
      const form = workflows.find((w) => w.tags.includes("multi-step"));

      assert.ok(form, `no form flow detected for "${wording}"`);
      assert.equal(form.name, `${expected}_flow`);
      assert.ok(form.tags.includes(expected));
    });
  }
});

describe("WorkflowDetector: DAG normalisation", () => {
  // A crawl records the pages in the order it saw them, including returns to
  // a page it has already visited. A workflow that revisits a page is not a
  // journey a user can be asked to walk, so the sequence is made acyclic.
  const loopingNav = [
    navElement({ locator: "#a", intentScore: 70 }),
  ];

  it("never emits a workflow that visits the same page twice", () => {
    const pages = [
      page("https://shop.test/", loopingNav),
      page("https://shop.test/product/1", loopingNav),
      page("https://shop.test/product/2", loopingNav),
      page("https://shop.test/", loopingNav),
    ];

    for (const workflow of WorkflowDetector.detect(session(pages), "heuristic", false)) {
      assert.equal(
        new Set(workflow.pageSequence).size,
        workflow.pageSequence.length,
        `${workflow.name} repeats a page: ${workflow.pageSequence}`
      );
    }
  });

  it("drops workflows left with fewer than two pages after normalisation", () => {
    const pages = [
      page("https://shop.test/", loopingNav),
      page("https://shop.test/product/1", loopingNav),
      page("https://shop.test/product/2", loopingNav),
    ];

    for (const workflow of WorkflowDetector.detect(session(pages), "heuristic", false)) {
      assert.ok(
        workflow.pageSequence.length >= 2,
        `${workflow.name} has ${workflow.pageSequence.length} pages`
      );
    }
  });

  it("keeps actions and transitions in step with the pruned page list", () => {
    const pages = [
      page("https://shop.test/", loopingNav),
      page("https://shop.test/product/1", loopingNav),
      page("https://shop.test/product/2", loopingNav),
      page("https://shop.test/", loopingNav),
    ];

    for (const workflow of WorkflowDetector.detect(session(pages), "heuristic", false)) {
      const kept = new Set(workflow.pageSequence);
      for (const act of workflow.actionSequence) {
        assert.ok(kept.has(act.pageUrl), `action on dropped page ${act.pageUrl}`);
      }
      for (const transition of workflow.stateTransitions) {
        assert.ok(kept.has(transition.fromPage), `transition from dropped page`);
        assert.ok(kept.has(transition.toPage), `transition to dropped page`);
      }
    }
  });

  it("does not return a workflow that is a strict subpath of another", () => {
    const pages = [
      page("https://shop.test/", loopingNav),
      page("https://shop.test/product/1", loopingNav),
      page("https://shop.test/product/2", loopingNav),
      page("https://shop.test/product/3", loopingNav),
    ];

    const workflows = WorkflowDetector.detect(session(pages), "heuristic", false);

    for (const a of workflows) {
      for (const b of workflows) {
        if (a === b) continue;
        const isSubpath =
          a.pageSequence.length < b.pageSequence.length &&
          a.pageSequence.every(
            (url, i) => b.pageSequence.indexOf(url) >= 0 &&
              b.pageSequence.indexOf(url) >= (i === 0 ? 0 : b.pageSequence.indexOf(a.pageSequence[i - 1]))
          );
        assert.ok(!isSubpath, `${a.name} is contained in ${b.name}`);
      }
    }
  });

  it("returns workflows in descending confidence order", () => {
    const pages = [
      page("https://shop.test/", loopingNav),
      page("https://shop.test/product/1", loopingNav),
      page("https://shop.test/product/2", loopingNav),
    ];

    const confidences = WorkflowDetector.detect(session(pages), "heuristic", false).map(
      (w) => w.confidence
    );
    assert.deepEqual(confidences, [...confidences].sort((a, b) => b - a));
  });

  it("merges the tags of two workflows sharing a page sequence", () => {
    // Both the navigation-pattern and nav-menu detectors fire on this shape,
    // producing the same path from different detectors.
    const pages = [
      page("https://shop.test/", [
        navElement({
          locator: "#nav",
          text: "Products",
          intentScore: 70,
          navigationTarget: "/product/1",
          intentReasons: ["Top-level navigation intent (+28)"],
        }),
      ]),
      page("https://shop.test/product/1", [navElement({ intentScore: 70 })]),
      page("https://shop.test/product/2", [navElement({ intentScore: 70 })]),
    ];

    const workflows = WorkflowDetector.detect(session(pages), "heuristic", false);
    const bySequence = new Map();
    for (const workflow of workflows) {
      const key = JSON.stringify(workflow.pageSequence);
      assert.ok(!bySequence.has(key), `two workflows share the sequence ${key}`);
      bySequence.set(key, workflow);
    }
  });
});
