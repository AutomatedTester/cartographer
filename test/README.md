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

## The browser gate

Only `integration/benchmark-crawl.test.js` drives a real browser.

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

## `manual/`

Exploration scripts that drive a browser against live sites. They print what
they find and have no fixed expected output, so they are not tests and are not
in the gate. Run them through the wrapper, which turns a silent driver failure
into a non-zero exit:

```bash
node test/manual/run-manual.js                      # list
node test/manual/run-manual.js test-bstackdemo.js   # run one
```
