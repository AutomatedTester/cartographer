# WebMCP-Selenium

A local **Model Context Protocol (MCP)** server that combines **Selenium** browser automation with a **local ML model** (via [Transformers.js](https://huggingface.co/docs/transformers.js)) to crawl a website, analyse its DOM, and generate a prioritised list of test candidates.

---

## Architecture

| File | Responsibility |
|---|---|
| `src/crawler.ts` | `SiteCrawler` – headless Chrome via Selenium, extracts a simplified DOM JSON + console logs |
| `src/analyzer.ts` | `DomAnalyzer` – uses `Xenova/all-MiniLM-L6-v2` (WebNN → WebGPU → CPU fallback) to rank risky elements |
| `src/index.ts` | MCP server exposing two tools over stdio |

---

## Prerequisites

- Node.js ≥ 18
- Google Chrome installed (Selenium Manager handles chromedriver automatically)

---

## Setup

```bash
npm install
npm run build
```

---

## MCP Tools

### `crawl_and_analyze`

Crawls a URL with headless Chrome, flags brittle DOM elements, and returns a prioritised JSON test list.

**Input**
```json
{ "url": "https://example.com" }
```

### `get_element_locator`

Returns the most stable CSS/XPath locator for an element described in natural language, using data from the most recent crawl.

**Input**
```json
{ "description": "the submit button in the login form" }
```

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
