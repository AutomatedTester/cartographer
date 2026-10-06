/**
 * Loads src/analyzer.ts into Node for behavioural testing.
 *
 * The analyzer is browser-only and imports @huggingface/transformers, so it
 * cannot simply be required. This bundles it with esbuild, aliasing the model
 * library to a stub, and installs the browser globals it touches. That turns
 * assertions like "picks fp16 on GPU" from a grep over source text into a check
 * on what the module actually asked the pipeline for.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outfile = path.join(repoRoot, "build", "test", "analyzer-stubbed.mjs");

let buildPromise = null;
let loadCounter = 0;

/** Bundle the analyzer once per process. */
function ensureBuilt() {
  if (!buildPromise) {
    buildPromise = esbuild.build({
      entryPoints: [path.join(repoRoot, "src", "analyzer.ts")],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      outfile,
      logLevel: "silent",
      alias: {
        "@huggingface/transformers": path.join(here, "transformers-stub.js"),
      },
    });
  }
  return buildPromise;
}

/**
 * Import a fresh copy of the analyzer module.
 *
 * DomAnalyzer keeps a process-wide static model cache, so every test needs its
 * own module instance. The query string defeats the ESM module cache.
 */
export async function loadAnalyzerModule() {
  await ensureBuilt();
  loadCounter += 1;
  const url = `${pathToFileURL(outfile).href}?instance=${loadCounter}`;
  return import(url);
}

/**
 * Minimal Element stand-in satisfying what extractDom() reads.
 *
 * @param {string} tag
 * @param {object} [spec] { id, classes, text, attrs, children, visible }
 */
export function node(tag, spec = {}) {
  const attrs = { ...(spec.attrs ?? {}) };
  const children = spec.children ?? [];
  return {
    tagName: tag.toUpperCase(),
    id: spec.id ?? "",
    classList: spec.classes ?? [],
    textContent: spec.text ?? "",
    shadowRoot: null,
    children,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (name) =>
      Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null,
    __visible: spec.visible !== false,
  };
}

/** Replace document.body.children with the given nodes. */
export function setPageBody(nodes) {
  globalThis.document.body = { children: nodes };
}

class FakeIndexedDBRequest {
  constructor() {
    this.result = { objectStoreNames: { contains: () => true }, close() {} };
    this.error = null;
    setTimeout(() => this.onsuccess?.(), 0);
  }
}

/**
 * Install the browser globals the analyzer reads.
 *
 * @param {object} options
 * @param {boolean} [options.webnn] expose navigator.ml
 * @param {boolean} [options.webnnThrows] make navigator.ml.createContext reject
 * @param {number} [options.deviceMemory] navigator.deviceMemory in GB
 * @param {string} [options.effectiveType] navigator.connection.effectiveType
 * @param {boolean} [options.indexedDB] expose a working indexedDB (default true)
 * @returns {() => void} restore function
 */
export function installBrowserGlobals(options = {}) {
  const {
    webnn = false,
    webnnThrows = false,
    deviceMemory = 8,
    effectiveType = "4g",
    indexedDB: withIndexedDb = true,
  } = options;

  const saved = {};
  const keys = ["window", "navigator", "document", "indexedDB", "self"];
  for (const key of keys) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }

  const navigatorStub = {
    deviceMemory,
    connection: { effectiveType },
    userAgent: "node-test",
  };
  if (webnn) {
    navigatorStub.ml = {
      createContext: async () => {
        if (webnnThrows) throw new Error("WebNN context unavailable");
        return { close: async () => {} };
      },
    };
  }

  const windowStub = {
    location: { href: "https://example.test/page" },
    navigator: navigatorStub,
    getComputedStyle: (el) => ({
      display: el?.__visible === false ? "none" : "block",
      visibility: "visible",
    }),
  };

  const define = (key, value) =>
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });

  define("window", windowStub);
  define("self", windowStub);
  define("navigator", navigatorStub);
  define("document", {
    title: "Test Page",
    body: { children: [] },
    querySelectorAll: () => [],
    querySelector: () => null,
  });
  if (withIndexedDb) {
    define("indexedDB", { open: () => new FakeIndexedDBRequest() });
  } else {
    delete globalThis.indexedDB;
  }

  return function restore() {
    for (const key of keys) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  };
}
