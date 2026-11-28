# Cartographer

**Maps your site, then tells you what to test.**

Cartographer is an MCP server. Give it a URL and it crawls the site in Chrome, then tells you what to test there.

**What you get back**

- **Test cases, in priority order.** It looks for the elements most likely to break and writes a test case for each. Use [`crawl_and_analyze`](#1-crawl_and_analyze).
- **User journeys.** It crawls a whole site and finds flows that span several pages, such as login, sign-up, checkout and search. It can sign in first if you give it credentials. Use [`crawl_multi_page`](#5-crawl_multi_page).
- **Stable locators.** Describe an element in plain English ("checkout button") and get back a CSS or XPath selector. Use [`get_element_locator`](#2-get_element_locator).
- **An ARIA review (optional).** It flags ARIA that is likely to mislead screen-reader users. Use [`audit_aria`](#4-audit_aria).

**How it works**

- It runs on your machine and talks to your MCP client (such as Claude Desktop or Claude Code) over stdio.
- [Selenium](https://www.selenium.dev/) drives a headless Chrome to load pages and read the DOM.
- Small embedding models score elements and match descriptions. They run locally through [Transformers.js](https://huggingface.co/docs/transformers.js) and are downloaded from Hugging Face on first use. Page content is never sent to a remote model.

---

## Before you crawl

Cartographer drives a real browser against a real site. Read this first.

- **Only crawl sites you are authorised to test.** Your own site, or one whose owner has said yes.
- **There is no rate limiting, and `robots.txt` is not read.** A multi-page crawl loads pages as fast as Chrome can. Keep `maxPages` small on sites you don't run.
- **Crawls click things.** `crawl_multi_page` clicks buttons to find where they lead. `run_critical_tests` clicks, types and submits forms on the live page. Point both at a test or staging site, not production.
- **Use a test account.** Anything you pass as `credentials` is a tool argument, and tool arguments stay in your MCP client's chat history. Never use a real person's password.
- **Fence off what must not be touched.** Give `crawl_multi_page` an `excludeUrlPatterns` list to keep it out of admin pages and anything destructive. By default it already skips links and buttons that look like log out, delete or remove, unsubscribe, and place order, buy now or pay.

---

## Quick Start

You need **Node.js 22 or later** and **Google Chrome**.

```bash
# 1. Install dependencies
npm install

# 2. Build the server and the in-page analyzer bundle
npm run build:all
```

`build:all` runs `npm run build` (TypeScript) and `npm run build:browser` (the analyzer bundle). You need both. The server injects `build/analyzer.browser.js` into every page it crawls, and a crawl fails without it.

Then connect your MCP client. See [Client Configuration](#client-configuration) below. Your client starts the server itself, so you don't need to keep a terminal open.

**Want to check it starts?** Run `npm start`. It builds, then prints `Cartographer MCP server running on stdio` and waits. That silence is expected, not a hang: it is a stdio server waiting for an MCP client to talk to it. Stop it with Ctrl+C.

For examples of every tool, with real output, see [USAGE.md](USAGE.md).

---

## Client Configuration

Each setup needs the absolute path to `build/index.js` in your clone. Run `npm run build:all` first.

### Claude Code

```bash
claude mcp add cartographer -- node /absolute/path/to/cartographer/build/index.js
```

Add `--scope user` to use it in every project, or `--scope project` to share it through a `.mcp.json` file. Check it with `claude mcp get cartographer`.

### Claude Desktop

Add this to `claude_desktop_config.json`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "cartographer": {
      "command": "node",
      "args": ["/absolute/path/to/cartographer/build/index.js"]
    }
  }
}
```

If you already have other servers, add the `"cartographer"` entry inside your existing `"mcpServers"` object.

Claude Desktop does not load your shell profile. If it can't find `node` (common with nvm), put the full path from `which node` in `"command"`.

### Other MCP clients

Any client that can launch a stdio server works. The command is `node`, and the only argument is the path to `build/index.js`. To set [environment variables](#environment-variables), use your client's `env` setting.

---

## First run: downloads and network

The first crawl fetches a few things. After that, most of it is cached.

| What | From | When | Cached |
|---|---|---|---|
| chromedriver | Selenium Manager | First crawl | Yes, in `~/.cache/selenium` |
| Locator model `Xenova/all-MiniLM-L6-v2` (quantised, about 23 MB) | Hugging Face | First `crawl_and_analyze` (it starts loading after the crawl) | Yes, in `node_modules/@huggingface/transformers/.cache` |
| Scoring model, the same model at full precision (about 90 MB) | Hugging Face, plus the ONNX runtime from cdn.jsdelivr.net | Every crawl, inside the crawled page | No. Each crawl uses a fresh Chrome profile |

**If a download fails** (offline, a proxy, a firewall, or a site whose Content-Security-Policy blocks the request), Cartographer keeps working:

- **Page scoring** falls back to rule-based heuristic scoring. The report shows `Analysis Device: none (heuristic scoring — ML unavailable)`. The test cases are still produced. The in-page model gets 5 seconds per backend to load before the fallback; on `crawl_multi_page` you can raise this with `modelLoadTimeoutMs`. Expect the fallback on most crawls unless the download is fast.
- **`get_element_locator`** uses keyword matching only. Its output ends with `(keyword only)`.
- **chromedriver** is the exception. Without it Chrome can't start. If Selenium Manager can't download it, put a chromedriver that matches your Chrome on your `PATH`.

### Plain `http://` sites

Chrome's HTTPS-First mode tries `https://` before `http://`. On an http-only site whose `https://` address fails (for example, a certificate for another name), the page doesn't load and the tool reports `Chrome could not load … and showed its error page instead`. Local sites on `http://localhost` work.

A URL without a scheme gets `https://` added, so write `http://` yourself for http-only sites.

---

## Key Features

- **Automated Web Crawling**: Headless Chrome via Selenium extracts pages and DOM structure, one page or a whole site
- **Workflow Detection**: Multi-page crawls find user journeys (login, registration, checkout, search) and can log in with supplied credentials
- **Element Analysis**: Rule-based intent scoring finds high-risk/high-value elements, with an embedding model to merge near-duplicates when it loads
- **Test Case Generation**: Automatically generates structured test cases with:
  - Priority levels (critical, high, medium, low) based on intent scores
  - Action type detection (click, input, submit, form interaction, etc.)
  - Contextual preconditions and expected results
  - Semantic tool references for execution
- **Semantic WebMCP Tools**: Auto-generated domain-specific tools for browser-side execution
- **Readable by default**: Every tool returns Markdown unless you ask for JSON
- **Natural Language Locators**: Find stable CSS/XPath selectors for any element by describing it
- **ARIA Advisory**: Opt-in review that flags ARIA likely to mislead assistive-technology users

---

## Documentation Map

| Document | Use Case |
|----------|----------|
| **This README** | Project overview, safety, setup, MCP tool reference |
| **[USAGE.md](USAGE.md)** | Every tool with example arguments and real output, plus troubleshooting |
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
| `src/analyzer.ts` | `DomAnalyzer` – runs in the page; rule-based intent scoring, with `Xenova/all-MiniLM-L6-v2` (`paraphrase-MiniLM-L3-v2` on low-resource devices) to merge near-duplicates, and a heuristic fallback |
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

- Node.js 22 or later (CI runs 22 and 24). Node 18 and 20 are end-of-life.
- Google Chrome installed (Selenium Manager handles chromedriver automatically)

---

## Development Setup

For detailed setup and development workflow, see [DEVELOPMENT.md](DEVELOPMENT.md).

Quick build variants:

```bash
npm run build             # Compile TypeScript
npm run build:browser     # Bundle the analyzer for browser injection (build/analyzer.browser.js)
npm run build:all         # Both of the above
npm start                 # Both builds, then start the MCP server (waits silently for a client)
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

All seven tools share these rules:

- **Markdown by default.** Tools return readable Markdown. Where JSON is offered, you get it only by passing `"format": "json"`. JSON from `crawl_multi_page` is very large, so ask for it only when a program will read it.
- **Errors are results.** A failure comes back as a normal tool result with `isError: true` and a one-line message, such as a bad URL, a page Chrome could not load, or an unknown session.
- **URLs without a scheme are fine.** `example.com` becomes `https://example.com`.

### 1. `crawl_and_analyze`

Crawls a URL with headless Chrome, analyses the DOM, flags brittle elements, and generates test cases.

**Input**

```json
{
  "url": "https://example.com",
  "format": "markdown",
  "ariaAudit": false
}
```

`format` is `markdown` (default), `markdown-summary` or `json`. `ariaAudit` adds the `audit_aria` advisory to the result.

**Output**: Prioritised test cases with intent scores, action types, and preconditions. See [USAGE.md](USAGE.md#crawl_and_analyze) for an example.

### 2. `get_element_locator`

Returns the most stable CSS/XPath locator for an element described in natural language.

**Input**

```json
{
  "description": "the submit button in the login form"
}
```

It searches the page from the most recent `crawl_and_analyze` call, and only that page. Pages from `crawl_multi_page` or `run_critical_tests` are not used. Call `crawl_and_analyze` first.

**Output**: Text lines `Locator:`, `Type:`, `Confidence:`, `Reason:` and `Matched by:`. If nothing on the page matches, the result is an error. See [USAGE.md](USAGE.md#get_element_locator).

Elements are matched by meaning as well as by shared words, so "checkout button" can find a button labelled "Proceed to payment". This uses a local embedding model (`Xenova/all-MiniLM-L6-v2`, about 23 MB, downloaded from Hugging Face on first use). Set `CARTOGRAPHER_SEMANTIC_LOCATOR=off` to use keyword matching only. To train your own model for this, see [training/README.md](training/README.md).

### 3. `run_critical_tests`

Crawls the URL once, then runs its critical test cases (intent score ≥ 50) in that browser, using auto-generated semantic tools. It does not need an earlier `crawl_and_analyze`.

This clicks, types and submits forms on the live page. Tests tagged `destructive` (delete actions) are skipped. Use a test site.

**Input**

```json
{
  "url": "https://staging.example.com",
  "testIds": ["TC_BENCHMARKSHOP_BUTTON_3"],
  "retryCount": 1,
  "format": "markdown"
}
```

Only `url` is required. `testIds` limits the run to those tests; IDs come from `crawl_and_analyze` output and look like `TC_BENCHMARKSHOP_BUTTON_3`. If none of the IDs match, the result is an error that lists the valid IDs. `retryCount` (default 0) re-runs a failing test up to that many more times. `format` is `markdown` (default) or `json`.

**Output**: Totals, then pass or fail per test with the semantic tool it called. See [USAGE.md](USAGE.md#run_critical_tests).

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

Advisories where deleting the ARIA loses nothing are counted separately. See [USAGE.md](USAGE.md#audit_aria).

### 5. `crawl_multi_page`

Crawls a site breadth-first from a start URL, staying on the same site, analyses each page, and detects user workflows across pages. With `credentials` it finds the login form and signs in before crawling protected pages.

**Input**

```json
{
  "startUrl": "https://staging.example.com",
  "maxPages": 10,
  "maxDepth": 3,
  "excludeUrlPatterns": ["/admin", "/account/delete"],
  "credentials": { "username": "test-user@example.com", "password": "test-account-password" }
}
```

Only `startUrl` is required. `url` is accepted as another name for it.

| Option | Default | Notes |
|---|---|---|
| `maxPages` | 10 | 2–50 |
| `maxDepth` | 3 | 1–5 |
| `excludeUrlPatterns` | none | Regular expressions. A URL that matches any of them is never visited |
| `pageLoadTimeout` | 30000 | ms |
| `scriptTimeoutMs` | 120000 | ms, Selenium async-script timeout |
| `analysisTimeoutMs` | 90000 | ms, in-page analyzer watchdog |
| `modelLoadTimeoutMs` | 5000 | ms per backend before falling back to heuristic scoring |
| `detectWorkflows` | `true` | |
| `workflowStrategy` | `both` | `heuristic`, `ml-based` or `both` |
| `enableAutoLogin` | `true` | Only acts when `credentials` are given |
| `credentials` | none | `{ "username", "password" }`. Use a test account. They are never included in the output |
| `format` | `markdown` | or `json` (very large) |

Even without `excludeUrlPatterns`, the crawler never follows or clicks links and buttons that look like log out or sign out, delete or remove, unsubscribe, or place order, buy now or pay.

**Output**: A summary, the detected workflows and inferred journeys, and a `sessionId`. Sessions are kept in memory for one hour, and are lost when the server restarts.

### 6. `get_workflow_by_name`

Returns one detected workflow from a `crawl_multi_page` session.

```json
{
  "sessionId": "session_…",
  "workflowName": "navigation_menu_exploration"
}
```

`workflowName` takes a workflow's name or its ID. Several workflows can share a name (for example, two `form_submission_flow`s on different pages). A name returns the highest-confidence one, plus a note listing the IDs of the others. Pass an ID to get a specific one.

### 7. `export_workflow_visualization`

Exports the workflows from a `crawl_multi_page` session as Markdown, with page sequences, actions and flow diagrams.

```json
{
  "sessionId": "session_…",
  "workflowIds": ["navigation_menu_exploration"],
  "format": "full"
}
```

`workflowIds` is optional (default: all), and takes workflow names or IDs. `format` is `individual`, `comparison` or `full` (default).
