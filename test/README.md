# Tests

```
test/
  unit/          node:test suites, no browser, no network   → npm run test:unit
  integration/   node:test suites, local fixture app        → npm run test:integration
  helpers/       harnesses shared by the suites
  fixtures/      page element fixtures
  manual/        exploration scripts, NOT part of the gate
```

## Running

```bash
npm test                  # build, then unit + integration
npm run test:unit         # fast, no browser
npm run test:integration  # boots the benchmark app; crawl suite needs Chrome
npm run benchmark:install # one-off: install the fixture app's dependencies
```

`npm run test:integration` needs the fixture app's dependencies. Run
`npm run benchmark:install` once before the first run.

## Coverage

```bash
npm run test:coverage     # unit suites + a coverage floor that fails the run
```

CI runs this instead of `test:unit`, so coverage cannot silently fall. The
floor is a ratchet: it is pinned to what the suite actually achieves, and is
raised when coverage rises, never lowered to make a build pass.

What is measured is `build/**`, minus three things that would distort it:

| Excluded | Why |
|---|---|
| `build/test/**` | `analyzer-stubbed.mjs` is the esbuild bundle the analyzer harness generates — test scaffolding, not product code, and its line numbers do not map back to `src/` |
| `build/analyzer.browser.js` | the 2.1 MB IIFE bundle, a second copy of `analyzer.ts` |
| `build/types.js` | type declarations, nothing executable |

Measure only what a PR can be asked to fix. A number computed over bundles is
not a number anybody can act on — before these exclusions the suite read 45%,
against 73% for the code it actually tests.

Coverage is a floor, not a target. `heuristic-scorer.js` sat at 90% line but
74% branch, and the dark branches were the individual scoring rules — the
part that decides what the tool recommends. Prefer a test per rule over a test
that merely walks the function.

`crawler.js` sits around 30% and is meant to. Everything past `init()` needs a
real browser; it is covered by `integration/benchmark-crawl.test.js`, and
chasing it with mocks would only test the mock.

## The MCP server is tested twice

| Suite | Transport | What only it can show |
|---|---|---|
| `integration/mcp-server.test.js` | spawns `build/index.js` over stdio | the real entry point boots and speaks the protocol |
| `integration/mcp-handlers.test.js` | in-memory, same process | the handlers' own logic, *and* their coverage |

A child process contributes nothing to a coverage report, so `index.ts` read as
0% while being exercised on every integration run. `startInProcessServer()`
connects the exported `server` to an `InMemoryTransport` instead. `index.ts`
only calls `main()` when it is the process entry point, so importing it does
not seize stdio — remove that guard and an importing test turns its own stdout
into a protocol stream.

Keep both. Dropping the spawned one would stop anyone noticing that the shipped
binary no longer starts.

## The browser gate

`integration/benchmark-crawl.test.js` and `integration/aria-audit.test.js`
drive a real browser. The ARIA suite audits BenchmarkShop's `/aria-lab` page,
which is deliberately unlinked so the crawl ground truth never sees it.

| Environment | Behaviour |
|---|---|
| Chrome works | suite runs |
| Chrome missing | suite skips, printing why |
| Chrome missing **and** `REQUIRE_BROWSER=1` | suite **fails** |

CI sets `REQUIRE_BROWSER=1`. This matters: the previous suite caught
`session not created` and exited 0, so a broken driver and a clean crawl were
indistinguishable. Skipping is only acceptable when nobody claimed the browser
was available.

## Fixtures, not third-party sites

Crawl tests target `benchmark/app` (BenchmarkShop) on an ephemeral port, and
assert against `benchmark/ground-truth/journeys.json`, which pins the canonical
journeys, the frozen element ids and the scoring rubric.

`integration/benchmark-journeys.test.js` also checks the fixture itself still
serves those pages and ids — if the app drifts from its own ground truth, every
number derived from it is meaningless.

## Writing a new suite

- Put it in `unit/` if it needs neither browser nor network; otherwise
  `integration/`. The file must end in `.test.js` to be picked up.
- Import the compiled output (`../../build/x.js`), not `src/`. `pretest` builds.
- Assert on behaviour, not on source text. An earlier suite grepped
  `src/analyzer.ts` for the literal `'float16'`; the code said `'fp16'`, so the
  test failed while the behaviour was correct, and it would equally have passed
  had the behaviour broken while the literal stayed.
- `helpers/fake-dom.js` executes generated browser handlers, so handler tests
  can assert that the right element was clicked rather than that the emitted
  string contains `.click()`.
- `helpers/analyzer-harness.js` bundles `analyzer.ts` with a stubbed
  Transformers.js, so device negotiation and dtype are observable without
  downloading a model.
- `helpers/fake-indexeddb.js` is an in-memory IndexedDB covering what
  `EmbeddingCache` touches, with injectable faults (`failOpen`, `failGet`, …)
  so the degrade-quietly paths are reachable.
- `fixtures/sessions.js` builds `CrawlSession` / `CrawledPage` /
  `HighIntentElement` shapes. Use it rather than growing a fourth private copy
  of the same three helpers.
- Time-dependent code gets a stubbed clock, not a real wait. `IncrementalAnalyzer`
  compares against a 500ms interval starting from zero, so with the real clock
  its first call passes or fails depending on how long the process happened to
  have been alive — a test that depends on its position in the run is worse
  than no test.

## `manual/`

Exploration scripts that drive a browser against live sites. They print what
they find and have no fixed expected output, so they are not tests and are not
in the gate. Run them through the wrapper, which turns a silent driver failure
into a non-zero exit:

```bash
node test/manual/run-manual.js                      # list
node test/manual/run-manual.js test-bstackdemo.js   # run one
```
