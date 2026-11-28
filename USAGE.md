# Usage Guide

How to set up Cartographer and use each of its seven MCP tools, with example arguments and real output.

Cartographer is an MCP server and nothing else. It speaks MCP over stdio to a client such as Claude Code or Claude Desktop. It has no HTTP API, and it is not a library you import. You use it by asking your MCP client to call its tools, or by calling them from any MCP client.

Read [Before you crawl](README.md#before-you-crawl) in the README first. Crawls click buttons and `run_critical_tests` submits forms, so use a site you are allowed to test, preferably a test or staging copy.

## Contents

1. [Setup](#setup)
2. [How the tools fit together](#how-the-tools-fit-together)
3. [Tool reference](#tool-reference)
4. [How scoring works](#how-scoring-works)
5. [Models, downloads and offline use](#models-downloads-and-offline-use)
6. [Troubleshooting](#troubleshooting)

---

## Setup

You need Node.js 22 or later and Google Chrome.

```bash
git clone https://github.com/AutomatedTester/cartographer.git
cd cartographer
npm install
npm run build:all   # TypeScript build + the in-page analyzer bundle
```

Both builds are needed. The server injects `build/analyzer.browser.js` into every page it crawls.

Then register the server with your client.

**Claude Code**

```bash
claude mcp add cartographer -- node /absolute/path/to/cartographer/build/index.js
```

**Claude Desktop** (`claude_desktop_config.json`, then restart the app)

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

If Claude Desktop can't find `node`, use the full path that `which node` prints.

The client starts and stops the server. If you run `npm start` yourself, it prints `Cartographer MCP server running on stdio` and then waits silently for a client. That is expected. Stop it with Ctrl+C.

### Environment variables

All are optional. Set them in your client's `env` block, or on the command line for `npm start`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `CARTOGRAPHER_HEADED` | unset | Set to `1` to show the Chrome window instead of running headless |
| `CARTOGRAPHER_SEMANTIC_LOCATOR` | on | `off`, `0` or `false` makes `get_element_locator` use keyword matching only |
| `CARTOGRAPHER_LOCATOR_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model for `get_element_locator`: a Hugging Face id or a local directory |
| `CARTOGRAPHER_LOCATOR_MIN_SIMILARITY` | model default | Minimum similarity for a meaning-only locator match |
| `HF_TOKEN` | unset | Hugging Face token for a private `CARTOGRAPHER_LOCATOR_MODEL` |

Older `WEBMCP_*` names are still read when the `CARTOGRAPHER_*` one is unset. Timeouts are per-call options on `crawl_multi_page`, not environment variables.

With Claude Code, for example:

```bash
claude mcp add cartographer -e CARTOGRAPHER_HEADED=1 -- node /absolute/path/to/cartographer/build/index.js
```

---

## How the tools fit together

| Tool | Opens Chrome? | Depends on |
|---|---|---|
| `crawl_and_analyze` | Yes, one page | Nothing |
| `get_element_locator` | No | The most recent `crawl_and_analyze` |
| `run_critical_tests` | Yes, one page | Nothing. It crawls the page itself |
| `audit_aria` | Yes, one page | Nothing |
| `crawl_multi_page` | Yes, many pages | Nothing |
| `get_workflow_by_name` | No | A `sessionId` from `crawl_multi_page` |
| `export_workflow_visualization` | No | A `sessionId` from `crawl_multi_page` |

Rules that apply to every tool:

- **Markdown by default.** Tools that can return JSON do so only when you pass `"format": "json"`.
- **Errors are results.** A failure comes back as a tool result with `isError: true` and a one-line message.
- **URLs without a scheme get `https://`.** `example.com` becomes `https://example.com`. Write `http://` yourself for http-only sites.
- **State lives in memory.** The last `crawl_and_analyze` result and `crawl_multi_page` sessions (kept for one hour) are lost when the server restarts.

A typical conversation: crawl a page, ask for a few locators, then run the critical tests.

---

## Tool reference

The examples below were crawled from BenchmarkShop, the fixture site in `benchmark/app` (start it with `npm run benchmark:install` once, then `npm --prefix benchmark/app start`). Output is abridged.

### crawl_and_analyze

Loads one page in headless Chrome, scores its interactive elements, and writes a test case for each.

| Argument | Required | Default | Notes |
|---|---|---|---|
| `url` | Yes | | |
| `format` | No | `markdown` | `markdown`, `markdown-summary` or `json` |
| `ariaAudit` | No | `false` | Also run the [`audit_aria`](#audit_aria) advisory on the same page |

```json
{ "url": "http://localhost:3000/" }
```

Output (`markdown`, abridged):

```markdown
# Test Analysis Report: BenchmarkShop

**URL:** http://localhost:3000/

## Executive Summary

- **Total Elements Analyzed:** 35
- **Auto-Generated Test Cases:** 35
- **Average Intent Score:** 68/100
- **Analysis Device:** none (heuristic scoring — ML unavailable)
- **LLM Tokens Used:** 0 (no cloud LLM calls — all analysis runs locally)

## Generated Test Cases

**CRITICAL:** 28 | **HIGH:** 4 | **MEDIUM:** 1 | **LOW:** 2

#### 2. Verify form submission via "Search" button

**ID:** `TC_BENCHMARKSHOP_BUTTON_2`
**Type:** submit
**Intent Score:** 100/100
**Locator:** `#search-btn`

**Test Steps:**
1. Verify all required form fields are present
2. Fill required form fields with valid test data
3. Locate the "Search" button using locator: #search-btn
4. Click the "Search" button to submit the form
...
```

`markdown-summary` gives just the list:

```markdown
# Test Cases Summary

## CRITICAL Priority (28)

- **Verify search input field "Search products…" accepts user input**
  - Locator: `#search-input`
  - Type: input
  - Score: 100
```

`json` returns the full `AnalysisResult` from [`src/types.ts`](src/types.ts): `url`, `title`, `highIntentElements`, `generatedTestCases` (each with `id`, `name`, `priority`, `actionType`, `locator`, `steps`, `expectedResults`, `intentScore`, `tags`, and `semanticTool` for critical tests), `allNavigationLinks`, `metrics`, and `ariaAudit` when requested.

### get_element_locator

Finds the element that best matches a plain-English description and returns its locator. It does not open Chrome.

It searches the page from the most recent `crawl_and_analyze` call, and only that page. Pages crawled by `crawl_multi_page` or `run_critical_tests` are not used.

| Argument | Required | Notes |
|---|---|---|
| `description` | Yes | For example `"the search button"` |

```json
{ "description": "search button" }
```

Output:

```text
Locator: #search-btn
Type: css
Confidence: 99%
Reason: Found by ID: "search-btn"
Matched by: keyword (keyword only)
```

`Matched by` says how the element was found: `semantic`, `keyword+semantic` or `keyword`. The part in brackets says whether the embedding model was used (`semantic + keyword`) or not (`keyword only`).

Errors:

- No `crawl_and_analyze` yet: `No crawl data available. Run crawl_and_analyze first.`
- Nothing on the page matches the description: an error result saying so. Try other words, or crawl the page the element is on.

#### How matching works

Each element from the last crawl is scored two ways:

- **Meaning.** The description and a short phrase for each element (for example `button, text: Proceed to payment`) are embedded with a local sentence model, `Xenova/all-MiniLM-L6-v2` (about 23 MB quantised). The server starts loading it after each crawl so the first lookup doesn't wait.
- **Shared words.** Keywords from the description are matched against the element's text, label, id, classes and placeholder. Generic words such as "button" or "link" don't count here, because they match ids and classes all over a page.

Elements are ranked by meaning, with shared words as a bounded tie-breaker. An element with no word in common counts as a match only if its similarity is at least 0.2.

If the model can't be loaded, or isn't ready within 15 seconds, the lookup uses keyword matching alone and says `keyword only`. Set `CARTOGRAPHER_SEMANTIC_LOCATOR=off` to always use keyword matching.

To use a fine-tuned model, set `CARTOGRAPHER_LOCATOR_MODEL` to its folder or Hugging Face id, and `CARTOGRAPHER_LOCATOR_MIN_SIMILARITY` to the threshold its evaluation recommends. [training/README.md](training/README.md) covers training, evaluating and storing one.

### run_critical_tests

Crawls the page once, then runs its critical test cases (intent score 50 or more) in that same browser. You don't need to call `crawl_and_analyze` first, and the browser is closed when it finishes.

Each test calls an auto-generated semantic tool in the page, which clicks, types or submits on the live page. Tests tagged `destructive` (delete actions) are skipped. Run it against a test or staging site.

| Argument | Required | Default | Notes |
|---|---|---|---|
| `url` | Yes | | |
| `testIds` | No | all critical tests | IDs from `crawl_and_analyze`, such as `TC_BENCHMARKSHOP_BUTTON_3` |
| `retryCount` | No | `0` | Extra attempts for a failing test |
| `format` | No | `markdown` | `markdown` or `json` |

```json
{ "url": "http://localhost:3000/", "testIds": ["TC_BENCHMARKSHOP_INPUT_1"] }
```

Output (`markdown`, abridged):

```markdown
# Test Execution Results

**URL:** http://localhost:3000/
**Total Duration:** 106ms

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | 1 |
| Passed | 1 |
| Failed | 0 |
| Pass Rate | 100.0% |

## Test Results

### ✅ PASS - TC_BENCHMARKSHOP_INPUT_1

- **Tool:** searchProducts
- **Message:** Tool executed successfully
- **Duration:** 105ms
```

`json` returns a `TestExecutionSummary`:

```json
{
  "url": "http://localhost:3000/",
  "totalTests": 1,
  "passedTests": 1,
  "failedTests": 0,
  "results": [
    {
      "testId": "TC_BENCHMARKSHOP_INPUT_1",
      "toolName": "searchProducts",
      "success": true,
      "message": "Tool executed successfully",
      "duration": 105
    }
  ],
  "totalDuration": 106,
  "semanticTools": ["…"]
}
```

A failed result also has an `error` field.

If `testIds` are given and none of them match, the result is an error that lists the valid IDs. Test IDs are built from the page title and the element, so they change if the page title changes.

### audit_aria

An advisory review of the ARIA on a page. It is built on the first rule of ARIA, that no ARIA is better than bad ARIA, and looks for ARIA that makes the page harder to use than plain HTML would be.

It runs only when requested:

- call `audit_aria` directly (this does not load the ML model), or
- pass `"ariaAudit": true` to `crawl_and_analyze` to get the advisory alongside the test analysis (in JSON as `ariaAudit`, in Markdown as an extra section).

Findings are advice. They never turn a tool call into an error. `isError` is only set if the page could not be loaded at all.

| Argument | Required | Default |
|---|---|---|
| `url` | Yes | |
| `format` | No | `markdown` (or `json`) |

```json
{ "url": "http://localhost:3000/aria-lab" }
```

Output (abridged):

```markdown
# ARIA Advisory: ARIA Lab | BenchmarkShop

Scanned 65 elements, 40 of which carry ARIA.

| Severity | Advisories |
|----------|-----------|
| High | 3 |
| Medium | 8 |
| Low | 1 |

**7 of 12** can be fixed by deleting ARIA, and users lose nothing they get from it today.

### Announced as a control but cannot be reached from the keyboard

- **Element:** `#bad-div-button`: `<div id="bad-div-button" role="button" class="btn btn-primary">`
- **What's wrong:** role="button" is on a <div> that is not focusable (no tabindex, not a native control).
- **What a user experiences:** A screen reader announces "button", which promises a control. But Tab never reaches it...
- **Advice:** Use the native element (<button>, <a href>, <input type="checkbox">…)...
- **If you remove this ARIA:** The "button" announcement...
```

In JSON, every advisory has these fields:

| Field | Meaning |
|---|---|
| `problem` | What is wrong with the markup |
| `userExperience` | How it comes across to someone using a screen reader, voice control or keyboard |
| `advice` | What to do instead |
| `ifRemoved` | What a user would lose if the ARIA were simply deleted |
| `safeToRemove` | `true` when deleting the ARIA loses nothing users get from it today |
| `severity` | `high` (blocks or misleads), `medium` (degrades), `low` (noise) |
| `fix` | `remove-aria`, `change-aria`, `add-aria` or `use-native-html` |

What it checks:

| Rule | Example |
|---|---|
| `widget-not-focusable` | `<div role="button">` with no tabindex |
| `aria-hidden-focusable` | `aria-hidden="true"` on, or around, something Tab can reach |
| `native-semantics-overridden` | `<button role="heading">` |
| `missing-name` | `role="button"` with no text or label |
| `label-not-in-name` | Visible "Buy now", `aria-label="Submit order form"` |
| `links-as-menu` | Site navigation built from `role="menubar"` / `role="menuitem"` links |
| `broken-idref` | `aria-describedby` pointing at a missing id |
| `invalid-role` / `redundant-role` | `role="buton"`, `<button role="button">` |
| `presentation-conflict` | `role="presentation"` on a focusable element |
| `required-context` / `required-owned` | A `tab` outside a `tablist`; an empty `tablist` |
| `invalid-attribute-value` / `unknown-attribute` | `aria-expanded="yes"`, `aria-lable` |
| `unsupported-state` | `aria-checked` on a button |
| `prohibited-name` | `aria-label` on a plain `<div>` |
| `duplicate-main` / `indistinguishable-landmarks` | Two `main`s; two unnamed `nav`s |

The rules are heuristics over the DOM, not a full accessibility tree. They are tuned to stay quiet when unsure. An empty report means none of these patterns were found, not that the page is accessible.

### crawl_multi_page

Crawls a site breadth-first from a start URL, staying on the same site. It analyses each page, clicks buttons that look like navigation to find where they lead, and detects workflows that span pages. With `credentials` it finds the login form and signs in first.

| Argument | Default | Notes |
|---|---|---|
| `startUrl` (or `url`) | required | |
| `maxPages` | 10 | 2–50 |
| `maxDepth` | 3 | 1–5 |
| `excludeUrlPatterns` | none | Regular expressions. A URL matching any of them is never visited |
| `pageLoadTimeout` | 30000 | ms |
| `scriptTimeoutMs` | 120000 | ms, Selenium async-script timeout |
| `analysisTimeoutMs` | 90000 | ms, in-page analyzer watchdog |
| `modelLoadTimeoutMs` | 5000 | ms per backend before falling back to heuristic scoring |
| `detectWorkflows` | `true` | |
| `workflowStrategy` | `both` | `heuristic`, `ml-based` or `both` |
| `enableAutoLogin` | `true` | Only acts when `credentials` are given |
| `credentials` | none | `{ "username": "…", "password": "…" }` |
| `format` | `markdown` | or `json`. JSON includes every page's elements and test cases, so it is very large |

```json
{
  "startUrl": "http://localhost:3000/",
  "maxPages": 4,
  "maxDepth": 2,
  "excludeUrlPatterns": ["/admin", "/account/delete"]
}
```

Output (abridged):

```markdown
# Multi-Page Crawl Results

**Session ID:** `session_1795871943763_2hl15gbm6`
**Start URL:** http://localhost:3000/

## Summary

| Metric | Count |
|--------|-------|
| Pages Visited | 4 |
| Failed Pages | 0 |
| Total Elements | 142 |
| High-Intent Elements | 142 |
| Workflows Detected | 1 |
| Estimated User Journeys | 3 |

## Detected Workflows

### navigation_menu_exploration
- **ID:** `wf_navmenu_687c7492-916c-4a19-9bc8-87210c328fcb`
- **Confidence:** 70%
- **Pages:** 3
- **Tags:** navigation, menu-driven, user-exploration, search

## Inferred User Journeys

### Product Discovery & Browse
- **Description:** Users visit the homepage, use search functionality, filter/navigate products, and view product details
- **Confidence:** 85%
...
```

Keep the `sessionId`: the next two tools need it.

**What it won't touch.** Even without `excludeUrlPatterns`, the crawler never follows or clicks links and buttons that look like log out or sign out, delete or remove, unsubscribe, or place order, buy now or pay. Add your own patterns for anything else that must not be visited, such as admin areas.

**Signing in.** Pass `credentials` for a test account. The crawler looks for a login form, fills it, submits it, and then crawls as that user. Credentials are never included in the output. They are still tool arguments, though, so they stay in your MCP client's chat history. Don't use a real person's password. Set `enableAutoLogin: false` to crawl without signing in even when credentials are present.

If no page could be visited at all, the result is an error that lists the crawl errors.

### get_workflow_by_name

Returns one workflow from a `crawl_multi_page` session.

```json
{
  "sessionId": "session_1795871943763_2hl15gbm6",
  "workflowName": "navigation_menu_exploration"
}
```

`workflowName` takes a workflow's name or its ID. Several workflows can share a name (for example, two `form_submission_flow`s on different pages). A name returns the highest-confidence one, plus a note listing the IDs of the others:

```text
2 workflows are named "form_submission_flow"; returned the highest-confidence one. Fetch the others by passing their ID as workflowName: wf_form_…
```

Errors list what is available, for example `Session not found: … Available sessions: none` or `Workflow not found: … Available workflows: navigation_menu_exploration (wf_navmenu_…)`.

### export_workflow_visualization

Exports a session's workflows as Markdown, with page sequences, actions and flow diagrams.

| Argument | Required | Default | Notes |
|---|---|---|---|
| `sessionId` | Yes | | |
| `workflowIds` | No | all | Workflow names or IDs |
| `format` | No | `full` | `individual` (one section per workflow), `comparison` (side by side) or `full` |

```json
{ "sessionId": "session_1795871943763_2hl15gbm6", "format": "comparison" }
```

---

## How scoring works

Scoring happens inside the crawled page, in the bundle built by `npm run build:browser`.

1. **Rule-based intent score.** Every visible element gets points for what it is and how it is labelled. For example: a button or `role="button"` +30, a link with `href` +25 (and +30 more if it navigates away), a submit or button input +30, a text, search, email or password input +15, a label or text +15, an id +10, being inside a form +10. Disabled or hidden elements lose 50. Elements scoring 25 or more are kept. See `collectHighIntentElements` in [`src/analyzer.ts`](src/analyzer.ts).
2. **Model step, when it loads.** The embedding model (`Xenova/all-MiniLM-L6-v2`, or `Xenova/paraphrase-MiniLM-L3-v2` on low-memory devices) merges near-duplicate elements whose descriptions are more than 0.92 similar. Inputs, buttons, links, textareas and selects are never merged.
3. **Heuristic fallback, when it doesn't.** [`src/heuristic-scorer.ts`](src/heuristic-scorer.ts) re-scores each element from its tag and text patterns (for example sign in, checkout, delete), clamps the score to 0–100, and keeps those scoring 25 or more.

The report's `Analysis Device` line tells you which path ran: `webnn`, `webgpu` or `wasm` for the model, `none` for the heuristic fallback.

Priority comes from the score: **critical** 50 and above, **high** 40–49, **medium** 30–39, **low** below 30. Only critical test cases get a semantic tool, so only they can run in `run_critical_tests`.

---

## Models, downloads and offline use

Two copies of the same model family are used, in two places:

| Used by | Runs in | Model | Download | Cached |
|---|---|---|---|---|
| `get_element_locator` | The server (Node) | `Xenova/all-MiniLM-L6-v2`, quantised, about 23 MB | From Hugging Face, the first time it is needed | `node_modules/@huggingface/transformers/.cache` |
| Page scoring | The crawled page (Chrome) | `Xenova/all-MiniLM-L6-v2` at full precision on CPU (about 90 MB) | From Hugging Face, with the ONNX runtime from cdn.jsdelivr.net | No. Every crawl uses a fresh Chrome profile |

To fetch the locator model ahead of time, run this from the repository folder:

```bash
node -e "import('@huggingface/transformers').then(({ pipeline }) => pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' }))"
```

This only warms the locator model. The in-page scoring model can't be pre-fetched, because each crawl starts with an empty Chrome profile.

The in-page model has 5 seconds per backend to load. `crawl_multi_page` lets you raise that with `modelLoadTimeoutMs`; `crawl_and_analyze` and `run_critical_tests` don't. In practice the download often takes longer, and the crawl uses heuristic scoring. That is normal, and the test cases are still produced.

**Offline, or behind a proxy that blocks these hosts:**

- page scoring uses the heuristic fallback (`Analysis Device: none`);
- `get_element_locator` uses keyword matching (`keyword only`);
- the first crawl still needs chromedriver. Selenium Manager downloads it once into `~/.cache/selenium`. If it can't, put a chromedriver that matches your Chrome version on your `PATH`.

A site's Content-Security-Policy can also block the in-page model download, with the same fallback.

---

## Troubleshooting

### The server seems to hang after `npm start`

It is waiting for an MCP client on stdin. Nothing more will print until a client connects. Stop it with Ctrl+C, and let your MCP client start it instead.

### Chrome or chromedriver won't start

Check Chrome is installed. Selenium Manager finds Chrome and downloads a matching chromedriver; that needs internet access the first time. Errors such as `session not created` usually mean the driver and Chrome versions don't match. Update Chrome, or delete `~/.cache/selenium` so Selenium Manager fetches a fresh driver.

### `Chrome could not load … and showed its error page instead`

Chrome couldn't load the URL: a DNS failure, a refused connection, or a bad certificate. Check the URL opens in your own browser.

For an `http://` URL, the message adds a note about HTTPS-First. Chrome tries `https://` first, so an http-only site whose `https://` address fails can't be crawled. Remember that a URL without a scheme gets `https://` added.

`audit_aria` shows the raw Chrome error instead, for example `ARIA advisory could not run: unknown error: net::ERR_CONNECTION_REFUSED`.

### `Analysis Device: none (heuristic scoring — ML unavailable)`

The in-page model didn't load in time, or couldn't be downloaded. The results come from the heuristic scorer. See [Models, downloads and offline use](#models-downloads-and-offline-use). For `crawl_multi_page`, try a larger `modelLoadTimeoutMs`.

### `Analyzer execution timed out after …ms`

The in-page analysis took longer than `analysisTimeoutMs` (90 seconds by default). Very large pages can do this. On `crawl_multi_page`, raise `analysisTimeoutMs` and, if needed, `scriptTimeoutMs`.

### `get_element_locator` says `No crawl data available`

Call `crawl_and_analyze` on the page first. `crawl_multi_page` and `run_critical_tests` don't count. The data is also lost if the server restarts.

### `get_element_locator` finds the wrong element, or nothing

It only knows the page from the last `crawl_and_analyze`. Crawl the page the element is actually on. Describe it the way it is labelled on the page. If the result says `keyword only`, the embedding model isn't loaded; see the section above.

### `run_critical_tests` runs nothing, or not the tests I asked for

Only critical tests (score 50 or more) can run, and tests tagged `destructive` are skipped. If you pass `testIds`, take them from a recent `crawl_and_analyze` of the same URL; the error lists the valid ones.

### `Session not found`

Sessions from `crawl_multi_page` live in the server's memory for one hour. They are gone after that, or after the server restarts. Run the crawl again.

### No test cases generated

The page may build its content after load, or the elements may be hidden or disabled when the crawl reads the page. Try `CARTOGRAPHER_HEADED=1` to watch what Chrome actually shows.
