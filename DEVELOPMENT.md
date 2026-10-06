# Development Guide

This guide covers everything you need to contribute to WebMCP-Selenium: setup, architecture, development workflow, and guidelines for adding features.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Project Structure](#project-structure)
3. [Build System](#build-system)
4. [Development Workflow](#development-workflow)
5. [Architecture Deep Dive](#architecture-deep-dive)
6. [Adding Features](#adding-features)
7. [Code Style & Conventions](#code-style--conventions)
8. [Running Tests](#running-tests)

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18 (check with `node --version`)
- **Git** (check with `git --version`)
- **Google Chrome** installed (Selenium Manager auto-configures chromedriver)
- **A code editor** (VS Code recommended)

### Initial Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd friendly-octo-train

# 2. Install dependencies
npm install

# 3. Build the project (TypeScript → JavaScript)
npm run build

# 4. Verify everything works
npm start
```

You should see:

```
[MCP Server] Starting...
[MCP Server] Ready to accept connections on stdio
```

Press `Ctrl+C` to stop the server.

---

## Project Structure

```
src/
├── index.ts                          # MCP server entry point (387 lines)
│   ├── Initializes MCP server
│   ├── Registers three tools
│   └── Main execution flow
│
├── crawler.ts                        # Selenium browser automation
│   ├── SiteCrawler class
│   ├── Launches headless Chrome
│   ├── Captures page snapshots
│   └── Extracts simplified DOM JSON
│
├── analyzer.ts                       # DOM element analysis & scoring
│   ├── DomAnalyzer class
│   ├── ML-based semantic scoring
│   ├── Heuristic scoring fallback
│   └── Semantic deduplication (0.92 threshold)
│
├── test-case-generator.ts            # Test case creation (360+ lines)
│   ├── TestCaseGenerator class
│   ├── Action type detection
│   ├── Priority assignment (critical/high/medium/low)
│   ├── Template-based test generation
│   ├── Semantic tool references
│   └── Tags for filtering (actionType, elementType, ARIA roles)
│
├── webmcp-semantic-tools.ts          # Semantic tool definition generator
│   ├── SemanticToolGenerator class
│   ├── Tool naming (camelCase from element text)
│   ├── Input/output schema generation
│   └── High-intent element filtering (score ≥ 50)
│
├── webmcp-semantic-handlers.ts       # Browser-side handler generation
│   ├── SemanticHandlerGenerator class
│   ├── Native DOM API handlers
│   ├── Handler injection logic
│   └── navigator.webmcp.tools registration
│
├── markdown-exporter.ts              # Output formatting (340+ lines)
│   ├── MarkdownExporter class
│   ├── JSON export
│   ├── Full Markdown report generation
│   └── Summary Markdown export
│
├── test-executor.ts                  # Test execution orchestration
│   ├── TestExecutor class
│   ├── Browser context management
│   └── Handler execution
│
└── types.ts                          # Shared TypeScript types
    ├── TestCase interface
    ├── SemanticTool interface
    ├── AnalysisResult interface
    └── Works in both Node.js and browser

build/                   # Compiled JavaScript output (auto-generated)
├── *.js                # Transpiled source files
├── *.d.ts              # TypeScript type definitions
└── analyzer.browser.js # Browser bundle of analyzer

test/                    # Test files
├── unit/               # node:test suites, no browser or network
├── integration/        # node:test suites against the local benchmark app
├── helpers/            # shared harnesses (fake DOM, MCP client, app lifecycle)
├── fixtures/           # page element fixtures
└── manual/             # exploration scripts, not part of the CI gate

tsconfig.json           # Node.js build configuration (ES2022)
tsconfig.browser.json   # Browser build configuration (ES2020)
package.json            # Project metadata, scripts, dependencies
```

### Key Files by Purpose

**MCP Server & Tools:**

- [src/index.ts](src/index.ts) – MCP server entry point; defines `crawl_and_analyze`, `get_element_locator`, `run_critical_tests` tools

**Crawling & Analysis:**

- [src/crawler.ts](src/crawler.ts) – Selenium automation
- [src/analyzer.ts](src/analyzer.ts) – ML scoring logic

**Test Generation & Execution:**

- [src/test-case-generator.ts](src/test-case-generator.ts) – Creates test cases with priorities and actions
- [src/test-executor.ts](src/test-executor.ts) – Runs tests in browser

**Tool & Handler Generation:**

- [src/webmcp-semantic-tools.ts](src/webmcp-semantic-tools.ts) – MCP tool schema generation
- [src/webmcp-semantic-handlers.ts](src/webmcp-semantic-handlers.ts) – Browser side handlers

**Output:**

- [src/markdown-exporter.ts](src/markdown-exporter.ts) – Formats results

**Multi-Page Crawling & Workflows:**

- [src/multi-page-crawler.ts](src/multi-page-crawler.ts) – BFS crawling engine with concurrency control
- [src/session-manager.ts](src/session-manager.ts) – State tracking across pages, visited URL tracking
- [src/workflow-detector.ts](src/workflow-detector.ts) – Detects user workflows (auth flows, form submissions, multi-step processes)
- [src/login-handler.ts](src/login-handler.ts) – Login form automation (form filling, submission, success validation)

**Types:**

- [src/types.ts](src/types.ts) – Shared interfaces (Node.js + browser compatible)

---

## Build System

### TypeScript Configuration

**Node.js Target** (`tsconfig.json`):

- ES2022 modules, CommonJS target
- Strict type checking enabled
- Outputs to `build/`

**Browser Target** (`tsconfig.browser.json`):

- ES2020 target for wider browser compatibility
- Used by esbuild to create browser bundles
- Analyzer can be injected into pages

### Build Scripts

| Script | Purpose | Output |
|--------|---------|--------|
| `npm run build` | TypeScript compilation for Node.js | `build/*.js` + `build/*.d.ts` |
| `npm run build:browser` | esbuild bundle of analyzer for injection | `build/analyzer.browser.js` |
| `npm run build:all` | Build both Node.js and browser targets | All above |
| `npm start` | Build + start MCP server | Runs server on stdio |
| `npm run dev` | Run via tsx (dev mode, no build) | Faster iteration for development |

### Development vs. Production Build

**For Development:**

```bash
npm run dev
# Uses tsx to transpile on-the-fly
# Faster iteration, no build step
# Good for editing src/ and testing immediately
```

**For Production:**

```bash
npm run build
npm start
# Pre-compiled JavaScript
# Optimized bundle
# Better error messages with source maps
```

---

## Development Workflow

### Typical Edit → Build → Test Cycle

```bash
# 1. Make changes to src/*.ts files
# (Example: Edit src/analyzer.ts to add new scoring logic)

# 2. For quick testing, use dev mode (no build step)
npm run dev
# Test your changes manually

# 3. Once satisfied, build for production
npm run build

# 4. Run tests
npm test
npm run test:integration

# 5. Commit and push
git add .
git commit -m "Add feature description"
git push origin feature-branch
```

### Running the Server Locally

```bash
# Terminal 1: Start the server
npm start

# Terminal 2: Test with a client
node --test test/integration/mcp-server.test.js
```

This tests the `crawl_and_analyze` tool on a test URL.

### Hot Module Reloading (HMR)

For rapid development, use `npm run dev` to avoid rebuild time:

```bash
# Terminal 1: Run in dev mode
npm run dev

# Terminal 2: Keep an editor open, make changes
# When you save in src/, tsx reloads automatically
```

---

## Architecture Deep Dive

### End-to-End Flow

```
User calls MCP Tool
        ↓
index.ts (MCP Server)
        ├─ Validates input with Zod
        ├─ Routes to appropriate handler
        ↓
    [crawl_and_analyze]
        ├─ SiteCrawler.crawl(url)
        │   └─ Launches headless Chrome, captures DOM
        ├─ DomAnalyzer.analyze(dom)
        │   ├─ Scores elements (heuristic + ML)
        │   └─ Deduplicates via semantic similarity
        ├─ TestCaseGenerator.generate(elements)
        │   ├─ Assigns priorities based on scores
        │   ├─ Detects action types
        │   ├─ Creates test templates
        │   └─ Generates semantic tool references
        ├─ SemanticToolGenerator.generate(elements)
        │   └─ Creates MCP tool definitions
        ├─ SemanticHandlerGenerator.generate(tools)
        │   └─ Creates browser-side handler code
        ├─ MarkdownExporter.export(result, format)
        │   └─ JSON, Markdown, or summary
        └─ Returns formatted result
```

### Key Components

#### 1. **SiteCrawler** (crawler.ts)

```typescript
const crawler = new SiteCrawler();
const {dom, logs} = await crawler.crawl("https://example.com");
```

- Launches headless Chrome via Selenium Manager
- Waits for page to load (configurable timeout)
- Extracts simplified DOM as JSON
- Captures console logs for debugging

#### 2. **DomAnalyzer** (analyzer.ts)

```typescript
const analyzer = new DomAnalyzer();
const scoredElements = await analyzer.analyze(dom);
// [
//   {selector, element, score: 87, intents: ["test", "click"]},
//   {selector, element, score: 72, intents: ["form", "input"]},
//   ...
// ]
```

**Scoring Logic:**

- **Heuristic Score**: Based on tag type, ARIA roles, attributes (0-100)
  - Buttons, links, forms: higher scores
  - Hidden, disabled, generic divs: lower scores
- **ML Semantic Score**: Transformers.js scores intent via `Xenova/all-MiniLM-L6-v2`
  - Measures relevance to test intents
  - Uses cosine similarity (0-1)
- **Deduplication**: Removes elements with ≥0.92 semantic similarity to prevent duplicate test cases

#### 3. **TestCaseGenerator** (test-case-generator.ts)

```typescript
const generator = new TestCaseGenerator();
const testCases = generator.generate(scoredElements);
// [
//   {
//     id: "test-1",
//     element: "Sign In button",
//     action: "click",
//     priority: "critical",
//     preconditions: ["User is on login page"],
//     steps: ["Click the Sign In button"],
//     expectedResults: ["User should be authenticated"]
//   },
//   ...
// ]
```

**Priority Levels:**

- Critical: score ≥ 50
- High: score ≥ 40
- Medium: score ≥ 30
- Low: score < 30

**Action Types Detected:**

- `click` – buttons, links
- `input` – text fields, inputs
- `submit` – form submission
- `navigate` – navigation links
- `select` – dropdowns, options
- `hover` – hover-triggered elements
- `delete` – delete/remove buttons

#### 4. **SemanticToolGenerator** (webmcp-semantic-tools.ts)

Converts high-intent elements (critical + high priority) into MCP tools:

```typescript
// Input element: {text: "Search button", ...}
// Output tool:
{
  name: "search",
  description: "Search button",
  inputSchema: {
    type: "object",
    properties: {
      query: {type: "string", description: "Search query"}
    }
  }
}
```

#### 5. **SemanticHandlerGenerator** (webmcp-semantic-handlers.ts)

Generates browser-side code executed for each tool:

```javascript
// Injected into page
navigator.webmcp.tools.search = async (params) => {
  const button = document.querySelector("[aria-label='Search button']");
  button.click();
  return {success: true};
};
```

#### 7. **MultiPageCrawler & LoginHandler** (multi-page-crawler.ts, login-handler.ts)

For sites that require authentication, the multi-page crawler includes automatic login support:

```
MultiPageCrawler.crawl()
    ↓
BFS Queue: [{ url, depth }]
    ↓
For each URL:
    ├─ SiteCrawler.crawlAndAnalyze(url)  // Analyze page
    ├─ Add page to session
    ├─ Check if login form detected
    │   └─ If yes + credentials available:
    │       ├─ LoginHandler.findLoginFields()     // Find username/password fields
    │       ├─ LoginHandler.fillLoginForm()       // Fill with credentials from session
    │       ├─ LoginHandler.submitForm()          // Click submit or call form.submit()
    │       ├─ LoginHandler.waitForPageLoad()     // Wait for page to load
    │       └─ LoginHandler.validateLoginSuccess() // Check URL change + HTML indicators
    │           └─ Update session state (success/failure)
    ├─ Extract navigation targets from page
    └─ Queue unvisited links for next iteration
    ↓
Return MultiPageCrawlResult with all pages, workflows, metadata
```

**Key Classes:**

**WorkflowDetector** (workflow-detector.ts)

- `detect()`: Main entry point calling heuristic and ML-based detection
- `detectAuthFlows()`: Identifies login→dashboard sequences
- `isLoginFormPage()`: Checks if a page is a login form (90+ confidence)
- `detectFormSubmissionFlows()`: Identifies form → success patterns
- `detectMultiStepForms()`: Identifies multi-step form sequences

**LoginHandler** (login-handler.ts)

- `findLoginFields()`: Locates username/email and password inputs
- `findSubmitButton()`: Locates form submit button
- `fillLoginForm(username, password)`: Fills form fields with credentials
- `submitForm()`: Sends form data (via click or JavaScript)
- `waitForPageLoad(timeout)`: Waits for page to stabilize after submission
- `validateLoginSuccess(originalUrl)`: Confirms login via URL change + HTML indicators
- `performLogin()`: Complete flow: fill → submit → validate

**SessionManager** (session-manager.ts)

- `updateState(key, value)`: Store credentials before crawl or results after
- `getState()`: Retrieve session state
- `addPage()`: Track crawled pages
- `recordNavigation()`: Track navigation graph

---

## Adding Features

### Adding a New Action Type

Example: Add "drag-drop" action type.

**Step 1:** Update [src/types.ts](src/types.ts)

```typescript
export type ActionType =
  | "click"
  | "input"
  | "submit"
  | "navigate"
  | "select"
  | "hover"
  | "delete"
  | "drag-drop";  // ← Add here
```

**Step 2:** Update [src/test-case-generator.ts](src/test-case-generator.ts) to detect and generate tests for drag-drop

```typescript
detectActionType(element): ActionType {
  // ...existing logic...

  // Add new detection
  if (element.getAttribute('draggable') === 'true') {
    return 'drag-drop';
  }
}

generateTestSteps(action: ActionType): string[] {
  // ...switch statements...
  case 'drag-drop':
    return [
      `Locate source element: ${this.element}`,
      `Locate target element`,
      `Perform drag-drop operation`,
    ];
}

generateExpectedResults(action: ActionType): string[] {
  // ...switch statements...
  case 'drag-drop':
    return [`Element should be moved to target location`];
}
```

**Step 3:** Update [src/webmcp-semantic-handlers.ts](src/webmcp-semantic-handlers.ts) with browser handler

```typescript
case 'drag-drop':
  return `
    navigator.webmcp.tools.${toolName} = async (params) => {
      const source = document.querySelector("${selector}");
      const target = document.querySelector(params.targetSelector);

      const dragEvent = new DragEvent('dragstart', {bubbles: true});
      source.dispatchEvent(dragEvent);

      const dropEvent = new DragEvent('drop', {bubbles: true});
      target.dispatchEvent(dropEvent);

      return {success: true};
    };
  `;
```

### Modifying Scoring Logic

To adjust how elements are scored:

**File:** [src/analyzer.ts](src/analyzer.ts)

```typescript
// Heuristic scoring weights
const scoreElement(element) {
  let score = 0;

  // Base scores by tag type
  if (['BUTTON', 'A', 'INPUT'].includes(element.tagName)) {
    score += 50;  // ← Adjust weights here
  }

  // Bonus for ARIA labels
  if (element.getAttribute('aria-label')) {
    score += 15;  // ← Or here
  }

  return Math.min(score, 100);
}
```

### Creating a New MCP Tool

Example: Add `analyze_performance` tool to measure page load metrics.

**Step 1:** Add tool definition in [src/index.ts](src/index.ts)

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const {name, arguments: args} = request.params;

  if (name === 'analyze_performance') {
    return {
      content: [
        {
          type: 'text',
          text: await analyzePagePerformance(args.url)
        }
      ]
    };
  }
});
```

**Step 2:** Implement the handler

```typescript
async function analyzePagePerformance(url: string) {
  const crawler = new SiteCrawler();
  const {dom, logs} = await crawler.crawl(url);

  // Extract performance metrics from logs
  // Return formatted results
  return JSON.stringify({metrics});
}
```

**Step 3:** Register the tool schema

```typescript
const tools = [
  {
    name: 'analyze_performance',
    description: 'Analyze page performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        url: {type: 'string', description: 'URL to analyze'}
      },
      required: ['url']
    }
  }
  // ...other tools
];
```

---

## Code Style & Conventions

### TypeScript

- Use **strict mode**: All variables typed, no `any`
- **Interfaces** for external contracts; **types** for internal unions
- **Descriptive names**: `scoredElements` not `arr`, `analyzeDOM` not `process`
- **Comments** for complex logic, especially ML scoring

```typescript
// Good
interface AnalysisResult {
  selector: string;
  score: number;
  intents: string[];
}

async function analyzeDOM(dom: DOM): Promise<AnalysisResult[]> {
  // Implementation
}

// Avoid
const analyze = (d) => {
  // returns arr
};
```

### Error Handling

Use proper error classes and messages:

```typescript
// Good
if (!url || url.length === 0) {
  throw new Error('Invalid URL: URL is required');
}

// Avoid
if (!url) throw 'bad url';
```

### Module Exports

- Export **classes** and **types** from modules
- Use **named exports** for clarity

```typescript
// src/analyzer.ts
export class DomAnalyzer { ... }
export interface ScoredElement { ... }

// src/index.ts
import { DomAnalyzer, ScoredElement } from './analyzer';
```

### Type Safety

Always export types used in function signatures:

```typescript
// src/types.ts (shared)
export interface TestCase {
  id: string;
  action: ActionType;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// src/test-case-generator.ts
import { TestCase } from './types';
export class TestCaseGenerator {
  generate(): TestCase[] { ... }
}
```

---

## Running Tests

### Unit & Integration Tests

```bash
# Run semantic tools tests
npm test
# Tests browser-side tool behavior

# Test MCP server communication
npm run test:integration
# Verifies server protocol with client
```

### Manual Testing

**Test the full crawl-and-analyze flow:**

```bash
npm start &  # Start server in background
sleep 2

# Call crawl_and_analyze tool
node --test test/integration/mcp-server.test.js

# Kill server
pkill -f "node.*index.js"
```

**Test specific components:**

```typescript
// test-analyzer.ts
import { DomAnalyzer } from './src/analyzer';

const analyzer = new DomAnalyzer();
const score = await analyzer.analyze(testDOM);
console.log(score);
```

### Debugging

Use `npm run dev` and add console logs:

```typescript
// src/analyzer.ts
console.log('Analyzing element:', element.tagName);
console.log('Score:', score);
```

Watch output in terminal as tests run.

---

## Common Tasks

### Update Dependencies

```bash
npm update
npm audit fix  # Fix security issues
```

### Generate Browser Bundle After Changes

```bash
npm run build:browser
# Updates build/analyzer.browser.js
```

### Check for TypeScript Errors

```bash
npx tsc --noEmit
# Validates without building
```

### Format Code (if prettier installed)

```bash
npm run format
# or manually with prettier
npx prettier --write src/
```

---

## Resources

- **TypeScript Handbook**: <https://www.typescriptlang.org/docs/>
- **MCP SDK**: <https://github.com/modelcontextprotocol/typescript-sdk>
- **Transformers.js**: <https://huggingface.co/docs/transformers.js>
- **Selenium WebDriver**: <https://www.selenium.dev/documentation/webdriver/>
- **Zod Validation**: <https://zod.dev/>

---

## Getting Help

- Check existing issues/PRs on GitHub
- Review [USAGE.md](USAGE.md) for API examples
- Look at test files for usage examples
- Run `npm run dev` to test locally before asking

---

**Ready to contribute?** Start with a small fix or feature, test thoroughly, and submit a PR. We look forward to your improvements!
