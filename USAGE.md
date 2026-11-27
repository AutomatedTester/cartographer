# Usage Guide

Comprehensive guide to installing and using WebMCP-Selenium, including API reference, examples, and troubleshooting.

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [API Reference](#api-reference)
4. [Core Types](#core-types)
5. [Usage Examples](#usage-examples)
6. [Output Formats](#output-formats)
7. [Troubleshooting](#troubleshooting)
8. [Performance & Optimization](#performance--optimization)
9. [Integration Examples](#integration-examples)

---

## Installation

### Prerequisites

- **Node.js** ≥ 18
- **npm** or **yarn**
- **Google Chrome** installed (Selenium Manager handles chromedriver)

### npm Install

```bash
npm install friendly-octo-train
```

### Peer Dependencies

The package requires:

- `@modelcontextprotocol/sdk` (MCP server framework)
- `selenium-webdriver` (browser automation)
- `@huggingface/transformers` (ML model for scoring)

These are automatically installed via npm.

### Running as MCP Server

To use as a Model Context Protocol server (e.g., with Claude Desktop):

1. **Build the project:**

   ```bash
   npm run build
   ```

2. **Configure your MCP client** (e.g., `claude_desktop_config.json`):

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

3. **Restart your MCP client** to load the server.

The server will expose three MCP tools over stdio:

- `crawl_and_analyze`
- `get_element_locator`
- `run_critical_tests`
- `audit_aria`

---

## Configuration

### Environment Variables

Optional configuration via environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEBMCP_HEADED` | unset | Set to `1` to show the Chrome window instead of running headless |
| `WEBMCP_SEMANTIC_LOCATOR` | on | `off`, `0` or `false` makes `get_element_locator` use keyword matching only |
| `WEBMCP_LOCATOR_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model for `get_element_locator`: a Hugging Face id or a local directory |
| `WEBMCP_LOCATOR_MIN_SIMILARITY` | model default | Minimum similarity for a meaning-only locator match |
| `HF_TOKEN` | unset | Hugging Face token for a private `WEBMCP_LOCATOR_MODEL` |

Chrome is found by Selenium Manager, and the analyzer picks its ML device (WebNN, WebGPU or WASM) itself. Timeouts are per-call options on `crawl_multi_page`, not environment variables.

**Example:**

```bash
WEBMCP_HEADED=1 npm start
```

### MCP Server Configuration

The server reads from stdin and writes to stdout. No configuration files needed—it works out of the box once registered with your MCP client.

---

## API Reference

### Tool 1: `crawl_and_analyze`

Crawls a website, analyzes its DOM, and generates prioritized test cases with semantic tools.

#### Input Schema

```typescript
interface CrawlAndAnalyzeInput {
  url: string;                    // URL to crawl (required)
  format?: 'json' | 'markdown' | 'markdown-summary';  // Output format (default: 'markdown')
  ariaAudit?: boolean;            // Also return the audit_aria advisory (default: false)
}
```

#### Output Schema (JSON)

```typescript
interface CrawlAndAnalyzeOutput {
  testCases: TestCase[];         // Array of generated test cases
  semanticTools: SemanticTool[]  // Array of auto-generated tools
  metadata: {
    url: string;
    crawledAt: string;           // ISO timestamp
    totalElements: number;
    analyzedElements: number;
    highIntentElements: number;  // score >= 50
  }
}
```

#### Examples

**Basic crawl (JSON output):**

```bash
curl -X POST http://localhost:3000/tools/crawl_and_analyze \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "format": "json"
  }'
```

**Response:**

```json
{
  "testCases": [
    {
      "id": "test-1",
      "element": "Sign In button",
      "selector": "button[data-testid='sign-in']",
      "action": "click",
      "priority": "critical",
      "score": 87,
      "preconditions": [
        "User is on the login page"
      ],
      "steps": [
        "Click the Sign In button"
      ],
      "expectedResults": [
        "User should be authenticated",
        "Dashboard should load"
      ],
      "tags": ["action:click", "element:button", "destructive:false"]
    }
  ],
  "semanticTools": [
    {
      "name": "signIn",
      "description": "Sign In button",
      "inputSchema": {
        "type": "object",
        "properties": {}
      }
    }
  ],
  "metadata": {
    "url": "https://example.com",
    "crawledAt": "2026-02-28T10:30:00Z",
    "totalElements": 234,
    "analyzedElements": 54,
    "highIntentElements": 12
  }
}
```

**Markdown report:**

```json
{
  "url": "https://example.com",
  "format": "markdown"
}
```

Returns a formatted Markdown document with test cases in table format, tool definitions, and analysis summary.

**Summary format:**

```json
{
  "url": "https://example.com",
  "format": "markdown-summary"
}
```

Returns a concise Markdown overview with test counts by priority and key metrics.

---

### Tool 2: `get_element_locator`

Returns the most stable CSS or XPath locator for an element described in natural language.

#### Input Schema

```typescript
interface GetElementLocatorInput {
  description: string;    // Natural language description of element (required)
  // Uses data from most recent crawl_and_analyze call
}
```

#### How matching works

Each element from the last crawl is scored two ways:

- **Meaning**: the description and a short phrase for each element (for example `button, text: Proceed to payment`) are embedded with a local sentence model, `Xenova/all-MiniLM-L6-v2` (about 23 MB quantised). The model downloads from Hugging Face on first use and is cached; the server starts loading it after each crawl so the first lookup doesn't wait.
- **Shared words**: keywords from the description matched against the element's text, label, id, classes and placeholder. Generic words such as "button" or "link" don't count here, because they match ids and classes all over a page.

Elements are ranked by meaning, with shared words as a bounded tie-breaker. An element with no word in common counts as a match only if its similarity is at least 0.2. Unrelated descriptions measured below 0.1 against a real page, and true paraphrases from 0.26 up.

The result says which method found the element (`Matched by: semantic`, `keyword+semantic` or `keyword`). If the model can't be loaded (offline, say) or isn't ready within 15 seconds, the lookup uses keyword matching alone and says so (`keyword only`).

Set `WEBMCP_SEMANTIC_LOCATOR=off` in the server's environment to always use keyword matching alone.

To use a fine-tuned model, set `WEBMCP_LOCATOR_MODEL` to its folder or Hugging Face id, and `WEBMCP_LOCATOR_MIN_SIMILARITY` to the threshold its evaluation recommends. [training/README.md](training/README.md) covers training, evaluating and storing one.

#### Output Schema

```typescript
interface GetElementLocatorOutput {
  locator: string;        // CSS selector or XPath
  locatorType: 'css' | 'xpath';
  confidence: number;     // 0-100, higher is more reliable
  element: {
    text?: string;
    selector?: string;
    ariaLabel?: string;
  }
}
```

#### Examples

```bash
# After running crawl_and_analyze
curl -X POST http://localhost:3000/tools/get_element_locator \
  -H "Content-Type: application/json" \
  -d '{
    "description": "the submit button in the login form"
  }'
```

**Response:**

```json
{
  "locator": "button[data-testid='submit']",
  "locatorType": "css",
  "confidence": 95,
  "element": {
    "text": "Submit",
    "selector": "button[data-testid='submit']",
    "ariaLabel": "Submit form"
  }
}
```

**More examples:**

```json
// Find search input
{
  "description": "search box in the header"
}

// Find modal button
{
  "description": "close button in modal dialog"
}

// Find link by partial text
{
  "description": "terms of service link in footer"
}
```

---

### Tool 3: `run_critical_tests`

Executes high-priority test cases (score ≥ 50) using auto-generated semantic tools in the browser context.

#### Input Schema

```typescript
interface RunCriticalTestsInput {
  url: string;                   // URL to crawl and test (required)
  testIds?: string[];            // Specific test IDs to run; if omitted, runs all critical tests
  retryCount?: number;           // Re-run a failing test up to this many more times (default: 0)
  format?: 'json' | 'markdown';  // default: 'json'
}
```

#### Output Schema

```typescript
interface RunCriticalTestsOutput {
  results: TestResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
  }
}

interface TestResult {
  testId: string;
  passed: boolean;
  duration: number;        // milliseconds
  error?: string;
  assertions?: {
    actual: any;
    expected: any;
  }[]
}
```

#### Examples

```bash
# Run all critical tests from last crawl
curl -X POST http://localhost:3000/tools/run_critical_tests \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "results": [
    {
      "testId": "test-1",
      "passed": true,
      "duration": 234
    },
    {
      "testId": "test-2",
      "passed": false,
      "duration": 156,
      "error": "Element not found",
      "assertions": [
        {
          "actual": null,
          "expected": "HTMLButtonElement"
        }
      ]
    }
  ],
  "summary": {
    "totalTests": 2,
    "passed": 1,
    "failed": 1,
    "skipped": 0
  }
}
```

**Run specific tests:**

```bash
curl -X POST http://localhost:3000/tools/run_critical_tests \
  -H "Content-Type: application/json" \
  -d '{
    "testIds": ["test-1", "test-3"]
  }'
```

---

### Tool 4: `audit_aria`

An advisory review of the ARIA on a page. It is built on the first rule of ARIA, that no ARIA is better than bad ARIA, and looks for ARIA that makes the page harder to use than plain HTML would be.

It runs only when requested:

- call `audit_aria` directly (this does not load the ML model), or
- pass `"ariaAudit": true` to `crawl_and_analyze` to get the advisory alongside the test analysis (in JSON as `ariaAudit`, in Markdown as an extra section).

Findings are advice. They never turn a tool call into an error. `isError` is only set if the page could not be loaded at all.

#### Input Schema

```typescript
interface AuditAriaInput {
  url: string;                      // URL to review (required)
  format?: 'json' | 'markdown';     // default: 'markdown'
}
```

#### What every advisory contains

| Field | Meaning |
|---|---|
| `problem` | What is wrong with the markup |
| `userExperience` | How it comes across to someone using a screen reader, voice control or keyboard |
| `advice` | What to do instead |
| `ifRemoved` | What a user would lose if the ARIA were simply deleted |
| `safeToRemove` | `true` when deleting the ARIA loses nothing users get from it today |
| `severity` | `high` (blocks or misleads), `medium` (degrades), `low` (noise) |
| `fix` | `remove-aria`, `change-aria`, `add-aria` or `use-native-html` |

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

The rules are heuristics over the DOM, not a full accessibility tree. They are tuned to stay quiet when unsure. An empty report means none of these patterns were found, not that the page is accessible.

#### Example (Markdown, abridged)

```markdown
### Announced as a control but cannot be reached from the keyboard

- **Element:** `#add`: `<div id="add" role="button">`
- **What a user experiences:** A screen reader announces "button", which promises a control. But Tab never reaches it...
- **Advice:** Use the native element (<button>, <a href>, ...)...
- **If you remove this ARIA:** The "button" announcement. That announcement is currently a promise the element can't keep...
```

---

## Core Types

These TypeScript interfaces define the data structures returned by the tools. Reference them when parsing responses.

### TestCase

```typescript
interface TestCase {
  id: string;                       // Unique test ID (e.g., "test-1")
  element: string;                  // Human-readable element identifier
  selector: string;                 // CSS selector or XPath for element
  action: ActionType;               // What action to perform
  priority: 'critical' | 'high' | 'medium' | 'low';
  score: number;                    // Intent score (0-100)
  preconditions: string[];          // What must be true before test
  steps: string[];                  // Test execution steps
  expectedResults: string[];        // What should happen after
  tags: string[];                   // Filter tags (action type, element type, etc.)
  semanticToolRef?: {               // Reference to auto-generated tool
    name: string;                   // Tool name (camelCase)
    description: string;
  }
}

type ActionType =
  | 'click'                         // Click button, link
  | 'input'                         // Type into input field
  | 'submit'                        // Submit form
  | 'navigate'                      // Follow nav link
  | 'select'                        // Choose dropdown option
  | 'hover'                         // Hover over element
  | 'delete';                       // Delete/remove operation
```

### SemanticTool

```typescript
interface SemanticTool {
  name: string;                     // camelCase name (e.g., "searchButton")
  description: string;              // Human-readable description
  targetSelector: string;           // CSS selector to invoke tool on
  inputSchema: {                    // JSON Schema for tool inputs
    type: 'object';
    properties: Record<string, {
      type: string;                 // "string", "number", "boolean", etc.
      description: string;
    }>;
    required?: string[];
  };
  outputSchema?: {                  // Expected tool output structure
    type: string;
    properties?: Record<string, any>;
  };
}
```

### AnalysisResult

```typescript
interface AnalysisResult {
  selector: string;                 // CSS selector
  element: HTMLElement;             // Reference to DOM element
  score: number;                    // Intent score (0-100)
  intents: string[];                // Tags (e.g., ["action", "click"])
  reasoning: string;                // Why this element was scored
}
```

### Scoring Logic

**Intent scores** (0-100) are calculated via:

1. **Heuristic Base Score** (0-50 points):
   - Buttons, links: +40 points
   - Form inputs: +35 points
   - Interactive elements: +25 points
   - Visible + enabled: +10 points
   - Hidden/disabled: -20 points

2. **ML Semantic Score** (0-50 points):
   - Uses Transformers.js to extract text embeddings
   - Compares against test-related keywords ("button", "login", "submit", etc.)
   - Cosine similarity 0-1 scaled to 0-50

3. **Deduplication**:
   - Elements with ≥0.92 semantic similarity to existing elements are merged
   - Prevents duplicate test cases for very similar elements

**Example:** A button labeled "Sign In" with `aria-label="Sign In"`:

- Heuristic: 50 (button + visible + labeled)
- ML semantic: 45 (high similarity to "authentication")
- **Total: 95 (critical priority)**

---

## Usage Examples

### Example 1: Basic Website Test Case Generation

Crawl a website and generate test cases.

```bash
curl -X POST http://localhost:3000/tools/crawl_and_analyze \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com",
    "format": "json"
  }' > github-tests.json

cat github-tests.json
```

**Output:** JSON file with ~30-50 test cases for GitHub homepage.

### Example 2: Form Testing

Generate tests for login form and extract input locators.

```bash
# Step 1: Crawl login page
curl -X POST http://localhost:3000/tools/crawl_and_analyze \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/login",
    "format": "json"
  }' > login-tests.json

# Step 2: Get locator for email input
curl -X POST http://localhost:3000/tools/get_element_locator \
  -H "Content-Type: application/json" \
  -d '{
    "description": "email input field"
  }'

# Step 3: Get locator for password input
curl -X POST http://localhost:3000/tools/get_element_locator \
  -H "Content-Type: application/json" \
  -d '{
    "description": "password input field"
  }'

# Step 4: Run critical tests
curl -X POST http://localhost:3000/tools/run_critical_tests \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Example 3: E-commerce Checkout Flow

Test an e-commerce site's critical elements.

```javascript
// Node.js example using fetch

async function testCheckout() {
  const baseURL = 'http://localhost:3000/tools';

  // 1. Crawl checkout page
  const crawlRes = await fetch(`${baseURL}/crawl_and_analyze`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      url: 'https://myshop.com/checkout',
      format: 'json'
    })
  });

  const {testCases, semanticTools} = await crawlRes.json();

  // 2. Log critical tests
  const criticalTests = testCases.filter(t => t.priority === 'critical');
  console.log(`Found ${criticalTests.length} critical tests`);

  // 3. Find "Place Order" button locator
  const locatorRes = await fetch(`${baseURL}/get_element_locator`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      description: 'place order button'
    })
  });

  const {locator} = await locatorRes.json();
  console.log(`Place Order button: ${locator}`);

  // 4. Run critical tests
  const testRes = await fetch(`${baseURL}/run_critical_tests`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({})
  });

  const {summary} = await testRes.json();
  console.log(`Tests: ${summary.passed}/${summary.totalTests} passed`);
}

testCheckout();
```

### Example 4: Markdown Report for Stakeholders

Generate human-readable test report.

```bash
curl -X POST http://localhost:3000/tools/crawl_and_analyze \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "format": "markdown"
  }' > test-report.md

# Open in markdown viewer or convert to PDF
pandoc test-report.md -o test-report.pdf
```

### Example 5: Multi-Page Crawling with Login Automation

Crawl multiple pages including those behind a login form.

#### Setup: Store Credentials in Session

```javascript
import { MultiPageCrawler } from 'friendly-octo-train';

// Create crawler configuration
const config = {
  startUrl: 'https://protected-site.com',
  maxPages: 20,           // Crawl up to 20 pages
  maxDepth: 3,            // Max 3 levels deep
  enableAutoLogin: true,  // Enable automatic login detection (default: true)
};

// Create crawler instance
const crawler = new MultiPageCrawler(config);

// Access internal session manager and store credentials
// (These will be used when a login form is detected)
const session = crawler['sessionManager'];
session.updateState('username', process.env.LOGIN_USER || 'testuser@example.com');
session.updateState('password', process.env.LOGIN_PASS || 'testpassword123');

// Start crawling - LoginHandler will automatically:
// 1. Detect login forms
// 2. Fill username/password fields from session state
// 3. Click submit button
// 4. Validate login success (URL change + HTML indicators)
// 5. Continue crawling pages behind the login
const result = await crawler.crawl();

console.log('Crawl Results:');
console.log(`- Total pages crawled: ${result.summary.pagesVisited}`);
console.log(`- High-intent elements: ${result.summary.highIntentElements}`);
console.log(`- Workflows detected: ${result.summary.workflowsDetected}`);

// Check login success in session state
const finalState = result.session.sessionState;
if (finalState.lastLoginSuccess) {
  console.log(`✓ Login successful at ${new Date(finalState.lastLoginSuccess)}`);
} else if (finalState.lastLoginFailure) {
  console.log(`✗ Login failed: ${finalState.lastLoginFailure.reason}`);
}
```

#### How Login Automation Works

1. **Detection**: When the crawler encounters a page with:
   - URL patterns like `/login`, `/signin`, `/auth`
   - Both username/email and password input fields
   - A submit button

   The `WorkflowDetector.isLoginFormPage()` method identifies it as a login form.

2. **Form Filling**: The `LoginHandler` fills the form with credentials from session state:
   - Finds username/email input field
   - Finds password input field
   - Enters credentials

3. **Submission**: Clicks the submit button and waits for page load:
   - Handles form submit via click or JavaScript
   - Waits for page to load and stabilize (up to `pageLoadTimeout`)

4. **Validation**: Confirms login success using multiple indicators:
   - **URL change**: Page redirected away from login URL
   - **Logout button**: Presence of logout/sign-out link/button
   - **User profile**: Presence of user menu or profile element
   - **Login form gone**: Login form no longer visible on page

   If any of these indicators are positive, login is considered successful.

5. **Continuation**: After successful login, the crawler continues with the next pages:
   - Crawler now has an authenticated session
   - Can access pages normally behind login (dashboard, profile, etc.)
   - Detected workflows include authentication flows

#### Configuration Options

```typescript
interface MultiPageCrawlConfig {
  // ... existing options ...

  /** Enable automatic login form detection and filling (default: true) */
  enableAutoLogin?: boolean;

  /** Login credentials (optional - credentials can be set via session state) */
  credentials?: {
    username: string;
    password: string;
  };
}
```

#### Session State Keys

When login detection and filling occurs, the following keys are updated in session state:

| Key | Value | Purpose |
|-----|-------|---------|
| `username` | string | Username/email for login (set by application) |
| `password` | string | Password for login (set by application) |
| `lastLoginSuccess` | timestamp | When login was successful (set by LoginHandler) |
| `lastLoginFailure` | object | Details of failed login attempt |
| `lastLoginError` | object | Error details if login threw exception |

#### Environment Variables for Credentials

For security, pass credentials via environment variables:

```bash
export LOGIN_USER=testuser@example.com
export LOGIN_PASS=securepassword123
node your-script.js
```

Then in code:

```javascript
session.updateState('username', process.env.LOGIN_USER);
session.updateState('password', process.env.LOGIN_PASS);
```

#### Real-World Example: Testing Protected API Dashboard

```javascript
import { MultiPageCrawler } from 'friendly-octo-train';
import fs from 'fs';

async function auditProtectedDashboard() {
  console.log('Starting audit of protected dashboard...');

  const config = {
    startUrl: 'https://api.example.com',  // Redirects to login
    maxPages: 50,
    maxDepth: 4,
    enableAutoLogin: true,
    intentThreshold: 25,
    detectWorkflows: true,
  };

  const crawler = new MultiPageCrawler(config);

  // Set credentials from environment
  const session = crawler['sessionManager'];
  session.updateState('username', process.env.DASHBOARD_USER);
  session.updateState('password', process.env.DASHBOARD_PASS);

  // Run crawl
  const result = await crawler.crawl();

  // Analyze results
  const authWorkflows = result.session.workflows.filter(w =>
    w.tags.includes('authentication')
  );

  const pagesAfterLogin = result.session.pages.filter(p =>
    p.url.includes('/dashboard') || p.url.includes('/profile')
  );

  console.log(`\nAudit Summary:`);
  console.log(`- Pages crawled: ${result.summary.pagesVisited}`);
  console.log(`- Pages after login: ${pagesAfterLogin.length}`);
  console.log(`- Auth workflows detected: ${authWorkflows.length}`);
  console.log(`- Total high-intent elements: ${result.summary.highIntentElements}`);

  // Save full report
  fs.writeFileSync(
    'dashboard-audit-report.json',
    JSON.stringify(result, null, 2)
  );

  console.log('✓ Full report saved to dashboard-audit-report.json');
}

auditProtectedDashboard().catch(console.error);
```

#### Disabling Auto-Login

If you want to crawl only the login page without auto-login:

```javascript
const config = {
  startUrl: 'https://protected-site.com/login',
  enableAutoLogin: false,  // Disable automatic login
};

const crawler = new MultiPageCrawler(config);
const result = await crawler.crawl();
```

---

## Output Formats

### JSON Format

Fully structured data suitable for programmatic processing.

```json
{
  "testCases": [...],
  "semanticTools": [...],
  "metadata": {...}
}
```

**Use when:**

- Integrating with test frameworks (Jest, Playwright, etc.)
- Parsing and filtering results programmatically
- Storing results in databases

### Markdown Format

Complete human-readable report with tables, descriptions, and examples.

**Includes:**

- Crawl metadata (URL, timestamp, element count)
- Test case table with action, priority, preconditions
- Semantic tools table with names and descriptions
- Preconditions and expected results for each test
- Code examples for execution

**Use when:**

- Creating documentation for stakeholders
- Sharing results with humans
- Including in pull requests or issue comments
- Converting to PDF for reports

### Summary Format

Concise Markdown overview focused on metrics.

**Includes:**

- High-level summary (total tests, critical count)
- Test breakdown by priority (critical/high/medium/low)
- Semantic tools summary
- Key metrics and statistics

**Use when:**

- Quick overview without full details
- Sharing brief status updates
- Embedding in dashboards or status pages

---

## Troubleshooting

### "Browser not found" Error

```
Error: Could not find Chrome/Chromium installation
```

**Solution:**

1. Install Google Chrome from <https://google.com/chrome>
2. Selenium Manager downloads a matching chromedriver on first run, so it needs network access the first time.

### "ML Model failed to load" Error

```
Error: Failed to initialize ML model
```

**Cause:** WebNN/WebGPU unavailable, falling back to CPU inference (slower)

**Solution:**

- Wait longer for WASM model to load (first time is slowest)
- Check console logs for model loading progress
- On `crawl_multi_page`, raise `modelLoadTimeoutMs` (default 5000) so the model has time to download before heuristic scoring takes over

### "Page load timeout" Error

```
Error: Page did not load within timeout
```

**Solution:**

- Increase `pageLoadTimeout` on `crawl_multi_page` (up to 180000 ms)
- Check if URL is accessible (test in browser manually)
- Try a simpler URL first to ensure system works

### "Invalid URL" Error

```
Error: Invalid URL provided
```

**Solution:**

- Ensure URL starts with `http://` or `https://`
- No spaces in URL
- Test URL is publicly accessible

### ML Model Is Slow on First Run

The Transformers.js model downloads ~50MB on first use. This is normal:

- Subsequent runs are much faster (model cached locally)
- Model is stored in node_modules or browser cache
- First crawl may take 30-60 seconds

**To pre-download model:**

```bash
node -e "require('@huggingface/transformers').pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')"
```

### No Test Cases Generated

**Cause:** All detected elements scored below priority threshold

**Solution:**

- The page may have no interactive elements (very static page)
- Adjust scoring thresholds in analyzer (see [DEVELOPMENT.md](DEVELOPMENT.md))
- Try a page with more UI elements (e.g., form, buttons, links)

### Test Runs Return Empty Results

**Cause:** No critical tests to run, or browser context closed

**Solution:**

- Ensure `crawl_and_analyze` was called first
- Check that test count is > 0 in crawl response
- Browser context must stay open between tools

---

## Performance & Optimization

### Crawl Speed

**Typical crawl time:** 10-30 seconds depending on:

- Page complexity and size
- Network latency
- ML model inference (slower on first run)

**To speed up:**

```bash
# 1. Lower pageLoadTimeout / maxPages on crawl_multi_page for fast sites

# 2. Use summary format (skips detailed analysis)
curl -d '{"url": "...", "format": "markdown-summary"}' ...

# 3. Pre-load ML model
node -e "require('@huggingface/transformers').pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')"
```

### Memory Usage

- Headless Chrome: ~200-500 MB
- ML model: ~200 MB (first run, then cached)
- Test case storage: ~1-5 MB per crawl

**For production servers:** Consider running in separate processes or containers with memory limits.

### Parallelization

Current implementation crawls one URL at a time. For multiple URLs:

```javascript
async function crawlMultiple(urls) {
  // Sequential crawling (safer)
  for (const url of urls) {
    const result = await crawlAndAnalyze({url});
    // Process result
  }
}

// Or use a worker pool for parallel crawls
// (Requires Selenium Manager setup for each worker)
```

---

## Integration Examples

### GitHub Actions CI/CD

```yaml
name: Generate Test Cases

on:
  pull_request:
    paths: ['src/**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - run: npm install
      - run: npm run build

      - run: npm start &
        env:
          TIMEOUT: 30000

      - name: Crawl and generate tests
        run: |
          sleep 2  # Wait for server to start
          curl -X POST http://localhost:3000/tools/crawl_and_analyze \
            -H "Content-Type: application/json" \
            -d '{"url": "http://localhost:3001", "format": "markdown"}' \
            > test-report.md

      - name: Comment PR with report
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('test-report.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            });
```

### Playwright Integration

```javascript
// test.spec.js
import { crawlAndAnalyze, getElementLocator } from 'friendly-octo-train';

describe('Generated tests', () => {
  test('should pass critical elements', async () => {
    const {testCases} = await crawlAndAnalyze({
      url: 'http://localhost:3001',
      format: 'json'
    });

    const criticalTests = testCases.filter(t => t.priority === 'critical');

    for (const test of criticalTests) {
      const {locator} = await getElementLocator({
        description: test.element
      });

      const element = page.locator(locator);
      await expect(element).toBeVisible();
    }
  });
});
```

### Claude (via MCP)

Once registered with Claude Desktop:

```
User: "Crawl my website and generate test cases"

Claude: I'll use the crawl_and_analyze tool...
[runs crawl on specified URL]

Here are the critical test cases I found:
- Sign In button (score: 87)
- Email input (score: 79)
- Submit form button (score: 76)

Would you like me to run these tests or get more specific locators?
```

---

## API Limits

No hard limits, but be aware of:

- **Max page complexity:** ~5000 DOM elements (performance degradation beyond)
- **Crawl timeout:** Default 30 seconds (configurable)
- **Model inference:** ~1-2 seconds per crawl for scoring
- **Memory:** Uses ~200-500 MB Chrome + ~200 MB model

---

## Glossary

| Term | Definition |
|------|-----------|
| **Intent Score** | 0-100 rating of how important element is for testing |
| **MCP Tool** | Function exposed via Model Context Protocol |
| **Semantic Similarity** | How similar two pieces of text/meaning are (0-1 scale) |
| **Locator** | CSS selector or XPath to identify element on page |
| **Action Type** | What to do with element (click, input, submit, etc.) |
| **Priority** | Critical/High/Medium/Low based on intent score |
| **Headless Chrome** | Chrome browser without UI, controlled by code |
| **Handler** | Browser-side code that executes tool function |

---

## Next Steps

- **Using as MCP tool?** See README [Client Configuration](README.md#client-configuration)
- **Contributing?** See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and architecture
- **Issues?** Check [CONTRIBUTING.md](CONTRIBUTING.md) for bug reporting

---

**Happy testing!** For more questions, refer to [DEVELOPMENT.md](DEVELOPMENT.md) or contact the maintainers.
