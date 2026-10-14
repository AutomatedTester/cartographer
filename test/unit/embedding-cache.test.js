/**
 * EmbeddingCache against an in-memory IndexedDB.
 *
 * 342 lines with no test, and the component with the nastiest failure mode in
 * the project: a cache that returns the wrong vector does not error, it just
 * makes every downstream similarity score wrong, for the rest of the session.
 * A cache that silently refuses to store is almost as bad — it turns the
 * documented "2-3x faster multi-page crawls" into a no-op nobody notices.
 *
 * The contract that matters most is the one about *not* failing: every method
 * must degrade quietly when IndexedDB is unavailable or erroring, because the
 * cache is an optimisation and must never take a crawl down with it.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { EmbeddingCache } from "../../build/embedding-cache.js";
import {
  installFakeIndexedDb,
  recordsIn,
  seedRecord,
} from "../helpers/fake-indexeddb.js";

const DB = "webmcp_embeddings";
const STORE = "embeddings";

let restore = null;

/** Install the fake with the given faults and return an initialised cache. */
async function openCache(options = {}) {
  restore?.();
  restore = installFakeIndexedDb(options);
  const cache = new EmbeddingCache();
  await cache.init();
  return cache;
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe("EmbeddingCache.init", () => {
  it("opens the database and creates the store on first use", async () => {
    const cache = await openCache();
    await cache.setEmbedding("hello", [1, 2, 3]);
    assert.equal(recordsIn(DB, STORE).length, 1, "store exists and accepts writes");
  });

  it("is idempotent: a second init is a no-op, not a reopen", async () => {
    const cache = await openCache();
    await cache.setEmbedding("hello", [1, 2, 3]);

    await cache.init();

    assert.deepEqual(await cache.getEmbedding("hello"), [1, 2, 3], "state survived");
  });

  it("rejects when IndexedDB cannot be opened", async () => {
    restore = installFakeIndexedDb({ failOpen: true });
    await assert.rejects(() => new EmbeddingCache().init());
  });
});

describe("EmbeddingCache before init", () => {
  beforeEach(() => {
    restore = installFakeIndexedDb();
  });

  it("returns null from getEmbedding rather than throwing", async () => {
    assert.equal(await new EmbeddingCache().getEmbedding("anything"), null);
  });

  it("ignores setEmbedding rather than throwing", async () => {
    await assert.doesNotReject(() =>
      new EmbeddingCache().setEmbedding("anything", [1, 2])
    );
    assert.deepEqual(recordsIn(DB, STORE), []);
  });

  it("ignores clearExpired rather than throwing", async () => {
    await assert.doesNotReject(() => new EmbeddingCache().clearExpired());
  });

  it("ignores clear rather than throwing", async () => {
    await assert.doesNotReject(() => new EmbeddingCache().clear());
  });

  it("treats close as a no-op", () => {
    assert.doesNotThrow(() => new EmbeddingCache().close());
  });
});

describe("EmbeddingCache round trip", () => {
  it("returns the embedding that was stored", async () => {
    const cache = await openCache();
    await cache.setEmbedding("delete button", [0.1, 0.2, 0.3]);

    const result = await cache.getEmbedding("delete button");

    assert.ok(Array.isArray(result), "must come back as a plain array");
    assert.equal(result.length, 3);
    for (const [i, expected] of [0.1, 0.2, 0.3].entries()) {
      assert.ok(Math.abs(result[i] - expected) < 1e-6, `component ${i}`);
    }
  });

  it("accepts a Float32Array and returns a plain array", async () => {
    const cache = await openCache();
    await cache.setEmbedding("submit", new Float32Array([1, 2, 3]));

    const result = await cache.getEmbedding("submit");

    assert.ok(Array.isArray(result));
    assert.deepEqual(result, [1, 2, 3]);
  });

  it("returns null for text that was never stored", async () => {
    const cache = await openCache();
    assert.equal(await cache.getEmbedding("never seen"), null);
  });

  it("keeps different texts in different slots", async () => {
    const cache = await openCache();
    await cache.setEmbedding("alpha", [1, 1, 1]);
    await cache.setEmbedding("beta", [2, 2, 2]);

    assert.deepEqual(await cache.getEmbedding("alpha"), [1, 1, 1]);
    assert.deepEqual(await cache.getEmbedding("beta"), [2, 2, 2]);
  });

  it("overwrites the vector when the same text is stored twice", async () => {
    const cache = await openCache();
    await cache.setEmbedding("alpha", [1, 1, 1]);
    await cache.setEmbedding("alpha", [9, 9, 9]);

    assert.deepEqual(await cache.getEmbedding("alpha"), [9, 9, 9]);
    assert.equal(recordsIn(DB, STORE).length, 1, "replaced, not duplicated");
  });

  it("stores the source text and a timestamp alongside the vector", async () => {
    const cache = await openCache();
    const before = Date.now();
    await cache.setEmbedding("add to cart", [1]);

    const [record] = recordsIn(DB, STORE);
    assert.equal(record.text, "add to cart");
    assert.ok(record.timestamp >= before, "timestamped at write time");
  });

  it("round-trips an empty string and an empty vector", async () => {
    const cache = await openCache();
    await cache.setEmbedding("", []);
    assert.deepEqual(await cache.getEmbedding(""), []);
  });

  it("round-trips text containing unicode and newlines", async () => {
    const cache = await openCache();
    const text = "Löschen\n削除 ✗";
    await cache.setEmbedding(text, [0.5]);
    assert.deepEqual(await cache.getEmbedding(text), [0.5]);
  });
});

describe("EmbeddingCache key hashing", () => {
  it("gives distinct texts distinct keys", async () => {
    const cache = await openCache();
    const texts = [
      "delete button",
      "delete buttons",
      "button delete",
      "Delete Button",
      "",
      " ",
      "a",
      "b",
    ];

    for (const [i, text] of texts.entries()) {
      await cache.setEmbedding(text, [i]);
    }

    assert.equal(
      recordsIn(DB, STORE).length,
      texts.length,
      "a collision would have overwritten a slot"
    );
  });

  it("is case sensitive", async () => {
    const cache = await openCache();
    await cache.setEmbedding("Submit", [1]);
    await cache.setEmbedding("submit", [2]);

    assert.deepEqual(await cache.getEmbedding("Submit"), [1]);
    assert.deepEqual(await cache.getEmbedding("submit"), [2]);
  });

  it("produces a stable key across instances, so a reopened cache still hits", async () => {
    const cache = await openCache();
    await cache.setEmbedding("reopen me", [7]);
    cache.close();

    const second = new EmbeddingCache();
    await second.init();

    assert.deepEqual(await second.getEmbedding("reopen me"), [7]);
  });

  it("namespaces every key, so records are identifiable in storage", async () => {
    const cache = await openCache();
    await cache.setEmbedding("anything", [1]);

    const [record] = recordsIn(DB, STORE);
    assert.match(record.textHash, /^emb_[0-9a-z]+$/);
  });
});

describe("EmbeddingCache.getStats", () => {
  it("starts empty with a zero hit rate rather than NaN", async () => {
    const cache = await openCache();
    assert.deepEqual(cache.getStats(), {
      hits: 0,
      misses: 0,
      hitRate: "0.0%",
      total: 0,
    });
  });

  it("counts a miss when the text is absent", async () => {
    const cache = await openCache();
    await cache.getEmbedding("absent");

    const stats = cache.getStats();
    assert.equal(stats.misses, 1);
    assert.equal(stats.hits, 0);
    assert.equal(stats.hitRate, "0.0%");
  });

  it("counts a hit when the text is present", async () => {
    const cache = await openCache();
    await cache.setEmbedding("present", [1]);
    await cache.getEmbedding("present");

    const stats = cache.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.total, 1);
    assert.equal(stats.hitRate, "100.0%");
  });

  it("reports the hit rate to one decimal place", async () => {
    const cache = await openCache();
    await cache.setEmbedding("present", [1]);

    await cache.getEmbedding("present");
    await cache.getEmbedding("absent-1");
    await cache.getEmbedding("absent-2");

    const stats = cache.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.hitRate, "33.3%");
  });

  it("does not count a lookup made before init", async () => {
    restore = installFakeIndexedDb();
    const cache = new EmbeddingCache();
    await cache.getEmbedding("anything");

    assert.equal(cache.getStats().total, 0, "an uninitialised skip is not a miss");
  });
});

describe("EmbeddingCache.clearExpired", () => {
  it("removes entries older than the ttl and keeps the rest", async () => {
    const cache = await openCache();
    await cache.setEmbedding("fresh", [1]);

    seedRecord(DB, STORE, {
      textHash: "emb_stale",
      text: "stale",
      embedding: new Float32Array([2]),
      timestamp: Date.now() - 7_200_000, // two hours old
    });
    assert.equal(recordsIn(DB, STORE).length, 2);

    await cache.clearExpired(3_600_000);

    const remaining = recordsIn(DB, STORE);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].text, "fresh");
  });

  it("defaults to a one hour ttl", async () => {
    const cache = await openCache();
    seedRecord(DB, STORE, {
      textHash: "emb_old",
      text: "old",
      embedding: new Float32Array([1]),
      timestamp: Date.now() - 3_600_001,
    });

    await cache.clearExpired();

    assert.deepEqual(recordsIn(DB, STORE), []);
  });

  it("removes nothing when every entry is inside the ttl", async () => {
    const cache = await openCache();
    await cache.setEmbedding("a", [1]);
    await cache.setEmbedding("b", [2]);

    await cache.clearExpired(3_600_000);

    assert.equal(recordsIn(DB, STORE).length, 2);
  });

  it("removes everything when the ttl is zero", async () => {
    const cache = await openCache();
    await cache.setEmbedding("a", [1]);

    await cache.clearExpired(0);

    assert.deepEqual(recordsIn(DB, STORE), []);
  });

  it("succeeds on an empty store", async () => {
    const cache = await openCache();
    await assert.doesNotReject(() => cache.clearExpired());
  });

  it("rejects when the cursor errors, rather than hanging", async () => {
    const cache = await openCache({ failCursor: true });
    await cache.setEmbedding("a", [1]);

    await assert.rejects(() => cache.clearExpired());
  });
});

describe("EmbeddingCache.clear", () => {
  it("removes every entry", async () => {
    const cache = await openCache();
    await cache.setEmbedding("a", [1]);
    await cache.setEmbedding("b", [2]);

    await cache.clear();

    assert.deepEqual(recordsIn(DB, STORE), []);
  });

  it("resets the hit and miss counters", async () => {
    const cache = await openCache();
    await cache.setEmbedding("a", [1]);
    await cache.getEmbedding("a");
    await cache.getEmbedding("absent");
    assert.equal(cache.getStats().total, 2);

    await cache.clear();

    assert.deepEqual(cache.getStats(), {
      hits: 0,
      misses: 0,
      hitRate: "0.0%",
      total: 0,
    });
  });

  it("rejects when the underlying clear errors", async () => {
    const cache = await openCache({ failClear: true });
    await assert.rejects(() => cache.clear());
  });
});

describe("EmbeddingCache.close", () => {
  it("makes subsequent lookups skip the cache instead of throwing", async () => {
    const cache = await openCache();
    await cache.setEmbedding("a", [1]);

    cache.close();

    assert.equal(await cache.getEmbedding("a"), null);
  });

  it("is safe to call twice", async () => {
    const cache = await openCache();
    cache.close();
    assert.doesNotThrow(() => cache.close());
  });

  it("leaves stored data intact for the next session", async () => {
    const cache = await openCache();
    await cache.setEmbedding("durable", [3]);
    cache.close();

    assert.equal(recordsIn(DB, STORE).length, 1);
  });
});

describe("EmbeddingCache under IndexedDB faults", () => {
  // The cache is an optimisation. Every one of these must degrade to "no
  // cache" rather than propagate, or a storage hiccup takes down the crawl.
  it("returns null, not a rejection, when a read errors", async () => {
    const cache = await openCache({ failGet: true });
    assert.equal(await cache.getEmbedding("anything"), null);
  });

  it("swallows a write error rather than rejecting", async () => {
    const cache = await openCache({ failPut: true });
    await assert.doesNotReject(() => cache.setEmbedding("anything", [1]));
  });

  it("still reports a miss when the read errored", async () => {
    const cache = await openCache({ failGet: true });
    await cache.getEmbedding("anything");
    assert.equal(cache.getStats().hits, 0);
  });

  // A real connection can be closed out from under a holder — a version change
  // in another tab, or storage eviction — leaving a handle that throws the
  // moment a transaction is opened. Two caches over one database reproduce it:
  // closing the first invalidates the connection the second still holds.
  it("degrades to no-cache when its connection is closed underneath it", async () => {
    const first = await openCache();
    const second = new EmbeddingCache();
    await second.init();
    await second.setEmbedding("before", [1]);

    first.close();

    assert.equal(
      await second.getEmbedding("before"),
      null,
      "read must fail soft, not throw"
    );
    await assert.doesNotReject(
      () => second.setEmbedding("after", [2]),
      "write must fail soft, not throw"
    );
  });
});
