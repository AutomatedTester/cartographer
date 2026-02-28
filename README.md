# WebMCP-Selenium

A local **Model Context Protocol (MCP)** server that combines **Selenium** browser automation with a **local ML model** (via [Transformers.js](https://huggingface.co/docs/transformers.js)) to crawl a website, analyse its DOM, and generate a prioritised list of test candidates.

---

## Quick Start

Get up and running in 5 minutes:

```bash
# 1. Install dependencies
npm install

# 2. Build the project
npm run build

# 3. Start the MCP server
npm start
```

Then configure your MCP client (e.g., Claude Desktop) to use this server—see [Client Configuration](#client-configuration) below.

For detailed usage examples and API reference, see [USAGE.md](USAGE.md).

---

## Key Features

- **Automated Web Crawling**: Headless Chrome via Selenium extracts pages and DOM structure
- **Intelligent Element Analysis**: ML-powered semantic scoring identifies high-risk/high-value elements on the page
- **Test Case Generation**: Automatically generates structured test cases with:
  - Priority levels (critical, high, medium, low) based on intent scores
  - Action type detection (click, input, submit, form interaction, etc.)
  - Contextual preconditions and expected results
  - Semantic tool references for execution
- **Semantic WebMCP Tools**: Auto-generated domain-specific tools for browser-side execution
- **Multiple Output Formats**: JSON, detailed Markdown reports, or summary Markdown
- **Natural Language Locators**: Find stable CSS/XPath selectors for any element by describing it

---

## Documentation Map

| Document | Use Case |
|----------|----------|
| **This README** | Project overview, quick start, MCP tool reference |
| **[USAGE.md](USAGE.md)** | Comprehensive guide to using the library, API reference, examples, troubleshooting |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | Instructions for contributors: setup, architecture, development workflow, adding features |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Guidelines for reporting issues and submitting pull requests |

See [ANALYSIS_BSTACKDEMO.md](ANALYSIS_BSTACKDEMO.md) for a real-world example of crawl results.

---

## Architecture

Core modules that work together:

| File | Responsibility |
|---|---|
| `src/crawler.ts` | `SiteCrawler` – headless Chrome via Selenium, extracts DOM snapshots |
| `src/analyzer.ts` | `DomAnalyzer` – semantic ML scoring identifies high-risk elements via `Xenova/all-MiniLM-L6-v2` |
| `src/test-case-generator.ts` | `TestCaseGenerator` – creates structured test cases from high-intent elements |
| `src/webmcp-semantic-tools.ts` | `SemanticToolGenerator` – auto-generates domain-specific MCP tools |
| `src/webmcp-semantic-handlers.ts` | `SemanticHandlerGenerator` – creates browser-side handlers for tools |
| `src/markdown-exporter.ts` | `MarkdownExporter` – formats output in multiple formats (JSON/Markdown) |
| `src/test-executor.ts` | `TestExecutor` – orchestrates test execution in browser context |
| `src/index.ts` | MCP server entry point; exposes three MCP tools over stdio |

---

## Prerequisites

- Node.js ≥ 18
- Google Chrome installed (Selenium Manager handles chromedriver automatically)

---

## Development Setup

For detailed setup and development workflow, see [DEVELOPMENT.md](DEVELOPMENT.md).

Quick build variants:

```bash
npm run build        # Compile TypeScript
npm run build:browser # Compile analyzer for browser injection
npm start           # Build + start MCP server
npm run dev         # Run with tsx (no build step)
npm test            # Run test suites
```

---

## MCP Tools

### 1. `crawl_and_analyze`

Crawls a URL with headless Chrome, analyses the DOM, flags brittle elements, and generates test cases.

**Input**

```json
{
  "url": "https://example.com",
  "outputFormat": "json"
}
```

**Output**: Prioritised test cases with intent scores, action types, and preconditions. See [USAGE.md](USAGE.md#crawl_and_analyze) for full documentation and examples.

### 2. `get_element_locator`

Returns the most stable CSS/XPath locator for an element described in natural language, based on the most recent crawl.

**Input**

```json
{
  "description": "the submit button in the login form"
}
```

**Output**: Stable CSS or XPath locator string. See [USAGE.md](USAGE.md#get_element_locator) for examples.

### 3. `run_critical_tests`

Executes high-priority test cases (intent score ≥ 50) using auto-generated semantic tools. Tests are run directly in browser via native DOM APIs.

**Input**

```json
{
  "testIds": ["test-1", "test-2"]
}
```

**Output**: Test execution results with pass/fail status and assertions. See [USAGE.md](USAGE.md#run_critical_tests) for details.

---

## Client Configuration

Add the following to your `claude_desktop_config.json` (or equivalent MCP client settings):

```json
"web-mcp-selenium": {
  "command": "node",
  "args": ["/path/to/project/build/index.js"]
}
```

Replace `/path/to/project` with the absolute path to this repository.
