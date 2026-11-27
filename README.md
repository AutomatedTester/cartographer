# Cartographer

**Maps your site, then tells you what to test.**

Point Cartographer at a URL and it charts the site: the pages, the user journeys that run through them, and the elements most likely to break. It hands back prioritised test cases, stable locators you can find by describing an element in plain English, and an optional ARIA review.

Under the hood it is a local **Model Context Protocol (MCP)** server that combines **Selenium** browser automation with a **local ML model** (via [Transformers.js](https://huggingface.co/docs/transformers.js)) to crawl a website, analyse its DOM, and generate a prioritised list of test candidates.

---

## Quick Start

Get up and running in 5 minutes:

```bash
# 1. Install dependencies
npm install

# 2. Build the project
npm run build

# 3. Start the MCP server (builds first)
npm start
```

Then configure your MCP client (e.g., Claude Desktop) to use this server—see [Client Configuration](#client-configuration) below.

For detailed usage examples and API reference, see [USAGE.md](USAGE.md).

---

## Key Features

- **Automated Web Crawling**: Headless Chrome via Selenium extracts pages and DOM structure, one page or a whole site
- **Workflow Detection**: Multi-page crawls find user journeys (login, registration, checkout, search) and can log in with supplied credentials
- **Intelligent Element Analysis**: ML-powered semantic scoring identifies high-risk/high-value elements on the page
- **Test Case Generation**: Automatically generates structured test cases with:
  - Priority levels (critical, high, medium, low) based on intent scores
  - Action type detection (click, input, submit, form interaction, etc.)
  - Contextual preconditions and expected results
  - Semantic tool references for execution
- **Semantic WebMCP Tools**: Auto-generated domain-specific tools for browser-side execution
- **Multiple Output Formats**: JSON, detailed Markdown reports, or summary Markdown
- **Natural Language Locators**: Find stable CSS/XPath selectors for any element by describing it
- **ARIA Advisory**: Opt-in review that flags ARIA likely to mislead assistive-technology users

---

## Documentation Map

| Document | Use Case |
|----------|----------|
| **This README** | Project overview, quick start, MCP tool reference |
| **[USAGE.md](USAGE.md)** | Comprehensive guide to using the library, API reference, examples, troubleshooting |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | Instructions for contributors: setup, architecture, development workflow, adding features |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Guidelines for reporting issues and submitting pull requests |
| **[test/README.md](test/README.md)** | How the unit and integration suites, coverage floor and benchmark app fit together |
| **[training/README.md](training/README.md)** | Fine-tuning the embedding model used by `get_element_locator` |

---

## Architecture

Core modules that work together:

| File | Responsibility |
|---|---|
| `src/crawler.ts` | `SiteCrawler` – headless Chrome via Selenium, injects the analyzer bundle and extracts DOM snapshots |
| `src/analyzer.ts` | `DomAnalyzer` – runs in the page; semantic ML scoring via `Xenova/all-MiniLM-L6-v2` (`paraphrase-MiniLM-L3-v2` on low-resource devices), with heuristic fallback |
| `src/heuristic-scorer.ts` | Rule-based intent scoring used when the model is unavailable |
| `src/locator-generator.ts` | Builds stable CSS/XPath locators for scored elements |
| `src/semantic-matcher.ts` | `SemanticMatcher` – embedding similarity for `get_element_locator` |
| `src/test-case-generator.ts` | `TestCaseGenerator` – creates structured test cases from high-intent elements |
| `src/webmcp-semantic-tools.ts` | `SemanticToolGenerator` – auto-generates domain-specific MCP tools |
| `src/webmcp-semantic-handlers.ts` | `SemanticHandlerGenerator` – creates browser-side handlers for tools |
| `src/aria-collector.ts` | `collectAriaSnapshot` – runs in the page; resolves roles, focusability, names and id references for elements carrying ARIA |
| `src/aria-auditor.ts` | `auditAriaSnapshot` – advisory ARIA rules; for each problem, the user impact, advice and what removing the ARIA would lose |
| `src/markdown-exporter.ts` | `MarkdownExporter` – formats output in multiple formats (JSON/Markdown) |
| `src/test-executor.ts` | `TestExecutor` – orchestrates test execution in browser context |
| `src/multi-page-crawler.ts` | `MultiPageCrawler` – breadth-first, same-site crawl across many pages |
| `src/login-handler.ts` / `src/session-manager.ts` | Detects and fills login forms; keeps credentials and cookies for a crawl |
| `src/workflow-detector.ts` / `src/advanced-workflow-detector.ts` / `src/journey-inference-engine.ts` | Detect user workflows across crawled pages |
| `src/browser-pipeline.ts` / `src/embedding-cache.ts` / `src/performance-optimizer.ts` | Browser-side analysis pipeline, embedding cache and performance tuning |
| `src/index.ts` | MCP server entry point; exposes seven MCP tools over stdio |

Supporting directories: `benchmark/` (BenchmarkShop, the local fixture site the integration tests crawl, plus its ground-truth journeys), `test/` and `training/`.

---

## Prerequisites

- Node.js ≥ 18 (CI runs 18, 20 and 22)
- Google Chrome installed (Selenium Manager handles chromedriver automatically)

---

## Development Setup

For detailed setup and development workflow, see [DEVELOPMENT.md](DEVELOPMENT.md).

Quick build variants:

```bash
npm run build             # Compile TypeScript
npm run build:browser     # Bundle the analyzer for browser injection (build/analyzer.browser.js)
npm start                 # Both builds, then start the MCP server
npm run dev               # Run with tsx (still needs build/analyzer.browser.js from build:browser)
npm test                  # Both builds, then unit + integration suites
npm run test:unit         # Unit suites only (no browser, no network)
npm run test:coverage     # Unit suites with an enforced coverage floor
npm run benchmark:install # One-off: install the benchmark app needed by the integration suites
```

Model fine-tuning scripts (`train:harvest`, `train:prepare`, `train:evaluate`) are described in [training/README.md](training/README.md).

---

## Environment Variables

All are optional. Settings written for the old WebMCP-Selenium name (`WEBMCP_*`) are still read when the `CARTOGRAPHER_*` one is unset.

| Variable | Effect |
|---|---|
| `CARTOGRAPHER_HEADED=1` | Show the Chrome window instead of running headless |
| `CARTOGRAPHER_SEMANTIC_LOCATOR=off` | `get_element_locator` uses keyword matching only (`0` and `false` also work) |
| `CARTOGRAPHER_LOCATOR_MODEL` | Embedding model for `get_element_locator`: a Hugging Face id or a local directory, such as a fine-tuned model |
| `CARTOGRAPHER_LOCATOR_MIN_SIMILARITY` | Minimum similarity for a meaning-only locator match; set it for a fine-tuned model |
| `HF_TOKEN` | Hugging Face token, needed only for a private `CARTOGRAPHER_LOCATOR_MODEL` |

---

## MCP Tools

### 1. `crawl_and_analyze`

Crawls a URL with headless Chrome, analyses the DOM, flags brittle elements, and generates test cases.

**Input**

```json
{
  "url": "https://example.com",
  "format": "json",
  "ariaAudit": false
}
```

`format` is `markdown` (default), `json` or `markdown-summary`. `ariaAudit` adds the `audit_aria` advisory to the result.

**Output**: Prioritised test cases with intent scores, action types, and preconditions. See [USAGE.md](USAGE.md#tool-1-crawl_and_analyze) for full documentation and examples.

### 2. `get_element_locator`

Returns the most stable CSS/XPath locator for an element described in natural language, based on the most recent crawl.

**Input**

```json
{
  "description": "the submit button in the login form"
}
```

Call `crawl_and_analyze` first; this tool looks up elements from the most recent crawl.

**Output**: Stable CSS or XPath locator string. See [USAGE.md](USAGE.md#tool-2-get_element_locator) for examples.

Elements are matched by meaning as well as by shared words, so "checkout button" can find a button labelled "Proceed to payment". This uses a local embedding model (`Xenova/all-MiniLM-L6-v2`, about 23 MB, downloaded from Hugging Face on first use). Set `CARTOGRAPHER_SEMANTIC_LOCATOR=off` to use keyword matching only. To train your own model for this, see [training/README.md](training/README.md).

### 3. `run_critical_tests`

Crawls the URL afresh, then executes its critical test cases (intent score ≥ 50) using auto-generated semantic tools. Tests are run directly in the browser via native DOM APIs.

**Input**

```json
{
  "url": "https://example.com",
  "testIds": ["test-1", "test-2"],
  "retryCount": 1,
  "format": "json"
}
```

Only `url` is required. `testIds` limits the run to those tests; `retryCount` (default 0) re-runs a failing test up to that many more times; `format` is `json` (default) or `markdown`.

**Output**: Test execution results with pass/fail status. See [USAGE.md](USAGE.md#tool-3-run_critical_tests) for details.

### 4. `audit_aria`

Advisory review of the ARIA on a page. The first rule of ARIA is that no ARIA is better than bad ARIA, and this tool points out the bad ARIA: roles, states and references likely to mislead someone using a screen reader, voice control or a keyboard.

It only runs when requested, either by calling `audit_aria` or by passing `"ariaAudit": true` to `crawl_and_analyze`. It gives advice and never fails a run.

**Input**

```json
{
  "url": "https://example.com",
  "format": "markdown"
}
```

**Output**: An advisory per problem. Each one gives:

- what is wrong;
- what a user experiences;
- what to do instead;
- what would be lost if the ARIA were simply removed.

Advisories where deleting the ARIA loses nothing are counted separately. See [USAGE.md](USAGE.md#tool-4-audit_aria).

### 5. `crawl_multi_page`

Crawls a site breadth-first from a start URL, staying on the same site, analyses each page, and detects user workflows across pages. With `credentials` it finds the login form and signs in before crawling protected pages.

**Input**

```json
{
  "startUrl": "https://example.com",
  "maxPages": 10,
  "maxDepth": 3,
  "workflowStrategy": "both",
  "credentials": { "username": "user", "password": "secret" },
  "format": "json"
}
```

Only `startUrl` is required.

| Option | Default | Notes |
|---|---|---|
| `maxPages` | 10 | 2–50 |
| `maxDepth` | 3 | 1–5 |
| `pageLoadTimeout` | 30000 | ms |
| `scriptTimeoutMs` | 120000 | ms, Selenium async-script timeout |
| `analysisTimeoutMs` | 90000 | ms, in-page analyzer watchdog |
| `modelLoadTimeoutMs` | 5000 | ms before falling back to heuristic scoring |
| `detectWorkflows` | `true` | |
| `workflowStrategy` | `both` | `heuristic`, `ml-based` or `both` |
| `enableAutoLogin` | `true` | Only acts when `credentials` are given |
| `format` | `json` | or `markdown` |

**Output**: Per-page analysis and detected workflows, plus a `sessionId`. Sessions are kept in memory for one hour.

### 6. `get_workflow_by_name`

Returns one detected workflow from a `crawl_multi_page` session.

```json
{
  "sessionId": "session_…",
  "workflowName": "login_flow"
}
```

### 7. `export_workflow_visualization`

Exports the workflows from a `crawl_multi_page` session as Markdown, with page sequences, actions and flow diagrams.

```json
{
  "sessionId": "session_…",
  "workflowIds": ["…"],
  "format": "full"
}
```

`workflowIds` is optional (default: all). `format` is `individual`, `comparison` or `full` (default).

---

## Client Configuration

Add the following to your `claude_desktop_config.json` (or equivalent MCP client settings):

```json
"cartographer": {
  "command": "node",
  "args": ["/path/to/project/build/index.js"]
}
```

Replace `/path/to/project` with the absolute path to this repository, and run `npm run build && npm run build:browser` first: the server injects `build/analyzer.browser.js` into each page it crawls.
