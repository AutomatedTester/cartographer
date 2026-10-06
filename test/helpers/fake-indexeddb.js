/**
 * An in-memory IndexedDB good enough for EmbeddingCache.
 *
 * EmbeddingCache is browser-only and talks to IndexedDB directly, which is why
 * it had no tests. Node has no IndexedDB, and pulling in a full polyfill would
 * add a dependency to test ~340 lines. This implements only the surface the
 * cache actually touches — open/upgrade, get/put/clear, a timestamp index and
 * a deleting cursor — and nothing else.
 *
 * Requests dispatch asynchronously, as the real API does: the caller assigns
 * `onsuccess` *after* the request object exists, so firing synchronously from
 * the constructor would silently skip every handler and make the fake useless.
 *
 * Failures are injectable (`failOpen`, `failGet`, ...) so the error branches —
 * which are the whole point of a cache that must never break a crawl — are
 * reachable without contriving real I/O faults.
 */

/** Databases persist across open() calls, so close-then-reopen keeps data. */
const databases = new Map();

let faults = {};

/** Fire `fn` on a later turn, mimicking IndexedDB's async request dispatch. */
function later(fn) {
  setTimeout(fn, 0);
}

class FakeRequest {
  constructor(exec, shouldFail) {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;

    later(() => {
      if (shouldFail) {
        this.error = new Error("injected IndexedDB failure");
        this.onerror?.({ target: this });
        return;
      }
      this.result = exec();
      this.onsuccess?.({ target: this });
    });
  }
}

/**
 * A cursor request that walks `records`, re-firing onsuccess per continue()
 * and finally firing with a null result to signal the end.
 */
class FakeCursorRequest {
  constructor(records, store, shouldFail) {
    this.result = null;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this._records = records;
    this._store = store;
    this._index = 0;

    later(() => {
      if (shouldFail) {
        this.error = new Error("injected cursor failure");
        this.onerror?.({ target: this });
        return;
      }
      this._emit();
    });
  }

  _emit() {
    if (this._index >= this._records.length) {
      this.result = null;
      this.onsuccess?.({ target: this });
      return;
    }

    const record = this._records[this._index];
    this.result = {
      value: record,
      delete: () => this._store.data.delete(record[this._store.keyPath]),
      continue: () => {
        this._index += 1;
        later(() => this._emit());
      },
    };
    this.onsuccess?.({ target: this });
  }
}

class FakeIndex {
  constructor(store, keyPath) {
    this.store = store;
    this.keyPath = keyPath;
  }

  openCursor(range) {
    const matching = [...this.store.data.values()].filter((record) => {
      const value = record[this.keyPath];
      if (!range) return true;
      if (range.upper !== undefined && value > range.upper) return false;
      if (range.lower !== undefined && value < range.lower) return false;
      return true;
    });
    return new FakeCursorRequest(matching, this.store, faults.failCursor);
  }
}

class FakeObjectStore {
  constructor(store) {
    this.store = store;
  }

  get(key) {
    return new FakeRequest(() => this.store.data.get(key), faults.failGet);
  }

  put(record) {
    return new FakeRequest(() => {
      this.store.data.set(record[this.store.keyPath], record);
    }, faults.failPut);
  }

  clear() {
    return new FakeRequest(() => this.store.data.clear(), faults.failClear);
  }

  index(name) {
    const keyPath = this.store.indexes.get(name);
    if (keyPath === undefined) throw new Error(`no index named ${name}`);
    return new FakeIndex(this.store, keyPath);
  }

  createIndex(name, keyPath) {
    this.store.indexes.set(name, keyPath);
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.error = null;
    this.onerror = null;
  }

  objectStore(name) {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`no object store named ${name}`);
    return new FakeObjectStore(store);
  }
}

class FakeDatabase {
  constructor(name) {
    this.name = name;
    this.stores = new Map();
    this.closed = false;
  }

  get objectStoreNames() {
    return { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    const store = { keyPath, data: new Map(), indexes: new Map() };
    this.stores.set(name, store);
    return new FakeObjectStore(store);
  }

  transaction(_names, _mode) {
    if (this.closed) throw new Error("database is closed");
    return new FakeTransaction(this);
  }

  close() {
    this.closed = true;
  }
}

function open(name) {
  const request = {
    result: null,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };

  later(() => {
    if (faults.failOpen) {
      request.error = new Error("injected open failure");
      request.onerror?.({ target: request });
      return;
    }

    let db = databases.get(name);
    const isNew = !db;
    if (isNew) {
      db = new FakeDatabase(name);
      databases.set(name, db);
    }
    db.closed = false;
    request.result = db;

    // Real IndexedDB runs the upgrade before success, with result already set.
    if (isNew) request.onupgradeneeded?.({ target: request });
    request.onsuccess?.({ target: request });
  });

  return request;
}

const IDBKeyRange = {
  upperBound: (upper) => ({ upper }),
  lowerBound: (lower) => ({ lower }),
  bound: (lower, upper) => ({ lower, upper }),
};

/**
 * Install the fake as a global, returning a restore function.
 *
 * @param {object} [options] fault injection: failOpen, failGet, failPut,
 *                           failClear, failCursor
 */
export function installFakeIndexedDb(options = {}) {
  faults = { ...options };
  databases.clear();

  const saved = {};
  for (const key of ["indexedDB", "IDBKeyRange"]) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }

  Object.defineProperty(globalThis, "indexedDB", {
    value: { open },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: IDBKeyRange,
    configurable: true,
    writable: true,
  });

  return function restore() {
    faults = {};
    databases.clear();
    for (const key of ["indexedDB", "IDBKeyRange"]) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
}

/** Raw records currently held in `storeName`, for assertions. */
export function recordsIn(dbName, storeName) {
  const store = databases.get(dbName)?.stores.get(storeName);
  return store ? [...store.data.values()] : [];
}

/** Seed a record directly, bypassing the cache under test. */
export function seedRecord(dbName, storeName, record) {
  const store = databases.get(dbName)?.stores.get(storeName);
  if (!store) throw new Error(`${dbName}/${storeName} does not exist yet`);
  store.data.set(record[store.keyPath], record);
}
