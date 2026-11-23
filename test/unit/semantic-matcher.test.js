/**
 * SemanticMatcher: loading, fallback and caching around an injected embedder.
 * The real model is not downloaded here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SemanticMatcher,
  describeElement,
  cosineSimilarity,
  SEMANTIC_LOCATOR_ENV,
} from "../../build/semantic-matcher.js";

function quiet(fn) {
  const saved = console.error;
  console.error = () => {};
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = saved;
    });
}

/** Embeds by which of a few words a text contains. */
const VOCAB = ["pay", "checkout", "home", "search"];
function bagOfWords(texts) {
  return texts.map((t) => VOCAB.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)));
}

/** An embedder that records every batch it is given. */
function recordingEmbedder() {
  const batches = [];
  const embed = async (texts) => {
    batches.push(texts);
    return bagOfWords(texts);
  };
  return { embed, batches };
}

const button = (text, extra = {}) => ({ tag: "button", text, ...extra });

describe("SemanticMatcher.similarities", () => {
  it("scores each element against the description, in order", async () => {
    const { embed } = recordingEmbedder();
    const matcher = new SemanticMatcher({ loadEmbedder: async () => embed });

    const scores = await matcher.similarities("pay", [button("Pay now"), button("Home")]);

    assert.equal(scores.length, 2);
    assert.ok(scores[0] > 0.99);
    assert.equal(scores[1], 0);
  });

  it("loads the model once across calls", async () => {
    let loads = 0;
    const matcher = new SemanticMatcher({
      loadEmbedder: async () => {
        loads += 1;
        return recordingEmbedder().embed;
      },
    });

    await matcher.similarities("pay", [button("Pay")]);
    await matcher.similarities("home", [button("Home")]);
    assert.equal(loads, 1);
  });

  it("embeds each distinct element once, however often it is queried", async () => {
    const { embed, batches } = recordingEmbedder();
    const matcher = new SemanticMatcher({ loadEmbedder: async () => embed });
    const elements = [button("Pay"), button("Pay"), button("Home")];

    await matcher.similarities("pay", elements);
    await matcher.similarities("home", elements);

    assert.equal(batches[0].length, 3, "query + two distinct elements");
    assert.deepEqual(batches[1], ["home"], "second call embeds only the query");
  });

  it("returns null when the model fails to load, and does not retry at once", async () => {
    let loads = 0;
    let clock = 0;
    const matcher = new SemanticMatcher({
      now: () => clock,
      loadEmbedder: async () => {
        loads += 1;
        throw new Error("offline");
      },
    });

    await quiet(async () => {
      assert.equal(await matcher.similarities("pay", [button("Pay")]), null);
      assert.equal(await matcher.similarities("pay", [button("Pay")]), null);
      assert.equal(loads, 1, "a failed load is not retried immediately");

      clock += 6 * 60 * 1000;
      await matcher.similarities("pay", [button("Pay")]);
      assert.equal(loads, 2, "it is retried after the back-off");
    });
  });

  it("does not hold a request past the load timeout, and uses the model once it arrives", async () => {
    let release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    const matcher = new SemanticMatcher({
      loadTimeoutMs: 20,
      loadEmbedder: async () => {
        await ready;
        return recordingEmbedder().embed;
      },
    });

    await quiet(async () => {
      assert.equal(await matcher.similarities("pay", [button("Pay")]), null);
    });

    release();
    await new Promise((r) => setTimeout(r, 0));
    const scores = await matcher.similarities("pay", [button("Pay")]);
    assert.ok(scores[0] > 0.99);
  });

  it("returns null when embedding throws", async () => {
    const matcher = new SemanticMatcher({
      loadEmbedder: async () => async () => {
        throw new Error("bad input");
      },
    });

    await quiet(async () => {
      assert.equal(await matcher.similarities("pay", [button("Pay")]), null);
    });
  });

  it("warmUp starts the load without waiting for it", async () => {
    let loads = 0;
    const matcher = new SemanticMatcher({
      loadEmbedder: async () => {
        loads += 1;
        return recordingEmbedder().embed;
      },
    });

    matcher.warmUp();
    matcher.warmUp();
    await matcher.similarities("pay", [button("Pay")]);
    assert.equal(loads, 1, "concurrent warm-ups and requests share one load");
  });
});

describe("SemanticMatcher.disabledByEnv", () => {
  for (const value of ["off", "0", "false", " OFF "]) {
    it(`treats ${JSON.stringify(value)} as off`, () => {
      assert.equal(SemanticMatcher.disabledByEnv({ [SEMANTIC_LOCATOR_ENV]: value }), true);
    });
  }

  for (const value of [undefined, "", "on", "1"]) {
    it(`treats ${JSON.stringify(value)} as on`, () => {
      assert.equal(SemanticMatcher.disabledByEnv({ [SEMANTIC_LOCATOR_ENV]: value }), false);
    });
  }

  it("reads process.env by default", () => {
    const saved = process.env[SEMANTIC_LOCATOR_ENV];
    process.env[SEMANTIC_LOCATOR_ENV] = "off";
    try {
      assert.equal(SemanticMatcher.disabledByEnv(), true);
    } finally {
      if (saved === undefined) delete process.env[SEMANTIC_LOCATOR_ENV];
      else process.env[SEMANTIC_LOCATOR_ENV] = saved;
    }
  });
});

describe("describeElement", () => {
  it("leads with the kind of control and its visible text", () => {
    assert.equal(describeElement({ tag: "button", text: "Pay now" }), "button, text: Pay now");
  });

  it("prefers the ARIA role over the tag", () => {
    assert.equal(
      describeElement({ tag: "div", role: "link", ariaLabel: "Help" }),
      "link, label: Help"
    );
  });

  it("names the input type", () => {
    assert.equal(
      describeElement({ tag: "input", attributes: { type: "email", placeholder: "Email address" } }),
      "email input, placeholder: Email address"
    );
  });

  it("splits identifier-style names into words", () => {
    assert.equal(
      describeElement({ tag: "input", id: "billingZipCode", attributes: { name: "shipping_address-line1" } }),
      "input, name: shipping address line1, id: billing zip code"
    );
  });

  it("includes title and alt text, and skips blank values", () => {
    assert.equal(
      describeElement({ tag: "img", text: "  ", attributes: { title: "Logo", alt: "Acme home" } }),
      "img, title: Logo, alt: Acme home"
    );
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for parallel vectors and 0 for orthogonal ones", () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2], [2, 4]) - 1) < 1e-9);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it("is 0 rather than NaN for mismatched, empty or zero vectors", () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
    assert.equal(cosineSimilarity([], []), 0);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.equal(cosineSimilarity(undefined, [1]), 0);
  });
});

describe("resolveModelSource", () => {
  it("defaults to the stock model", async () => {
    const { resolveModelSource, MATCHER_MODEL } = await import("../../build/semantic-matcher.js");
    assert.deepEqual(resolveModelSource(undefined), { model: MATCHER_MODEL });
    assert.deepEqual(resolveModelSource("  "), { model: MATCHER_MODEL });
  });

  it("treats anything that is not a local directory as a Hub id", async () => {
    const { resolveModelSource } = await import("../../build/semantic-matcher.js");
    assert.deepEqual(resolveModelSource("your-org/locator-model"), { model: "your-org/locator-model" });
  });

  it("splits a local directory into the search path and folder name", async () => {
    const { resolveModelSource } = await import("../../build/semantic-matcher.js");
    const { mkdtempSync, mkdirSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = mkdtempSync(path.join(os.tmpdir(), "locator-"));
    const dir = path.join(root, "locator-model");
    mkdirSync(dir);

    assert.deepEqual(resolveModelSource(dir), {
      model: "locator-model",
      localModelPath: root + path.sep,
    });
  });

  it("does not mistake a file for a model directory", async () => {
    const { resolveModelSource } = await import("../../build/semantic-matcher.js");
    const file = new URL(import.meta.url).pathname;
    assert.deepEqual(resolveModelSource(file), { model: file });
  });

  it("names the model a matcher will load", async () => {
    const { SemanticMatcher, MATCHER_MODEL } = await import("../../build/semantic-matcher.js");
    assert.equal(new SemanticMatcher().modelName, MATCHER_MODEL);
    assert.equal(new SemanticMatcher({ model: "org/model" }).modelName, "org/model");
  });
});

describe("minSimilarityFromEnv", () => {
  it("reads a number", async () => {
    const { minSimilarityFromEnv, LOCATOR_MIN_SIMILARITY_ENV } = await import("../../build/semantic-matcher.js");
    assert.equal(minSimilarityFromEnv({ [LOCATOR_MIN_SIMILARITY_ENV]: "0.16" }), 0.16);
  });

  it("is undefined when unset or blank", async () => {
    const { minSimilarityFromEnv, LOCATOR_MIN_SIMILARITY_ENV } = await import("../../build/semantic-matcher.js");
    assert.equal(minSimilarityFromEnv({}), undefined);
    assert.equal(minSimilarityFromEnv({ [LOCATOR_MIN_SIMILARITY_ENV]: " " }), undefined);
  });

  it("ignores, and reports, a value that is not a number", async () => {
    const { minSimilarityFromEnv, LOCATOR_MIN_SIMILARITY_ENV } = await import("../../build/semantic-matcher.js");
    const messages = [];
    const saved = console.error;
    console.error = (m) => messages.push(m);
    try {
      assert.equal(minSimilarityFromEnv({ [LOCATOR_MIN_SIMILARITY_ENV]: "high" }), undefined);
    } finally {
      console.error = saved;
    }
    assert.match(messages.join("\n"), /not a number/);
  });

  it("reads process.env by default", async () => {
    const { minSimilarityFromEnv, LOCATOR_MIN_SIMILARITY_ENV } = await import("../../build/semantic-matcher.js");
    const saved = process.env[LOCATOR_MIN_SIMILARITY_ENV];
    process.env[LOCATOR_MIN_SIMILARITY_ENV] = "0.3";
    try {
      assert.equal(minSimilarityFromEnv(), 0.3);
    } finally {
      if (saved === undefined) delete process.env[LOCATOR_MIN_SIMILARITY_ENV];
      else process.env[LOCATOR_MIN_SIMILARITY_ENV] = saved;
    }
  });
});
