# Usage Guide

How to run WebMCP-Selenium and call its tools, with the input and output of each tool, examples and troubleshooting.

WebMCP-Selenium is an MCP server that speaks **stdio only**. It has no HTTP port and no endpoints. Every example below is a call an MCP client makes over stdio: Claude Desktop or another MCP host, the MCP Inspector, or a script using the MCP SDK's client.

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Calling the Tools](#calling-the-tools)
4. [API Reference](#api-reference)
5. [Core Types](#core-types)
6. [Usage Examples](#usage-examples)
7. [Output Formats](#output-formats)
8. [Troubleshooting](#troubleshooting)
9. [Performance](#performance)
10. [Limits](#limits)
11. [Glossary](#glossary)

---

## Installation

### Prerequisites

- **Node.js** ≥ 18 (CI runs 18, 20 and 22)
- **npm**
- **Google Chrome** installed (Selenium Manager downloads a matching chromedriver)

### From a clone

The package is not published to npm. Install it from a checkout:

```bash
npm install
npm run build          # compile TypeScript to build/
npm run build:browser  # bundle the analyzer to build/analyzer.browser.js
```

Both builds are needed: the server injects `build/analyzer.browser.js` into each page it crawls. `npm start` runs both builds and then starts the server.

### Registering with an MCP client

Add the server to your client's configuration (for Claude Desktop, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "web-mcp-selenium": {
      "command": "node",
      "args": ["/absolute/path/to/project/build/index.js"]
    }
  }
}
```

Restart the client to load the server. It exposes seven tools:

| Tool | Purpose |
|---|---|
| `crawl_and_analyze` | Crawl one page and generate prioritised test cases |
| `get_element_locator` | Find a stable locator for a described element from the last `crawl_and_analyze` |
| `run_critical_tests` | Crawl a page and execute its critical test cases in the browser |
| `audit_aria` | Advisory review of the ARIA on a page |
| `crawl_multi_page` | Crawl a site, optionally logging in, and detect workflows across pages |
| `get_workflow_by_name` | Fetch one workflow from a `crawl_multi_page` session |
| `export_workflow_visualization` | Export a session's workflows as Markdown |

---

## Configuration

### Environment Variables

All are optional. Set them in the environment the MCP client starts the server with (for Claude Desktop, an `"env"` object next to `"args"`).

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEBMCP_HEADED` | unset | Set to `1` to show the Chrome window instead of running headless |
| `WEBMCP_SEMANTIC_LOCATOR` | on | `off`, `0` or `false` makes `get_element_locator` use keyword matching only |
| `WEBMCP_LOCATOR_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model for `get_element_locator`: a Hugging Face id or a local directory |
| `WEBMCP_LOCATOR_MIN_SIMILARITY` | `0.2` | Minimum similarity for a meaning-only locator match |
| `HF_TOKEN` | unset | Hugging Face token for a private `WEBMCP_LOCATOR_MODEL` |

Chrome is found by Selenium Manager, and the analyzer picks its ML device (WebNN, WebGPU or WASM) itself. Timeouts are per-call options on `crawl_multi_page`, not environment variables.

**Example** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "web-mcp-selenium": {
      "command": "node",
      "args": ["/absolute/path/to/project/build/index.js"],
      "env": { "WEBMCP_HEADED": "1" }
    }
  }
}
```

### Logging

The server's protocol traffic is on stdout. Its own log lines (for example `WebMCP-Selenium MCP server running on stdio`) go to stderr, which most MCP clients write to their server log.

---

## Calling the Tools

### From an MCP host

In Claude Desktop or another MCP host, ask in plain language ("crawl https://example.com and list the critical tests"); the host chooses the tool and fills in its arguments.

### From the MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) gives a UI for calling tools by hand:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

### From a script

Use the MCP SDK's client (already a dependency of this project) with a stdio transport. The server is started as a child process by the transport:

```javascript
// call-tools.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/absolute/path/to/project/build/index.js"],
});
const client = new Client({ name: "my-script", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

const result = await client.callTool({
  name: "crawl_and_analyze",
  arguments: { url: "https://example.com", format: "json" },
});

// Every tool returns its output as a single text part.
const text = result.content.find((part) => part.type === "text").text;
const analysis = JSON.parse(text); // only for format: "json"
console.log(`${analysis.generatedTestCases?.length ?? 0} test cases`);

await client.close();
```

The examples below show only the tool name and its `arguments`; they all go through `client.callTool(...)` (or your host) as above.

### Results and errors

Each tool returns `{ content: [{ type: "text", text }] }`. The text is JSON or Markdown, depending on the tool and its `format`. When a tool fails, the result has `isError: true` and the text says why. Invalid arguments (a missing `url`, an out-of-range `maxPages`) are rejected before the tool runs.

---

## API Reference

### Tool 1: `crawl_and_analyze`

Crawls one page with Chrome, analyses its DOM, and generates prioritised test cases. The result is also kept in memory for `get_element_locator`.

#### Input

```typescript
interface CrawlAndAnalyzeInput {
  url: string;                                        // required, a full URL
  format?: 'json' | 'markdown' | 'markdown-summary';  // default: 'markdown'
  ariaAudit?: boolean;                                // also run the audit_aria advisory (default: false)
}
```

Elements with an intent score of at least 25 are kept.

#### Output

- `format: "json"`: an [`AnalysisResult`](#analysisresult) object.
- `format: "markdown"`: a full report (see [Output Formats](#output-formats)).
- `format: "markdown-summary"`: the test cases grouped by priority.

With `ariaAudit: true`, the advisory is added as `ariaAudit` in JSON and as an extra section in either Markdown format.

#### Example

```json
{ "name": "crawl_and_analyze", "arguments": { "url": "https://example.com/login", "format": "json" } }
```

Response text (abridged):

```json
{
  "url": "https://example.com/login",
  "title": "Sign in",
  "highIntentElements": [
    {
      "path": "body > main > form > button",
      "tag": "button",
      "id": "sign-in",
      "text": "Sign In",
      "locator": "#sign-in",
      "intentReasons": ["button element", "submit action"],
      "intentScore": 75,
      "attributes": { "type": "submit" }
    }
  ],
  "generatedTestCases": [
    {
      "id": "TC_SIGN_IN_BUTTON_1",
      "name": "Verify form submission via \"Sign In\" button",
      "description": "Test that the form can be submitted using the \"Sign In\" button",
      "priority": "critical",
      "actionType": "submit",
      "locator": "#sign-in",
      "preconditions": ["Page has loaded", "Form is visible", "Form fields are accessible"],
      "steps": [
        "Verify all required form fields are present",
        "Fill required form fields with valid test data",
        "Locate the \"Sign In\" button using locator: #sign-in",
        "Click the \"Sign In\" button to submit the form",
        "Observe the form submission response"
      ],
      "expectedResults": ["\"Sign In\" button is found and is clickable", "Form data is submitted successfully", "..."],
      "intentScore": 75,
      "tags": ["submit", "button", "interaction", "high-priority", "input:submit"],
      "sourceElement": { "...": "the element above" },
      "semanticTool": "signIn",
      "testCode": "async function test() {\n  const result = await navigator.webmcp.tools[\"signIn\"]();\n  ..."
    }
  ],
  "consoleLogs": ["[analyzer] Using all-MiniLM-L6-v2 (accurate)"],
  "metrics": {
    "device": "wasm",
    "modelLoadTime": 1840,
    "analysisTime": 35,
    "deduplicationTime": 210,
    "elementsAnalyzed": 182,
    "elementsClustered": 14,
    "tokensUsed": 0
  }
}
```

Values such as names, steps and scores depend on the page; the field names are what the tool returns.

---

### Tool 2: `get_element_locator`

Returns the most stable CSS or XPath locator for an element described in natural language, chosen from the elements found by the most recent `crawl_and_analyze` call in this server process.

#### Input

```typescript
interface GetElementLocatorInput {
  description: string;   // required, non-empty
}
```

If `crawl_and_analyze` has not run yet, the result is an error: `No crawl data available. Run crawl_and_analyze first.` (`crawl_multi_page` and `run_critical_tests` do not feed this tool.)

#### How matching works

Each element from the last crawl is scored two ways:

- **Meaning**: the description and a short phrase for each element (for example `button, text: Proceed to payment`) are embedded with a local sentence model, `Xenova/all-MiniLM-L6-v2` (about 23 MB quantised). The model downloads from Hugging Face on first use and is cached; the server starts loading it after each crawl so the first lookup doesn't wait.
- **Shared words**: keywords from the description matched against the element's text, label, id, classes and placeholder. Generic words such as "button" or "link" don't count here, because they match ids and classes all over a page.

Elements are ranked by meaning, with shared words as a bounded tie-breaker. An element with no word in common counts as a match only if its similarity is at least 0.2. Unrelated descriptions measured below 0.1 against a real page, and true paraphrases from 0.26 up.

The result says which method found the element (`Matched by: semantic`, `keyword+semantic` or `keyword`). If the model can't be loaded (offline, say) or isn't ready within 15 seconds, the lookup uses keyword matching alone and says so (`keyword only`).

Set `WEBMCP_SEMANTIC_LOCATOR=off` in the server's environment to always use keyword matching alone.

To use a fine-tuned model, set `WEBMCP_LOCATOR_MODEL` to its folder or Hugging Face id, and `WEBMCP_LOCATOR_MIN_SIMILARITY` to the threshold its evaluation recommends. [training/README.md](training/README.md) covers training, evaluating and storing one.

#### Output

Plain text, five lines:

```text
Locator: #checkout-btn
Type: css
Confidence: 82%
Reason: <why this element and this locator were chosen>
Matched by: keyword+semantic (semantic + keyword)
```

- `Type` is `css` or `xpath`.
- `Matched by` is `semantic`, `keyword`, `keyword+semantic` or `none`, followed by the mode in brackets: `semantic + keyword`, or `keyword only` when the model is off or unavailable.

#### Examples

```json
{ "name": "get_element_locator", "arguments": { "description": "the submit button in the login form" } }
{ "name": "get_element_locator", "arguments": { "description": "search box in the header" } }
{ "name": "get_element_locator", "arguments": { "description": "terms of service link in footer" } }
```

---

### Tool 3: `run_critical_tests`

Crawls the URL, then crawls it again in a fresh browser where the generated semantic tools are registered on `navigator.webmcp.tools`, and executes each critical test case (intent score ≥ 50) by calling its tool. It does not reuse an earlier `crawl_and_analyze` result.

#### Input

```typescript
interface RunCriticalTestsInput {
  url: string;                   // required
  testIds?: string[];            // run only these critical tests; default: all of them
  retryCount?: number;           // re-run a failing test up to this many more times (default: 0)
  format?: 'json' | 'markdown';  // default: 'json'
}
```

Test ids have the form `TC_<PAGE_TITLE>_<TAG>_<n>` (for example `TC_SIGN_IN_BUTTON_1`), as returned in `generatedTestCases` by `crawl_and_analyze`. Ids of tests that are not critical are ignored.

#### Output (`format: "json"`)

A `TestExecutionSummary`:

```typescript
interface TestExecutionSummary {
  url: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;              // ms
  results: TestExecutionResult[];
  semanticTools: SemanticToolSchema[];
}

interface TestExecutionResult {
  testId: string;
  toolName: string;     // the navigator.webmcp.tools entry that was called
  success: boolean;
  message: string;
  duration: number;     // ms
  error?: string;
}
```

`format: "markdown"` gives the same data as a summary table and one section per test.

If there are no critical tests to run, the text is `No critical tests found to execute.` If the browser run itself fails, the text starts with `Test execution failed:`.

#### Examples

```json
{ "name": "run_critical_tests", "arguments": { "url": "https://example.com" } }
{ "name": "run_critical_tests", "arguments": { "url": "https://example.com", "testIds": ["TC_SIGN_IN_BUTTON_1", "TC_SIGN_IN_A_4"], "retryCount": 1, "format": "markdown" } }
```

---

### Tool 4: `audit_aria`

An advisory review of the ARIA on a page. It is built on the first rule of ARIA, that no ARIA is better than bad ARIA, and looks for ARIA that makes the page harder to use than plain HTML would be.

It runs only when requested:

- call `audit_aria` directly (this does not load the ML model), or
- pass `"ariaAudit": true` to `crawl_and_analyze` to get the advisory alongside the test analysis (in JSON as `ariaAudit`, in Markdown as an extra section).

Findings are advice. They never turn a tool call into an error. `isError` is only set if the page could not be loaded at all.

#### Input

```typescript
interface AuditAriaInput {
  url: string;                      // required
  format?: 'json' | 'markdown';     // default: 'markdown'
}
```

#### Output (`format: "json"`)

An `AriaAuditReport`: `url`, `title`, `advisory: true`, `elementsScanned`, `elementsWithAria`, `truncated`, `findings` and `summary` (`total`, `high`, `medium`, `low`, `safeToRemove`).

#### What every advisory contains

| Field | Meaning |
|---|---|
| `ruleId`, `title` | Which rule fired, and a one-line headline |
| `locator`, `snippet`, `role` | Where it is, and the opening tag as written |
| `problem` | What is wrong with the markup |
| `userExperience` | How it comes across to someone using a screen reader, voice control or keyboard |
| `advice` | What to do instead |
| `ifRemoved` | What a user would lose if the ARIA were simply deleted |
| `safeToRemove` | `true` when deleting the ARIA loses nothing users get from it today |
| `severity` | `high` (blocks or misleads), `medium` (degrades), `low` (noise) |
| `fix` | `remove-aria`, `change-aria`, `add-aria` or `use-native-html` |
| `reference` | Link to the relevant spec or guidance |

The summary counts `safeToRemove` advisories separately. They are bad ARIA that can simply be deleted.

#### What it checks

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

The rules are heuristics over the DOM, not a full accessibility tree. They are tuned to stay quiet when unsure. An empty report means none of these patterns were found, not that the page is accessible. At most 2,000 elements are scanned; `truncated` is `true` when a page has more.

#### Example (Markdown, abridged)

```markdown
### Announced as a control but cannot be reached from the keyboard

- **Element:** `#add`: `<div id="add" role="button">`
- **What a user experiences:** A screen reader announces "button", which promises a control. But Tab never reaches it...
- **Advice:** Use the native element (<button>, <a href>, ...)...
- **If you remove this ARIA:** The "button" announcement. That announcement is currently a promise the element can't keep...
```

---

### Tool 5: `crawl_multi_page`

Crawls a site breadth-first from a start URL, staying on the same site, analyses each page, and detects user workflows across the pages. With `credentials` it finds a login form, signs in, and keeps crawling as the signed-in user.

#### Input

```typescript
interface CrawlMultiPageInput {
  startUrl: string;              // required; "example.com" is read as "https://example.com"
  maxPages?: number;             // 2–50, default 10
  maxDepth?: number;             // 1–5, default 3 (links followed from the start page)
  pageLoadTimeout?: number;      // ms, 5000–180000, default 30000
  scriptTimeoutMs?: number;      // ms, 10000–300000, default 120000 (Selenium async-script timeout)
  analysisTimeoutMs?: number;    // ms, 5000–240000, default 90000 (in-page analyzer watchdog)
  modelLoadTimeoutMs?: number;   // ms, 1000–120000, default 5000 (per ML device, before heuristic scoring takes over)
  detectWorkflows?: boolean;     // default true
  workflowStrategy?: 'heuristic' | 'ml-based' | 'both';  // default 'both'; see below
  enableAutoLogin?: boolean;     // default true; only acts when credentials are given
  credentials?: { username: string; password: string };
  format?: 'json' | 'markdown';  // default 'json'
}
```

`workflowStrategy`: only the heuristic detectors are implemented. `ml-based` is accepted but currently detects no workflows, so `both` gives the same result as `heuristic`. Inferred journeys (`inferredJourneys`) are produced either way.

#### How login works

When `credentials` are given and `enableAutoLogin` is on, each crawled page that has both a username/email field and a password field is treated as a login form:

1. The username and password fields are found and filled (custom select-style widgets included).
2. The form is submitted by clicking its submit button, or by submitting the form if there is no button.
3. The login counts as successful when the login form is gone and at least one of these is true: the URL changed, a logout control appeared, or a profile or user-menu element appeared.
4. The outcome is written to the session's `sessionState` as `lastLoginSuccess` (a timestamp), `lastLoginFailure` or `lastLoginError`, and the crawl carries on.

Credentials are held in memory for the session only. They are also stored in `sessionState` as `username` and `password`, so **a `format: "json"` result includes the password**; use `markdown`, or strip it, before sharing a result.

#### Output

`format: "json"` returns a `MultiPageCrawlResult`:

```typescript
interface MultiPageCrawlResult {
  session: CrawlSession;                 // sessionId, startUrl, pages, metadata, sessionState, workflows, inferredJourneys
  detectedWorkflows: DetectedWorkflow[];
  inferredJourneys?: Array<{ id; name; description; pageSequence; elementPatterns; confidence; tags }>;
  crawlErrors?: Array<{ url; depth; phase: 'navigate' | 'analyze' | 'extract' | 'unknown'; message; timestamp }>;
  summary: {
    pagesVisited: number;
    failedPages?: number;
    totalElements: number;
    highIntentElements: number;
    workflowsDetected: number;
    estimatedUserJourneys: number;
  };
  performance?: { totalTime?; concurrency?; cacheHits?; cacheMisses?; peakMemory?; avgTimePerPage? };
}
```

`format: "markdown"` returns the session id, the summary table, up to ten crawl errors, each detected workflow (name, id, confidence, page count, tags), each inferred journey, and ready-made calls for the two follow-up tools.

The session id (`session.sessionId`, of the form `session_<timestamp>_<random>`) is what `get_workflow_by_name` and `export_workflow_visualization` take. Sessions are kept in memory for one hour and are lost when the server restarts.

If no page could be crawled at all, the result has `isError: true`, with the crawl errors in the text.

#### Example

```json
{
  "name": "crawl_multi_page",
  "arguments": {
    "startUrl": "https://shop.example.com",
    "maxPages": 20,
    "maxDepth": 3,
    "credentials": { "username": "test-user@example.com", "password": "<test password>" },
    "format": "markdown"
  }
}
```

To crawl a login page without signing in, leave out `credentials` (or set `"enableAutoLogin": false`).

---

### Tool 6: `get_workflow_by_name`

Returns one detected workflow from a `crawl_multi_page` session, as JSON.

#### Input

```typescript
interface GetWorkflowByNameInput {
  sessionId: string;     // from crawl_multi_page
  workflowName: string;  // exact name, e.g. 'login_flow'
}
```

Workflow names come from the crawl's results. The heuristic detector produces names such as `login_flow`, `signup_flow`, `form_submission_flow`, `product_browsing_flow`, `search_browsing_flow`, `navigation_menu_exploration` and `<form type>_flow` (for example `checkout_flow`). If several workflows share a name, the first is returned.

#### Output

A [`DetectedWorkflow`](#detectedworkflow). An unknown session or workflow name is an error whose text lists the sessions or workflow names that do exist.

#### Example

```json
{ "name": "get_workflow_by_name", "arguments": { "sessionId": "session_1764240000000_k3j9x2abc", "workflowName": "login_flow" } }
```

---

### Tool 7: `export_workflow_visualization`

Exports the workflows from a `crawl_multi_page` session as Markdown.

#### Input

```typescript
interface ExportWorkflowVisualizationInput {
  sessionId: string;
  workflowIds?: string[];   // workflow ids (e.g. 'wf_auth_…'), not names; default: all workflows
  format?: 'individual' | 'comparison' | 'full';  // default 'full'
}
```

| `format` | Output |
|---|---|
| `individual` | One section per workflow: page sequence, actions performed, state transitions |
| `comparison` | The selected workflows side by side, with the patterns they share |
| `full` | A report of every selected workflow |

If no workflow matches `workflowIds`, the text is `No workflows found matching the criteria.` An unknown session is an error.

#### Example

```json
{ "name": "export_workflow_visualization", "arguments": { "sessionId": "session_1764240000000_k3j9x2abc", "format": "comparison" } }
```

---

## Core Types

These are the shapes in the JSON output, from [src/types.ts](src/types.ts).

### AnalysisResult

Returned by `crawl_and_analyze` with `format: "json"`.

```typescript
interface AnalysisResult {
  url: string;
  title: string;
  highIntentElements: HighIntentElement[];
  generatedTestCases?: GeneratedTestCase[];
  consoleLogs: string[];             // browser console output captured during analysis
  error?: string;                    // set when analysis was degraded but still returned results
  allNavigationLinks?: string[];
  metrics?: AnalysisMetrics;
  ariaAudit?: AriaAuditReport;       // only with ariaAudit: true
}
```

### HighIntentElement

```typescript
interface HighIntentElement {
  path: string;                      // CSS-like path to the element
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  ariaLabel?: string;
  text?: string;
  locator: string;                   // suggested stable locator
  intentReasons: string[];           // why it scored as it did
  intentScore: number;
  navigates?: boolean;
  navigationTarget?: string;
  attributes?: Record<string, string>;
}
```

### GeneratedTestCase

```typescript
interface GeneratedTestCase {
  id: string;                        // "TC_<PAGE_TITLE>_<TAG>_<n>"
  name: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  actionType: ActionType;
  locator: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
  intentScore: number;
  tags: string[];
  sourceElement: HighIntentElement;
  semanticTool?: string;             // critical tests only: the navigator.webmcp.tools entry
  testCode?: string;                 // critical tests only: code that calls it
}

type ActionType = 'click' | 'input' | 'submit' | 'navigate' | 'delete' | 'select' | 'hover';
```

### SemanticToolSchema

One per critical element; returned in `run_critical_tests` results.

```typescript
interface SemanticToolSchema {
  name: string;                      // camelCase, suffixed (signIn2) when names collide
  description: string;
  actionType: ActionType;
  inputSchema: Record<string, unknown>;
  returnType: string;                // "{ success: boolean; message: string; payload?: any }"
}
```

### AnalysisMetrics

```typescript
interface AnalysisMetrics {
  device: 'webnn' | 'webgpu' | 'wasm' | 'none';   // 'none' when heuristic scoring was used
  modelLoadTime: number;             // ms
  analysisTime: number;              // ms
  deduplicationTime: number;         // ms
  elementsAnalyzed: number;
  elementsClustered: number;
  tokensUsed: number;                // always 0: inference is local
}
```

### DetectedWorkflow

```typescript
interface DetectedWorkflow {
  id: string;                        // e.g. "wf_auth_<uuid>"
  name: string;                      // e.g. "login_flow"
  pageSequence: string[];            // page URLs in order
  actionSequence: WorkflowAction[];  // { pageUrl, elementLocator, actionType, actionData?, resultingNavigation?, timestamp }
  stateTransitions: StateTransition[]; // { fromPage, toPage, action, stateChanges }
  confidence: number;                // 0–100
  tags: string[];
}
```

### Scoring

- **Intent score**: each element in the page is scored by rules over its tag, role, text, ARIA label, test-id attributes and input type, with boosts for navigation links, forms and submit buttons. Elements scoring 25 or more are kept. If the ML model is unavailable, the rule-based `HeuristicScorer` rescores the elements instead.
- **ML deduplication**: when the model loads (`Xenova/all-MiniLM-L6-v2`, or `Xenova/paraphrase-MiniLM-L3-v2` on low-resource devices), each element's description is embedded, and elements at least 0.92 similar to one already kept are merged. Inputs, buttons, links, textareas and selects are never merged.
- **Priority** from intent score: `critical` ≥ 50, `high` ≥ 40, `medium` ≥ 30, `low` below 30.
- **Semantic tools** and `run_critical_tests` cover critical elements only (score ≥ 50).

---

## Usage Examples

Each example is a sequence of tool calls, made from a host, the Inspector or a script ([Calling the Tools](#calling-the-tools)).

### Example 1: Test cases for one page

```json
{ "name": "crawl_and_analyze", "arguments": { "url": "https://example.com", "format": "markdown-summary" } }
```

### Example 2: Locators for a login form

```json
{ "name": "crawl_and_analyze", "arguments": { "url": "https://example.com/login", "format": "json" } }
{ "name": "get_element_locator", "arguments": { "description": "email input field" } }
{ "name": "get_element_locator", "arguments": { "description": "password input field" } }
{ "name": "run_critical_tests", "arguments": { "url": "https://example.com/login" } }
```

### Example 3: Checkout page from a script

```javascript
// checkout.mjs — connect as in "From a script", then:
const call = async (name, args) =>
  (await client.callTool({ name, arguments: args })).content[0].text;

const analysis = JSON.parse(
  await call("crawl_and_analyze", { url: "https://myshop.example/checkout", format: "json" })
);
const critical = (analysis.generatedTestCases ?? []).filter((t) => t.priority === "critical");
console.log(`Found ${critical.length} critical tests`);

console.log(await call("get_element_locator", { description: "place order button" }));

const summary = JSON.parse(
  await call("run_critical_tests", { url: "https://myshop.example/checkout", format: "json" })
);
console.log(`Tests: ${summary.passedTests}/${summary.totalTests} passed`);
```

`run_critical_tests` returns plain text, not JSON, when there are no critical tests or the run fails, so check for that before parsing in real code.

### Example 4: Markdown report for stakeholders

Call `crawl_and_analyze` with `format: "markdown"`, save the result text to `test-report.md`, and convert it if you need to:

```bash
pandoc test-report.md -o test-report.pdf
```

### Example 5: A site behind a login

```json
{
  "name": "crawl_multi_page",
  "arguments": {
    "startUrl": "https://app.example.com",
    "maxPages": 30,
    "maxDepth": 4,
    "credentials": { "username": "test-user@example.com", "password": "<test password>" },
    "format": "markdown"
  }
}
```

The Markdown result begins with the session id, for example `session_1764240000000_k3j9x2abc`. Then:

```json
{ "name": "get_workflow_by_name", "arguments": { "sessionId": "session_1764240000000_k3j9x2abc", "workflowName": "login_flow" } }
{ "name": "export_workflow_visualization", "arguments": { "sessionId": "session_1764240000000_k3j9x2abc", "format": "individual" } }
```

From a script, read the credentials from the environment rather than writing them into code:

```javascript
await client.callTool({
  name: "crawl_multi_page",
  arguments: {
    startUrl: "https://app.example.com",
    credentials: { username: process.env.LOGIN_USER, password: process.env.LOGIN_PASS },
    format: "markdown",
  },
});
```

(`LOGIN_USER` and `LOGIN_PASS` are names for your own script; the server does not read them.)

### Example 6: ARIA advisory

```json
{ "name": "audit_aria", "arguments": { "url": "https://example.com" } }
{ "name": "crawl_and_analyze", "arguments": { "url": "https://example.com", "ariaAudit": true } }
```

---

## Output Formats

### `crawl_and_analyze`

| `format` | Contents |
|---|---|
| `json` | The full `AnalysisResult` |
| `markdown` (default) | Header; a warning if analysis was degraded; executive summary; test cases grouped by priority with steps and expected results; high-intent elements by tag; statistics (elements by tag, test cases by action type, score distribution, performance metrics) |
| `markdown-summary` | Test cases grouped by priority, each with name, locator, action type and score |

Use `json` to process the results in code, `markdown` to read or share them, and `markdown-summary` for a quick list.

### Other tools

| Tool | Formats |
|---|---|
| `get_element_locator` | Plain text only |
| `run_critical_tests` | `json` (default) or `markdown` |
| `audit_aria` | `markdown` (default) or `json` |
| `crawl_multi_page` | `json` (default) or `markdown` |
| `get_workflow_by_name` | JSON only |
| `export_workflow_visualization` | Markdown only, in the `individual`, `comparison` or `full` layout |

---

## Troubleshooting

### Chrome does not start

**Solution:**

1. Install Google Chrome from <https://www.google.com/chrome/>.
2. Selenium Manager downloads a matching chromedriver on first run, so it needs network access the first time.
3. Set `WEBMCP_HEADED=1` to watch the browser and see where it stops.

### `ENOENT ... analyzer.browser.js`

The browser bundle has not been built. Run `npm run build:browser` (or `npm start`, which runs both builds). `npm run dev` needs it too.

### Analysis falls back to heuristics

`metrics.device` is `none` and `consoleLogs` contains `ML unavailable, using heuristic scoring (fallback)`.

**Cause:** the model could not load in the page within the time allowed, for example on the first run while it is still downloading, or with no network.

**Solution:**

- Results are still produced, from rule-based scoring. Run again once the model is cached.
- On `crawl_multi_page`, raise `modelLoadTimeoutMs` (default 5000, up to 120000) to give the model more time.

### Pages time out on `crawl_multi_page`

**Solution:**

- Raise `pageLoadTimeout` (up to 180000 ms), and `analysisTimeoutMs` / `scriptTimeoutMs` for heavy pages.
- Check the URL loads in a normal browser.
- Look at `crawlErrors`: `phase` says whether navigation, analysis or extraction failed.

### "A valid URL is required."

`url` on `crawl_and_analyze`, `run_critical_tests` and `audit_aria` must be a full URL including `http://` or `https://`. `crawl_multi_page` adds `https://` to a `startUrl` that has no scheme.

### `get_element_locator` says "No crawl data available"

Call `crawl_and_analyze` first, in the same server process. Results from `crawl_multi_page` are not used for locators, and the data is lost when the server restarts.

### The locator model is slow the first time

`get_element_locator` downloads `Xenova/all-MiniLM-L6-v2` (about 23 MB) from Hugging Face on first use and caches it. Until it is ready (up to 15 seconds), lookups fall back to keyword matching. The in-page analyzer downloads its model separately, inside Chrome, and Chrome caches it.

### No test cases generated

**Cause:** no element on the page scored 25 or more.

**Solution:**

- The page may have no interactive elements.
- Try a page with forms, buttons or links.
- To change the scoring, see [DEVELOPMENT.md](DEVELOPMENT.md#modifying-scoring-logic).

### `run_critical_tests` says "No critical tests found to execute."

No element scored 50 or more, or none of the `testIds` given is a critical test. Check `generatedTestCases` from `crawl_and_analyze` for tests with `priority: "critical"`.

### `get_workflow_by_name` or `export_workflow_visualization` says "Session not found"

Sessions last one hour and live in server memory, so a restart or a long gap loses them. Run `crawl_multi_page` again.

---

## Performance

### What takes the time

- Starting Chrome, for every call that crawls (each crawl gets its own browser, closed afterwards).
- Downloading the analyzer's model the first time Chrome runs it.
- Page load and analysis, which grow with the page's size and number of elements.
- For `crawl_multi_page`, the number of pages (`maxPages`) and how deep the crawl goes (`maxDepth`).
- `run_critical_tests` crawls the page twice.

### To speed things up

- Lower `maxPages` and `maxDepth` on `crawl_multi_page`, and lower `pageLoadTimeout` for fast sites so broken pages fail quickly.
- Set `detectWorkflows: false` on `crawl_multi_page` when you only want the per-page analysis.
- Leave `ariaAudit` off unless you want the advisory.
- Choosing `markdown-summary` changes only the output, not the crawl.

### Memory

Headless Chrome is the main cost. The locator model adds about 23 MB on disk and a little more in memory once loaded.

### Concurrency

`crawl_multi_page` crawls its pages one after another. `crawl_and_analyze` and `run_critical_tests` share one browser instance, so make those calls one at a time. To crawl several sites at once, run several server processes.

---

## Limits

| Limit | Value |
|---|---|
| Pages per `crawl_multi_page` | 2–50 (`maxPages`) |
| Crawl depth | 1–5 (`maxDepth`) |
| Page load timeout (`crawl_multi_page`) | 5,000–180,000 ms (`pageLoadTimeout`, default 30,000) |
| Page load timeout (`crawl_and_analyze`, `run_critical_tests`, `audit_aria`) | 60,000 ms, not configurable |
| Elements kept per page | those with intent score ≥ 25 |
| Elements scanned by the ARIA advisory | 2,000 per page |
| Session lifetime | 1 hour, in memory |
| Locator model wait | 15 seconds before falling back to keyword matching |

---

## Glossary

| Term | Definition |
|------|-----------|
| **Intent score** | Rule-based rating of how important an element is to test; 25 or more to be kept |
| **Priority** | `critical` (≥ 50), `high` (≥ 40), `medium` (≥ 30) or `low`, from the intent score |
| **High-intent element** | An element kept for analysis because of its intent score |
| **Action type** | What a test does with the element: `click`, `input`, `submit`, `navigate`, `delete`, `select` or `hover` |
| **Semantic tool** | A function generated for a critical element and registered in the page on `navigator.webmcp.tools` |
| **Handler** | The browser-side code behind a semantic tool |
| **Locator** | CSS selector or XPath that identifies an element |
| **Semantic similarity** | Cosine similarity of two text embeddings; how close two phrases are in meaning |
| **Session** | The in-memory record of a `crawl_multi_page` run, addressed by its `sessionId` |
| **Workflow** | A sequence of pages and actions detected across a multi-page crawl, such as `login_flow` |
| **MCP tool** | A function the server exposes over the Model Context Protocol |
| **Headless Chrome** | Chrome without a visible window, driven by Selenium |

---

## Next Steps

- **Using as an MCP tool?** See the README's [Client Configuration](README.md#client-configuration).
- **Contributing?** See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and architecture.
- **Found a bug?** See [CONTRIBUTING.md](CONTRIBUTING.md).
