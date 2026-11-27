# Development Guide

How to set up WebMCP-Selenium, how it fits together, and how to change it: the build, the edit/build/test cycle, and where to make common changes.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Project Structure](#project-structure)
3. [Build System](#build-system)
4. [Development Workflow](#development-workflow)
5. [Architecture Deep Dive](#architecture-deep-dive)
6. [Adding Features](#adding-features)
7. [Code Style & Conventions](#code-style--conventions)
8. [Running Tests](#running-tests)
9. [Common Tasks](#common-tasks)

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18 (CI runs 18, 20 and 22)
- **Git**
- **Google Chrome** installed (Selenium Manager downloads a matching chromedriver)

### Initial Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd friendly-octo-train

# 2. Install dependencies
npm install

# 3. Build the server and the browser bundle
npm run build
npm run build:browser

# 4. Check the server starts
npm start
```

`npm start` runs both builds again and then starts the server on stdio. It prints this to stderr and then waits for an MCP client on stdin:

```
WebMCP-Selenium MCP server running on stdio
```

Press `Ctrl+C` to stop it. To call its tools by hand, see [USAGE.md](USAGE.md#calling-the-tools).

To run the integration tests later, also install the benchmark app's dependencies once:

```bash
npm run benchmark:install
```

---

## Project Structure

```
src/
├── index.ts                       # MCP server entry point: Zod input schemas, the seven tools, stdio transport
├── types.ts                       # Shared types, used by both the Node build and the browser bundle
│
├── crawler.ts                     # SiteCrawler: starts Chrome, injects the analyzer bundle, runs it, collects console logs
├── analyzer.ts                    # DomAnalyzer: runs in the page; extracts the DOM, scores intent, ML deduplication
├── heuristic-scorer.ts            # HeuristicScorer: rule-based scoring when the ML model is unavailable
├── test-case-generator.ts         # TestCaseGenerator: test cases from high-intent elements (runs in the page, via the bundle)
├── webmcp-semantic-tools.ts       # SemanticToolGenerator: tool schemas for critical elements
├── webmcp-semantic-handlers.ts    # SemanticHandlerGenerator: handler code registered on navigator.webmcp.tools
├── test-executor.ts               # TestExecutor: calls the registered tools for run_critical_tests, with retries
├── locator-generator.ts           # LocatorGenerator: stable CSS/XPath locators and the get_element_locator ranking
├── semantic-matcher.ts            # SemanticMatcher: embedding similarity for get_element_locator; WEBMCP_* model settings
├── markdown-exporter.ts           # MarkdownExporter: every Markdown output format
│
├── aria-collector.ts              # collectAriaSnapshot: runs in the page; roles, focusability, names, id references
├── aria-auditor.ts                # auditAriaSnapshot: the advisory ARIA rules
│
├── multi-page-crawler.ts          # MultiPageCrawler: breadth-first, same-site crawl for crawl_multi_page
├── session-manager.ts             # SessionManager: pages, visited URLs and session state for one crawl
├── login-handler.ts               # LoginHandler: finds, fills, submits and validates login forms
├── workflow-detector.ts           # WorkflowDetector: heuristic workflows (login, forms, browsing, nav menus)
├── advanced-workflow-detector.ts  # Pattern-based workflow detection (tested, not yet used by any tool)
├── journey-inference-engine.ts    # JourneyInferenceEngine: inferred user journeys for crawl_multi_page
│
├── embedding-cache.ts             # EmbeddingCache: IndexedDB cache of embeddings, used by the analyzer in the page
├── browser-pipeline.ts            # BrowserAnalysisPipeline: constructed in index.ts but not yet called by any tool
└── performance-optimizer.ts       # PerformanceOptimizer and helpers (tested, not yet used by any tool)

build/                             # Compiled output (generated, not committed)
├── *.js, *.d.ts, *.js.map         # from npm run build
└── analyzer.browser.js            # from npm run build:browser; injected into every crawled page

test/                              # See test/README.md
├── unit/                          # node:test suites, no browser or network
├── integration/                   # node:test suites against the benchmark app; some need Chrome
├── helpers/                       # shared harnesses (fake DOM, MCP client, benchmark app lifecycle)
├── fixtures/                      # page element and session fixtures
└── manual/                        # exploration scripts, not part of the CI gate

benchmark/                         # BenchmarkShop: local fixture site for the integration tests
├── app/                           # the site (server.js, views/, public/)
└── ground-truth/                  # the journeys the crawler should find

training/                          # Fine-tuning the locator's embedding model; see training/README.md
.github/workflows/                 # CI: build.yml (build matrix), test.yml (type check, coverage, integration)

tsconfig.json                      # Node build (ES2022, Node16 modules)
tsconfig.browser.json              # Browser settings for analyzer.ts (ES2020)
package.json                       # Scripts and dependencies
```

### Key Files by Purpose

- **MCP server and tools**: [src/index.ts](src/index.ts) defines all seven tools: `crawl_and_analyze`, `get_element_locator`, `run_critical_tests`, `audit_aria`, `crawl_multi_page`, `get_workflow_by_name` and `export_workflow_visualization`.
- **Crawling and analysis**: [src/crawler.ts](src/crawler.ts), [src/analyzer.ts](src/analyzer.ts), [src/heuristic-scorer.ts](src/heuristic-scorer.ts).
- **Test generation and execution**: [src/test-case-generator.ts](src/test-case-generator.ts), [src/webmcp-semantic-tools.ts](src/webmcp-semantic-tools.ts), [src/webmcp-semantic-handlers.ts](src/webmcp-semantic-handlers.ts), [src/test-executor.ts](src/test-executor.ts).
- **Locators**: [src/locator-generator.ts](src/locator-generator.ts), [src/semantic-matcher.ts](src/semantic-matcher.ts).
- **ARIA advisory**: [src/aria-collector.ts](src/aria-collector.ts), [src/aria-auditor.ts](src/aria-auditor.ts).
- **Multi-page crawling and workflows**: [src/multi-page-crawler.ts](src/multi-page-crawler.ts), [src/session-manager.ts](src/session-manager.ts), [src/login-handler.ts](src/login-handler.ts), [src/workflow-detector.ts](src/workflow-detector.ts), [src/journey-inference-engine.ts](src/journey-inference-engine.ts).
- **Not yet wired into the tools**: [src/advanced-workflow-detector.ts](src/advanced-workflow-detector.ts) (its own `WorkflowDetector` class, distinct from the one in `workflow-detector.ts`), [src/browser-pipeline.ts](src/browser-pipeline.ts), [src/performance-optimizer.ts](src/performance-optimizer.ts). They have unit tests but no tool calls them.
- **Output**: [src/markdown-exporter.ts](src/markdown-exporter.ts).
- **Types**: [src/types.ts](src/types.ts).

---

## Build System

The project is an ES module package (`"type": "module"`). There are two builds, and the server needs both.

### `npm run build`: the server

`tsc` with [tsconfig.json](tsconfig.json):

- `target` ES2022, `module` / `moduleResolution` Node16 (ES modules, so relative imports end in `.js`)
- `strict` type checking
- Writes `build/*.js` with declarations (`.d.ts`), declaration maps and source maps

### `npm run build:browser`: the analyzer bundle

esbuild bundles [src/analyzer.ts](src/analyzer.ts) and everything it imports (including `test-case-generator.ts`, `heuristic-scorer.ts` and `@huggingface/transformers`) into one IIFE, `build/analyzer.browser.js`, exposing a global `DomAnalyzerBundle`. Its settings (ES2020 target, browser platform) are flags in the `build:browser` script in [package.json](package.json). [tsconfig.browser.json](tsconfig.browser.json) records the same browser settings for type checking `analyzer.ts`; esbuild does not read it.

`SiteCrawler` reads this file from disk and injects it into every page it crawls, so any change to code the analyzer imports needs `npm run build:browser` before it takes effect.

### Scripts

| Script | What it does |
|--------|---------|
| `npm run build` | `tsc`: compile `src/` to `build/` |
| `npm run build:browser` | esbuild: bundle the analyzer to `build/analyzer.browser.js` |
| `npm start` | Both builds, then `node build/index.js` |
| `npm run dev` | `tsx src/index.ts`: run the server from source with no compile step (still needs `build/analyzer.browser.js`) |
| `npm test` | Both builds (via `pretest`), then `test:unit` and `test:integration` |
| `npm run test:unit` | `node --test test/unit/*.test.js` against `build/`; does **not** build first |
| `npm run test:integration` | `node --test test/integration/*.test.js` against `build/`; does **not** build first |
| `npm run test:coverage` | Both builds, then the unit suites with an enforced coverage floor |
| `npm run benchmark:install` | Install `benchmark/app`'s dependencies (once, before integration tests) |
| `npm run train:harvest` / `train:prepare` / `train:evaluate` | Locator model fine-tuning; see [training/README.md](training/README.md) |

There is no lint or format script, and no watch mode.

---

## Development Workflow

### Typical Edit → Build → Test Cycle

The tests import from `build/`, not `src/`, so build before running them.

```bash
# 1. Edit src/*.ts

# 2. Type check without writing files (what CI's type-check job runs)
npx tsc --noEmit

# 3. Rebuild. Also rebuild the bundle if you touched analyzer.ts or anything it imports
npm run build
npm run build:browser

# 4. Fast feedback: unit suites only (no browser, no network)
npm run test:unit

# 5. Before pushing: everything CI runs
npm run test:coverage      # unit suites + coverage floor
npm run test:integration   # needs npm run benchmark:install once, and Chrome for the crawl suites
```

`npm test` does steps 3 to 5 in one go, without the coverage floor.

Then commit on a branch and open a pull request against `trunk`; see [CONTRIBUTING.md](CONTRIBUTING.md).

### Running the Server Locally

`npm start` (or `npm run dev`) starts the server on stdio. It has no HTTP port, so you talk to it with an MCP client, not with `curl`:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

The integration suite starts its own server, so it doesn't need one running:

```bash
node --test test/integration/mcp-server.test.js
```

`test/helpers/mcp-harness.js` shows both ways to drive the server from code: `startServer()` spawns `build/index.js` and connects the SDK client over stdio; `startInProcessServer()` imports the exported `server` and connects over an in-memory transport.

### `npm run dev`

`npm run dev` runs `src/index.ts` with tsx, so changes to Node-side code need no `tsc` step. It does not watch files: restart it after an edit (MCP clients usually restart the server for you when you reconnect). Changes to the analyzer still need `npm run build:browser`, because the page runs the bundle, not the source.

To point an MCP client at the source instead of `build/`:

```json
{
  "command": "npx",
  "args": ["tsx", "/absolute/path/to/project/src/index.ts"]
}
```

---

## Architecture Deep Dive

### End-to-End Flow: `crawl_and_analyze`

```
MCP client → tools/call over stdio
        ↓
index.ts
  ├─ CrawlAndAnalyzeInput.parse(args)                 Zod validation
  ├─ SiteCrawler.init()                               start Chrome (headless unless WEBMCP_HEADED=1)
  ├─ SiteCrawler.crawlAndAnalyze(url, 25, { ariaAudit })
  │    ├─ driver.get(url)
  │    ├─ inject build/analyzer.browser.js            defines window.DomAnalyzerBundle
  │    ├─ in the page (executeAsyncScript, with a watchdog):
  │    │    ├─ DomAnalyzer.init()                     load the model: WebNN → WebGPU → WASM, else none
  │    │    └─ DomAnalyzer.analyzeCurrentPage(25)
  │    │         ├─ extract DOM, score intent, keep elements scoring ≥ 25
  │    │         ├─ ML: merge near-duplicates (similarity ≥ 0.92)
  │    │         │  or no model: HeuristicScorer.scoreElements()
  │    │         └─ TestCaseGenerator.generate(elements, document.title)
  │    ├─ SemanticHandlerGenerator.generateHandlerCode(elements)
  │    │    → executed in the page: registers navigator.webmcp.tools[...]
  │    ├─ attach browser console logs
  │    └─ if ariaAudit: collectAriaSnapshot in the page → auditAriaSnapshot
  ├─ SemanticMatcher.warmUp()                         start loading the locator model
  ├─ SiteCrawler.close()
  └─ format: JSON.stringify, MarkdownExporter.exportFull, or exportTestCasesList
```

The result is kept in `lastAnalysis` for `get_element_locator`.

### The Other Tools

- **`get_element_locator`**: `SemanticMatcher.similarities()` embeds the description and each element of `lastAnalysis` in Node; `LocatorGenerator.generateLocator()` ranks them with keyword overlap as a tie-breaker. With `WEBMCP_SEMANTIC_LOCATOR=off` or no model, keyword overlap alone.
- **`run_critical_tests`**: crawls once to find critical test cases, then crawls again in a new `SiteCrawler` so the handlers are freshly registered, and runs `TestExecutor.executeTests()`, which calls each test's `navigator.webmcp.tools` entry, retrying up to `retryCount` times.
- **`audit_aria`**: a separate `SiteCrawler` loads the page and runs `auditAria()`; the ML model is not loaded.
- **`crawl_multi_page`**: `MultiPageCrawler.crawl()`; see below. The resulting `CrawlSession` is stored in memory for one hour, keyed by `sessionId`.
- **`get_workflow_by_name`** / **`export_workflow_visualization`**: read a stored session; the export uses `MarkdownExporter.exportWorkflowSequence`, `exportWorkflowComparison` or `exportDetectedWorkflows`.

### Key Components

#### 1. SiteCrawler ([crawler.ts](src/crawler.ts))

```typescript
const crawler = new SiteCrawler();
await crawler.init();
try {
  const result: AnalysisResult = await crawler.crawlAndAnalyze("https://example.com", 25, { ariaAudit: false });
} finally {
  await crawler.close();
}
```

- `init()` starts Chrome with a temporary profile (headless unless `WEBMCP_HEADED=1`) and a WebDriver BiDi session for console log capture.
- `crawlAndAnalyze(url, intentThreshold = 25, options)` sets timeouts (`scriptTimeoutMs` 120000, `pageLoadTimeoutMs` 60000, `analyzerTimeoutMs` 90000, `analyzerInitTimeoutMs` 5000 per device, all overridable in `options`), injects and runs the analyzer, registers semantic handlers, and returns an `AnalysisResult`.
- `auditAria(url)` returns an `AriaAuditReport`.
- `getDriver()` exposes the WebDriver for `TestExecutor`, `LoginHandler` and `MultiPageCrawler`.

#### 2. DomAnalyzer ([analyzer.ts](src/analyzer.ts))

Runs inside the page, from the bundle. It is not used from Node directly.

- `init({ modelLoadTimeoutMs })` loads `Xenova/all-MiniLM-L6-v2` (or `Xenova/paraphrase-MiniLM-L3-v2` on low-resource devices), trying WebNN, WebGPU and WASM in turn. If none loads in time, analysis carries on without a model.
- `analyzeCurrentPage(intentThreshold = 25)` extracts the DOM, scores each element's intent from rules (tag, role, text, ARIA label, test-id attributes, input type, with boosts for navigation links, forms and submit buttons), keeps those scoring at least the threshold, and then:
  - with the model: embeds each element and merges those at least 0.92 similar to one already kept, never merging `input`, `button`, `a`, `textarea` or `select`;
  - without it: rescores with `HeuristicScorer`.
- It then generates test cases and returns `AnalysisResult` with `metrics`.

#### 3. TestCaseGenerator ([test-case-generator.ts](src/test-case-generator.ts))

```typescript
const testCases: GeneratedTestCase[] = TestCaseGenerator.generate(elements, pageTitle);
```

- One test case per element, with id `TC_<PAGE_TITLE>_<TAG>_<n>`.
- Priority from `intentScore`: critical ≥ 50, high ≥ 40, medium ≥ 30, low below.
- `getActionType()` picks `click`, `input`, `submit`, `navigate`, `select`, `delete` or `hover`, and a matching `generate<Action>Test()` writes the name, description, preconditions, steps and expected results.
- Critical tests also get `semanticTool` (the tool name) and `testCode`.

#### 4. SemanticToolGenerator ([webmcp-semantic-tools.ts](src/webmcp-semantic-tools.ts))

`SemanticToolGenerator.generate(elements)` makes a `SemanticToolSchema` for each critical element (`selectCritical`: intent score ≥ 50). Names are camelCase from the element's text, with a numeric suffix when two elements produce the same name.

```typescript
{
  name: "search",
  description: "...",
  actionType: "click",
  inputSchema: { /* e.g. a query parameter for search inputs */ },
  returnType: "{ success: boolean; message: string; payload?: any }"
}
```

#### 5. SemanticHandlerGenerator ([webmcp-semantic-handlers.ts](src/webmcp-semantic-handlers.ts))

`SemanticHandlerGenerator.generateHandlerCode(elements)` returns one script that creates `navigator.webmcp.tools` if needed and registers a handler per critical element, using the same names as `SemanticToolGenerator`:

```javascript
navigator.webmcp.tools["search"] = async function(params = {}) {
  // look the element up by its locator, then click / fill / submit / select / navigate
  return { success: true, message: "..." };
};
```

#### 6. LocatorGenerator and SemanticMatcher ([locator-generator.ts](src/locator-generator.ts), [semantic-matcher.ts](src/semantic-matcher.ts))

`SemanticMatcher` loads the locator model lazily in Node (15-second wait before giving up), embeds descriptions and elements, and reads `WEBMCP_SEMANTIC_LOCATOR`, `WEBMCP_LOCATOR_MODEL` and `WEBMCP_LOCATOR_MIN_SIMILARITY`. `LocatorGenerator.generateLocator(description, elements, similarities)` returns `{ selector, type, confidence, reason, matchedBy, similarity }`. A meaning-only match needs similarity of at least `MIN_SEMANTIC_SIMILARITY` (0.2) unless overridden.

#### 7. MultiPageCrawler, LoginHandler and SessionManager

```
MultiPageCrawler.crawl()
    ↓
queue: [{ url: startUrl, depth: 0 }]
    ↓
for each URL, until maxPages:
    ├─ SiteCrawler.crawlAndAnalyze(url, ...)       analyse the page
    ├─ SessionManager.addPage(page)
    ├─ if enableAutoLogin and credentials are in session state,
    │  and the page has username and password fields:
    │      LoginHandler.performLogin(username, password)
    │          ├─ findLoginFields() / fillLoginForm()
    │          ├─ submitForm()                     click submit, or submit the form
    │          ├─ waitForPageLoad()
    │          └─ validateLoginSuccess()           form gone + URL change / logout / profile
    │      → sessionState.lastLoginSuccess | lastLoginFailure | lastLoginError
    ├─ follow same-site links (and buttons that navigate)
    └─ queue unvisited URLs at depth + 1 (up to maxDepth)
    ↓
SessionManager.finalize()
    └─ WorkflowDetector.detect(session, strategy)  if detectWorkflows
JourneyInferenceEngine.inferJourneys(session)
    ↓
MultiPageCrawlResult { session, detectedWorkflows, inferredJourneys, crawlErrors, summary, performance }
```

**WorkflowDetector** ([workflow-detector.ts](src/workflow-detector.ts)): `detect()` runs the heuristic detectors (`detectAuthFlows`, `detectFormSubmissionFlows`, `detectNavigationPatterns`, `detectNavMenuJourneys`, `detectMultiStepForms`) when the strategy is `heuristic` or `both`, then deduplicates and prunes workflows contained in others. ML-based detection is a TODO: the `ml-based` branch adds nothing yet. Results are cached by page sequence (`clearCache()`, `getCacheStats()`). `isLoginFormPage(page)` is the static login-page check.

**LoginHandler** ([login-handler.ts](src/login-handler.ts)): `findLoginFields()`, `findSubmitButton()`, `fillLoginForm(username, password)` (handles custom select-style widgets too), `submitForm()`, `waitForPageLoad(timeoutMs)`, `validateLoginSuccess(...)` and `performLogin(...)`, which does the whole sequence.

**SessionManager** ([session-manager.ts](src/session-manager.ts)): `updateState(key, value)` / `getState()` for session state (credentials go in as `username` and `password`), `addPage()`, `recordNavigation()`, `isVisited()` / `markAsVisited()`, `getUnvisitedLinks()`, `finalize()`, and `toJSON()` / `fromJSON()`.

---

## Adding Features

### Adding a New Action Type

Example: a `drag-drop` action.

There is no shared `ActionType` alias; the union `'click' | 'input' | 'submit' | 'navigate' | 'delete' | 'select' | 'hover'` is written out in each type that uses it.

1. **[src/types.ts](src/types.ts)**: add `'drag-drop'` to the `actionType` union on `SemanticToolSchema`, `GeneratedTestCase` and `WorkflowAction`.
2. **[src/test-case-generator.ts](src/test-case-generator.ts)**: detect it in `getActionType()` (for example, `el.attributes?.draggable === "true"`), add a `generateDragDropTest()` alongside `generateClickTest()` and the others, and add its case to the `switch` in `generateFromElement()`.
3. **[src/webmcp-semantic-tools.ts](src/webmcp-semantic-tools.ts)**: return it from `inferActionType()` and give it an input schema in `generateInputSchema()` if it takes parameters (a target locator, say).
4. **[src/webmcp-semantic-handlers.ts](src/webmcp-semantic-handlers.ts)**: return it from `inferActionType()` and add a `generateDragDropHandler()`, used by `generateHandlerFunction()`, that dispatches `dragstart` / `drop` events.
5. **Tests**: extend `test/unit/test-case-generator.test.js`, `semantic-tools.test.js` and `semantic-handlers.test.js`.
6. Rebuild both bundles: the test case generator runs in the page.

### Modifying Scoring Logic

There are two places, and which one runs depends on whether the model loaded:

- **[src/analyzer.ts](src/analyzer.ts)**, `collectHighIntentElements()`: the in-page intent score used on every run. Each rule adds points to `intentScore` and a line to `intentReasons`. The keep threshold (25) is passed in from `SiteCrawler.crawlAndAnalyze()`.
- **[src/heuristic-scorer.ts](src/heuristic-scorer.ts)**, `HeuristicScorer.scoreElement()`: the rescoring used when the model is unavailable. Weights are in tables such as:

  ```typescript
  const tagScores: Record<string, number> = {
    button: 50,
    a: 40,
    input: 45,
    textarea: 40,
    select: 45,
    form: 35,
  };
  ```

Priority cut-offs are in `TestCaseGenerator.getPriority()`, and the critical cut-off for tools in `SemanticToolGenerator.selectCritical()`. Both are 50; change them together.

After a change, rebuild the bundle (`npm run build:browser`) and run `test/unit/locator-and-scoring.test.js`, `analyzer-analysis.test.js` and the integration journeys (`test/integration/benchmark-journeys.test.js`), which check the crawler still finds the benchmark app's ground-truth journeys.

### Creating a New MCP Tool

Example: an `analyze_performance` tool. All of it is in [src/index.ts](src/index.ts).

**Step 1:** Add a Zod input schema with the others:

```typescript
const AnalyzePerformanceInput = z.object({
  url: z.string().url({ message: "A valid URL is required." }),
});
```

**Step 2:** Advertise the tool in the `ListToolsRequestSchema` handler's `tools` array, with a JSON Schema that matches the Zod schema:

```typescript
{
  name: "analyze_performance",
  description: "Analyze page performance metrics.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "The fully-qualified URL to analyze." },
    },
    required: ["url"],
  },
},
```

**Step 3:** Handle it in the `CallToolRequestSchema` handler, before the final `Unknown tool` return:

```typescript
if (name === "analyze_performance") {
  const { url } = AnalyzePerformanceInput.parse(args);

  const perfCrawler = new SiteCrawler();
  try {
    await perfCrawler.init();
    const result = await perfCrawler.crawlAndAnalyze(url);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.metrics ?? {}, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: `Performance analysis failed: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  } finally {
    await perfCrawler.close();
  }
}
```

**Step 4:** Add the tool to `EXPECTED_TOOLS` in `test/integration/mcp-server.test.js` (it checks the advertised list exactly), add handler tests in `test/unit/mcp-handlers.test.js`, and document it in [README.md](README.md) and [USAGE.md](USAGE.md).

---

## Code Style & Conventions

### TypeScript

- `strict` mode is on. Give parameters and return values explicit types; avoid `any` in new code.
- Use **interfaces** for data that crosses module or process boundaries (most live in [src/types.ts](src/types.ts)) and **type aliases** for unions.
- Use descriptive names: `highIntentElements`, not `arr`.
- Comment the why, especially for scoring rules and timeouts.

### Imports

The project compiles to ES modules with Node16 resolution, so relative imports name the compiled `.js` file:

```typescript
// src/index.ts
import { SiteCrawler } from "./crawler.js";
import { AnalysisResult } from "./types.js";
```

Use named exports.

### Shared Types

[src/types.ts](src/types.ts) is compiled into both the Node build and the browser bundle, so it must not use Node-only or browser-only APIs. Code that `analyzer.ts` imports is bundled for the browser under the same rule.

### Logging

stdout is the MCP protocol stream. In Node-side code, log with `console.error`, which goes to stderr. In code that runs in the page, `console.log` is fine: the crawler collects it into `consoleLogs`.

### Error Handling

Throw `Error` objects with a clear message, not strings:

```typescript
if (!this.driver) {
  throw new Error("SiteCrawler is not initialized. Call init() first.");
}
```

In tool handlers, turn a failure into a result with `isError: true` and a message, rather than letting it escape. Advisory output (the ARIA audit) is never an error.

---

## Running Tests

[test/README.md](test/README.md) has the full description. In short:

```bash
npm test                   # both builds, then unit + integration
npm run test:unit          # unit suites only; build first
npm run test:integration   # integration suites only; build first
npm run test:coverage      # both builds, then unit suites with an enforced coverage floor
```

- **Unit suites** (`test/unit/`) need no browser and no network. They use the helpers in `test/helpers/` (a fake DOM, a Transformers.js stub, an in-process MCP server).
- **Integration suites** (`test/integration/`) start the BenchmarkShop app from `benchmark/app` (run `npm run benchmark:install` once). `mcp-server.test.js` spawns `build/index.js` and talks to it over stdio; the crawl and journey suites need Chrome.
- **Coverage**: CI runs `test:coverage` instead of `test:unit`. The floor only goes up; raise it when coverage rises, never lower it to pass.
- **Manual scripts** (`test/manual/`) are for exploring real sites and are not run in CI.

To run one suite:

```bash
npm run build && npm run build:browser
node --test test/unit/locator-and-scoring.test.js
```

### What CI Runs

| Workflow | Steps |
|---|---|
| `build.yml` | `npm ci`, `npm run build`, `npm run build:browser` on Node 18, 20 and 22 |
| `test.yml` | `npx tsc --noEmit`; both builds then `npm run test:coverage`; `npm run benchmark:install`, both builds, then `npm run test:integration` with Chrome |

### Debugging

- Set `WEBMCP_HEADED=1` to watch Chrome while a crawl runs.
- Analyzer logs (`[analyzer] ...`) come back in `consoleLogs` in the `crawl_and_analyze` JSON output.
- Node-side logs go to stderr; with an MCP host, look in its server log.
- To debug a tool handler with a normal stack trace, drive the server in-process with `startInProcessServer()` from `test/helpers/mcp-harness.js`.

---

## Common Tasks

### Update Dependencies

```bash
npm update
npm audit fix
```

### Rebuild the Browser Bundle

```bash
npm run build:browser
# writes build/analyzer.browser.js
```

### Type Check Without Building

```bash
npx tsc --noEmit
```

---

## Resources

- **TypeScript Handbook**: <https://www.typescriptlang.org/docs/>
- **MCP TypeScript SDK**: <https://github.com/modelcontextprotocol/typescript-sdk>
- **MCP Inspector**: <https://github.com/modelcontextprotocol/inspector>
- **Transformers.js**: <https://huggingface.co/docs/transformers.js>
- **Selenium WebDriver**: <https://www.selenium.dev/documentation/webdriver/>
- **Zod**: <https://zod.dev/>

---

## Getting Help

- Check existing issues and pull requests on GitHub.
- See [USAGE.md](USAGE.md) for tool inputs, outputs and examples.
- The test suites are the most up-to-date examples of how each module is used.
