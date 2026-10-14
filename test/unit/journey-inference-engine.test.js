/**
 * JourneyInferenceEngine: journeys inferred from element semantics + URL shape.
 *
 * 590 lines that had no test at all. This is the component that decides what a
 * site is *for* when no formal workflow is detectable, so a silent regression
 * here does not crash anything — it just makes the tool report fewer, or
 * wrong, user journeys, which is indistinguishable from "the site is simple".
 *
 * Everything is driven through the public inferJourneys(). The indicator
 * predicates are private and keyword-shaped; pinning them directly would make
 * every keyword edit a test edit. Instead each rule is proven by the journey it
 * unlocks, with a matched control case that withholds the keyword.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { JourneyInferenceEngine } from "../../build/journey-inference-engine.js";
import { element, page, session } from "../fixtures/sessions.js";

const HOME = "https://shop.test/";

/** Names of the journeys inferred from `pages`, sorted for stable comparison. */
function journeyNames(pages) {
  return JourneyInferenceEngine.inferJourneys(session(pages))
    .map((j) => j.name)
    .sort();
}

/** The single journey named `name`, or undefined. */
function journey(pages, name) {
  return JourneyInferenceEngine.inferJourneys(session(pages)).find(
    (j) => j.name === name
  );
}

/** An element whose only job is to carry `text`. */
function withText(text, overrides = {}) {
  return element({ tag: "button", locator: "#el", text, ...overrides });
}

// A product signal that is deliberately NOT a checkout signal: className
// carries 'product', the text says nothing about carts. Keeps the two
// journeys independently controllable.
const productSignal = element({
  tag: "div",
  locator: ".card",
  text: "Laptop Pro 15",
  attributes: { class: "product-card" },
});

const searchSignal = withText("Search");
const navSignal = withText("Browse");

describe("JourneyInferenceEngine.inferJourneys: malformed input", () => {
  it("returns an empty array rather than throwing on a null session", () => {
    assert.deepEqual(JourneyInferenceEngine.inferJourneys(null), []);
  });

  it("returns an empty array when pages is absent or not an array", () => {
    assert.deepEqual(JourneyInferenceEngine.inferJourneys({}), []);
    assert.deepEqual(JourneyInferenceEngine.inferJourneys({ pages: null }), []);
    assert.deepEqual(
      JourneyInferenceEngine.inferJourneys({ pages: "not-an-array" }),
      []
    );
  });

  it("returns an empty array for a session with no pages", () => {
    assert.deepEqual(JourneyInferenceEngine.inferJourneys(session([])), []);
  });

  it("skips pages whose element list is missing or malformed", () => {
    const pages = [
      { url: HOME, title: "", timestamp: 1, consoleLogs: [] },
      page("https://shop.test/a", null),
      { url: "https://shop.test/b", highIntentElements: "nope" },
    ];
    assert.doesNotThrow(() => JourneyInferenceEngine.inferJourneys(session(pages)));
  });

  it("skips null entries inside an element list", () => {
    const pages = [page(HOME, [null, productSignal, null, searchSignal])];
    assert.deepEqual(journeyNames(pages), ["Product Discovery & Browse"]);
  });

  it("skips pages with no url rather than throwing", () => {
    const pages = [
      page(HOME, [productSignal, searchSignal]),
      { title: "no url", timestamp: 1, highIntentElements: [], consoleLogs: [] },
    ];
    assert.deepEqual(journeyNames(pages), ["Product Discovery & Browse"]);
  });

  // Documents a real weakness rather than asserting it is correct: page URLs
  // are parsed with `new URL()` outside any per-page guard, so one unparseable
  // URL discards the journeys inferred from every *other* page in the crawl.
  // The contract that holds is only "does not throw".
  it("does not throw when a page url is unparseable", () => {
    const pages = [
      page(HOME, [productSignal, searchSignal]),
      page("not-a-url", []),
    ];
    assert.doesNotThrow(() => JourneyInferenceEngine.inferJourneys(session(pages)));
  });
});

describe("JourneyInferenceEngine: Product Discovery", () => {
  const NAME = "Product Discovery & Browse";

  it("is inferred from products + search + a homepage", () => {
    assert.ok(journeyNames([page(HOME, [productSignal, searchSignal])]).includes(NAME));
  });

  it("is inferred from products + navigation, with no search at all", () => {
    assert.ok(journeyNames([page(HOME, [productSignal, navSignal])]).includes(NAME));
  });

  it("is not inferred from products alone", () => {
    assert.ok(!journeyNames([page(HOME, [productSignal])]).includes(NAME));
  });

  it("is not inferred without products, however much searching there is", () => {
    assert.ok(!journeyNames([page(HOME, [searchSignal, navSignal])]).includes(NAME));
  });

  it("is not inferred when neither a homepage nor a search page was crawled", () => {
    const pages = [page("https://shop.test/about", [productSignal, searchSignal])];
    assert.ok(!journeyNames(pages).includes(NAME));
  });

  it("is inferred from a search results page when no homepage was crawled", () => {
    const pages = [
      page("https://shop.test/search?q=laptop", [productSignal, searchSignal]),
    ];
    assert.ok(journeyNames(pages).includes(NAME));
  });

  it("sequences homepage, then search pages, then product pages", () => {
    const pages = [
      page("https://shop.test/products/2", [productSignal]),
      page(HOME, [productSignal, searchSignal]),
      page("https://shop.test/search", [searchSignal]),
    ];
    assert.deepEqual(journey(pages, NAME).pageSequence, [
      HOME,
      "https://shop.test/search",
      "https://shop.test/products/2",
    ]);
  });

  it("caps the sequence at two search and two product pages", () => {
    const pages = [
      page(HOME, [productSignal, searchSignal]),
      ...[1, 2, 3].map((n) => page(`https://shop.test/search/${n}`, [])),
      ...[1, 2, 3].map((n) => page(`https://shop.test/product/${n}`, [])),
    ];
    const sequence = journey(pages, NAME).pageSequence;
    assert.equal(sequence.filter((u) => u.includes("/search/")).length, 2);
    assert.equal(sequence.filter((u) => u.includes("/product/")).length, 2);
  });

  it("de-duplicates a url that is both a search and a product page", () => {
    const pages = [
      page(HOME, [productSignal, searchSignal]),
      page("https://shop.test/search/product", []),
    ];
    const sequence = journey(pages, NAME).pageSequence;
    assert.equal(new Set(sequence).size, sequence.length);
  });

  it("reports confidence 85 and the documented tags", () => {
    const found = journey([page(HOME, [productSignal, searchSignal])], NAME);
    assert.equal(found.confidence, 85);
    assert.deepEqual(found.tags, ["product", "discovery", "navigation", "search"]);
    assert.match(found.id, /^journey_product_discovery_\d+$/);
  });
});

describe("JourneyInferenceEngine: Shopping & Checkout", () => {
  const NAME = "Shopping & Checkout";
  const checkoutSignal = withText("Proceed");

  it("is inferred from products + checkout signals", () => {
    assert.ok(
      journeyNames([page(HOME, [productSignal, checkoutSignal])]).includes(NAME)
    );
  });

  it("is inferred even when no cart or checkout page was crawled", () => {
    const found = journey([page(HOME, [productSignal, checkoutSignal])], NAME);
    assert.ok(found, "checkout intent on a product page is enough");
    assert.deepEqual(found.pageSequence, []);
  });

  it("is not inferred from checkout signals without products", () => {
    assert.ok(!journeyNames([page(HOME, [checkoutSignal])]).includes(NAME));
  });

  it("sequences product, then cart, then checkout", () => {
    const pages = [
      page("https://shop.test/checkout", []),
      page("https://shop.test/product/1", [productSignal, checkoutSignal]),
      page("https://shop.test/cart", []),
    ];
    assert.deepEqual(journey(pages, NAME).pageSequence, [
      "https://shop.test/product/1",
      "https://shop.test/cart",
      "https://shop.test/checkout",
    ]);
  });

  it("labels url patterns 'cart' when a cart page exists and 'checkout' otherwise", () => {
    const base = page("https://shop.test/product/1", [productSignal, checkoutSignal]);

    assert.deepEqual(
      journey([base, page("https://shop.test/cart", [])], NAME).signals.urlPatterns,
      ["products", "cart"]
    );
    assert.deepEqual(journey([base], NAME).signals.urlPatterns, [
      "products",
      "checkout",
    ]);
  });

  it("reports confidence 80 and the documented tags", () => {
    const found = journey([page(HOME, [productSignal, checkoutSignal])], NAME);
    assert.equal(found.confidence, 80);
    assert.deepEqual(found.tags, ["ecommerce", "checkout", "payment", "cart"]);
  });
});

describe("JourneyInferenceEngine: Account Management", () => {
  const NAME = "Account Management";
  const accountSignal = withText("My Account");

  it("is inferred from an account signal plus an account page", () => {
    const pages = [page("https://shop.test/account", [accountSignal])];
    assert.ok(journeyNames(pages).includes(NAME));
  });

  it("is inferred from an orders page when no account page was crawled", () => {
    const pages = [page("https://shop.test/orders", [accountSignal])];
    assert.ok(journeyNames(pages).includes(NAME));
  });

  it("is not inferred from an account signal with no account or orders page", () => {
    assert.ok(!journeyNames([page(HOME, [accountSignal])]).includes(NAME));
  });

  it("is not inferred from an account page with no account signal", () => {
    const pages = [page("https://shop.test/account", [withText("Hello")])];
    assert.ok(!journeyNames(pages).includes(NAME));
  });

  // The login -> dashboard path is the most common account journey there is,
  // and matching only 'account'/'profile' used to miss it entirely.
  for (const path of [
    "login",
    "signin",
    "sign-in",
    "register",
    "signup",
    "sign-up",
    "dashboard",
    "profile",
    "user",
    "settings",
  ]) {
    it(`counts /${path} as an account page`, () => {
      const pages = [page(`https://shop.test/${path}`, [accountSignal])];
      assert.ok(journeyNames(pages).includes(NAME), `/${path} should qualify`);
    });
  }

  for (const path of ["orders", "order-history", "my-orders"]) {
    it(`counts /${path} as an orders page`, () => {
      const pages = [page(`https://shop.test/${path}`, [accountSignal])];
      assert.ok(journeyNames(pages).includes(NAME), `/${path} should qualify`);
    });
  }

  // Credential-entry wording is the clearest account signal a page carries.
  for (const text of [
    "Sign In",
    "Sign Up",
    "Log In",
    "Log Out",
    "Register",
    "Username",
    "Password",
    "Email Address",
    "Dashboard",
    "Preferences",
  ]) {
    it(`treats "${text}" as an account signal`, () => {
      const pages = [page("https://shop.test/account", [withText(text)])];
      assert.ok(journeyNames(pages).includes(NAME), `"${text}" should qualify`);
    });
  }

  it("sequences account page then orders page", () => {
    const pages = [
      page("https://shop.test/orders", [accountSignal]),
      page("https://shop.test/account", [accountSignal]),
    ];
    assert.deepEqual(journey(pages, NAME).pageSequence, [
      "https://shop.test/account",
      "https://shop.test/orders",
    ]);
  });

  it("labels url patterns 'orders' when an orders page exists and 'profile' otherwise", () => {
    const withOrders = [
      page("https://shop.test/account", [accountSignal]),
      page("https://shop.test/orders", []),
    ];
    assert.deepEqual(journey(withOrders, NAME).signals.urlPatterns, [
      "account",
      "orders",
    ]);

    const withoutOrders = [page("https://shop.test/account", [accountSignal])];
    assert.deepEqual(journey(withoutOrders, NAME).signals.urlPatterns, [
      "account",
      "profile",
    ]);
  });

  it("reports confidence 75 and the documented tags", () => {
    const found = journey([page("https://shop.test/account", [accountSignal])], NAME);
    assert.equal(found.confidence, 75);
    assert.deepEqual(found.tags, ["account", "user", "orders", "management"]);
  });
});

describe("JourneyInferenceEngine: Deal & Offer Exploration", () => {
  const NAME = "Deal & Offer Exploration";
  const dealSignal = withText("Special offer");

  it("is inferred from a deal signal plus an offers page", () => {
    const pages = [page("https://shop.test/offers", [dealSignal])];
    assert.ok(journeyNames(pages).includes(NAME));
  });

  it("is not inferred from a deal signal with no offers page", () => {
    assert.ok(!journeyNames([page(HOME, [dealSignal])]).includes(NAME));
  });

  it("is not inferred from an offers page with no deal signal", () => {
    const pages = [page("https://shop.test/offers", [withText("Hello")])];
    assert.ok(!journeyNames(pages).includes(NAME));
  });

  for (const path of ["offers", "deals", "promotions", "coupons"]) {
    it(`counts /${path} as an offers page`, () => {
      const pages = [page(`https://shop.test/${path}`, [dealSignal])];
      assert.ok(journeyNames(pages).includes(NAME), `/${path} should qualify`);
    });
  }

  for (const text of [
    "Offer",
    "Deal of the day",
    "Promotion",
    "Coupon code",
    "Discount",
    "Summer sale",
    "Special",
  ]) {
    it(`treats "${text}" as a deal signal`, () => {
      const pages = [page("https://shop.test/offers", [withText(text)])];
      assert.ok(journeyNames(pages).includes(NAME), `"${text}" should qualify`);
    });
  }

  it("sequences homepage then offers page", () => {
    const pages = [
      page("https://shop.test/offers", [dealSignal]),
      page(HOME, []),
    ];
    assert.deepEqual(journey(pages, NAME).pageSequence, [
      HOME,
      "https://shop.test/offers",
    ]);
  });

  it("reports confidence 75 and the documented tags", () => {
    const found = journey([page("https://shop.test/offers", [dealSignal])], NAME);
    assert.equal(found.confidence, 75);
    assert.deepEqual(found.tags, ["offers", "deals", "promotions", "coupons"]);
  });
});

describe("JourneyInferenceEngine: element indicators", () => {
  // Product Discovery needs products + search-or-nav + homepage. Holding the
  // search signal and homepage fixed, the product rule alone decides.
  function productRuleFires(productElement) {
    return journeyNames([page(HOME, [productElement, searchSignal])]).includes(
      "Product Discovery & Browse"
    );
  }

  it("reads a product className as a product", () => {
    assert.ok(
      productRuleFires(
        element({ tag: "div", locator: ".c", text: "x", attributes: { class: "product-card" } })
      )
    );
    assert.ok(
      productRuleFires(
        element({ tag: "div", locator: ".c", text: "x", attributes: { class: "item-card" } })
      )
    );
  });

  it("reads product wording as a product", () => {
    assert.ok(productRuleFires(withText("Add to cart")));
    assert.ok(productRuleFires(withText("View product")));
    assert.ok(productRuleFires(withText("Item 42")));
  });

  it("reads a price in a span as a product", () => {
    assert.ok(
      productRuleFires(element({ tag: "span", locator: ".price", text: "$999" }))
    );
  });

  it("does not read a price in a button as a product", () => {
    assert.ok(
      !productRuleFires(element({ tag: "button", locator: ".b", text: "$999" }))
    );
  });

  it("reads a 'view' link as a product but not a 'view' button", () => {
    assert.ok(productRuleFires(element({ tag: "a", locator: "#l", text: "View" })));
    assert.ok(!productRuleFires(withText("View")));
  });

  it("ignores an element with no product signal at all", () => {
    assert.ok(!productRuleFires(withText("Contact us")));
  });

  it("falls back to ariaLabel when text is empty", () => {
    assert.ok(
      productRuleFires(
        element({ tag: "a", locator: "#l", text: "", ariaLabel: "View product" })
      )
    );
  });

  // Holding products and the homepage fixed, the search/nav rule alone decides.
  function discoveryUnlockedBy(gateElement) {
    return journeyNames([page(HOME, [productSignal, gateElement])]).includes(
      "Product Discovery & Browse"
    );
  }

  for (const text of ["Search", "Filter", "Find", "Query"]) {
    it(`treats "${text}" as a search signal`, () => {
      assert.ok(discoveryUnlockedBy(withText(text)));
    });
  }

  it("treats a search className as a search signal", () => {
    assert.ok(
      discoveryUnlockedBy(
        element({ tag: "div", locator: ".s", text: "go", attributes: { class: "search-box" } })
      )
    );
  });

  it("treats input[type=search] as a search signal", () => {
    assert.ok(
      discoveryUnlockedBy(
        element({ tag: "input", locator: "#q", text: "go", attributes: { type: "search" } })
      )
    );
  });

  it("treats a search placeholder as a search signal", () => {
    assert.ok(
      discoveryUnlockedBy(
        element({
          tag: "input",
          locator: "#q",
          text: "go",
          attributes: { type: "text", placeholder: "search products" },
        })
      )
    );
  });

  for (const text of ["Home", "Category", "Categories", "Menu", "Nav", "Browse", "Shop"]) {
    it(`treats "${text}" as a navigation signal`, () => {
      assert.ok(discoveryUnlockedBy(withText(text)));
    });
  }

  it("does not unlock discovery from an unrelated element", () => {
    assert.ok(!discoveryUnlockedBy(withText("Terms and conditions")));
  });

  // Checkout needs products + checkout wording; products are held fixed.
  function checkoutUnlockedBy(text) {
    return journeyNames([page(HOME, [productSignal, withText(text)])]).includes(
      "Shopping & Checkout"
    );
  }

  for (const text of [
    "Add to cart",
    "Cart",
    "Checkout",
    "Payment",
    "Pay now",
    "Proceed",
    "Purchase",
    "Buy",
  ]) {
    it(`treats "${text}" as a checkout signal`, () => {
      assert.ok(checkoutUnlockedBy(text));
    });
  }

  it("does not treat unrelated wording as a checkout signal", () => {
    assert.ok(!checkoutUnlockedBy("About us"));
  });
});

describe("JourneyInferenceEngine: whole-site inference", () => {
  // A site carrying every signal should yield every journey, which is the only
  // case that proves the four inferences are independent rather than mutually
  // exclusive.
  const pages = [
    page(HOME, [productSignal, withText("Search"), withText("Browse")]),
    page("https://shop.test/product/1", [productSignal, withText("Add to cart")]),
    page("https://shop.test/cart", [withText("Checkout")]),
    page("https://shop.test/account", [withText("My Account")]),
    page("https://shop.test/deals", [withText("Special offer")]),
  ];

  it("infers all four journeys from a site that signals all four", () => {
    assert.deepEqual(journeyNames(pages), [
      "Account Management",
      "Deal & Offer Exploration",
      "Product Discovery & Browse",
      "Shopping & Checkout",
    ]);
  });

  it("gives every journey a well-formed shape", () => {
    for (const j of JourneyInferenceEngine.inferJourneys(session(pages))) {
      assert.match(j.id, /^journey_[a-z_]+_\d+$/, `${j.name} id`);
      assert.ok(j.name.length > 0, `${j.name} name`);
      assert.ok(j.description.length > 0, `${j.name} description`);
      assert.ok(Array.isArray(j.pageSequence), `${j.name} pageSequence`);
      assert.ok(j.elementPatterns.length > 0, `${j.name} elementPatterns`);
      assert.ok(Array.isArray(j.signals.semanticSignals), `${j.name} semanticSignals`);
      assert.ok(Array.isArray(j.signals.urlPatterns), `${j.name} urlPatterns`);
      assert.ok(j.confidence > 0 && j.confidence <= 100, `${j.name} confidence`);
      assert.ok(j.tags.length > 0, `${j.name} tags`);
    }
  });

  it("never repeats a url within one journey's page sequence", () => {
    for (const j of JourneyInferenceEngine.inferJourneys(session(pages))) {
      assert.equal(
        new Set(j.pageSequence).size,
        j.pageSequence.length,
        `${j.name} repeats a url`
      );
    }
  });
});
