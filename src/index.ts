#!/usr/bin/env node
/**
 * WebMCP-Selenium – MCP server entry point.
 *
 * Exposes two tools:
 *   crawl_and_analyze   – Crawls a URL and returns AI-generated test
 *                         recommendations.
 *   get_element_locator – Returns the most stable locator for a described
 *                         element using cached crawl data.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { SiteCrawler } from "./crawler.js";
import { AnalysisResult, HighIntentElement } from "./types.js";
import { MarkdownExporter } from "./markdown-exporter.js";

// ---------------------------------------------------------------------------
// Shared singletons (initialised once)
// ---------------------------------------------------------------------------

const crawler = new SiteCrawler();

/** Most-recent analysis result, used by get_element_locator. */
let lastAnalysis: AnalysisResult | null = null;

// ---------------------------------------------------------------------------
// Input schemas (validated with Zod)
// ---------------------------------------------------------------------------

const CrawlAndAnalyzeInput = z.object({
  url: z.string().url({ message: "A valid URL is required." }),
  format: z.enum(["json", "markdown", "markdown-summary"]).optional().default("markdown"),
});

const GetElementLocatorInput = z.object({
  description: z
    .string()
    .min(1, { message: "Element description cannot be empty." }),
});

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "WebMCP-Selenium", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "crawl_and_analyze",
      description:
        "Crawl a web page with Selenium and use a local ML model to identify brittle elements and auto-generate test cases.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: {
            type: "string",
            description: "The fully-qualified URL to crawl (e.g. https://example.com).",
          },
          format: {
            type: "string",
            enum: ["json", "markdown", "markdown-summary"],
            description: "Output format: 'json' for structured data, 'markdown' for full report with test cases, 'markdown-summary' for concise list",
            default: "markdown",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "get_element_locator",
      description:
        "Return the most stable CSS or XPath locator for an element described in natural language, based on the most recent crawl.",
      inputSchema: {
        type: "object" as const,
        properties: {
          description: {
            type: "string",
            description: "Natural-language description of the element to locate (e.g. 'the submit button in the login form').",
          },
        },
        required: ["description"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "crawl_and_analyze") {
    const { url, format } = CrawlAndAnalyzeInput.parse(args);

    try {
      await crawler.init();
      lastAnalysis = await crawler.crawlAndAnalyze(url);
    } finally {
      await crawler.close();
    }

    // Format output based on user preference
    let output: string;
    if (format === "json") {
      output = JSON.stringify(lastAnalysis, null, 2);
    } else if (format === "markdown-summary") {
      output = lastAnalysis.generatedTestCases
        ? MarkdownExporter.exportTestCasesList(lastAnalysis.generatedTestCases)
        : "No test cases generated";
    } else {
      // Default to "markdown" - full report
      output = MarkdownExporter.exportFull(lastAnalysis);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: output,
        },
      ],
    };
  }

  if (name === "get_element_locator") {
    const { description } = GetElementLocatorInput.parse(args);

    if (!lastAnalysis) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No crawl data available. Run crawl_and_analyze first.",
          },
        ],
        isError: true,
      };
    }

    // Use highIntentElements instead of priorityTestList
    const best = findBestCandidate(
      lastAnalysis.highIntentElements ?? [],
      description
    );
    return {
      content: [
        {
          type: "text" as const,
          text: best
            ? JSON.stringify(best, null, 2)
            : `No matching element found for: "${description}"`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ---------------------------------------------------------------------------
// Utility: pick the best matching test candidate for a description
// ---------------------------------------------------------------------------

/**
 * Simple keyword-overlap heuristic to match a natural-language description
 * to a high-intent element without requiring an extra model call.
 */
function findBestCandidate(
  candidates: HighIntentElement[],
  description: string
): HighIntentElement | null {
  if (candidates.length === 0) return null;

  const queryTokens = tokenize(description);

  let bestScore = -1;
  let best: HighIntentElement | null = null;

  for (const candidate of candidates) {
    // Build a searchable string from element attributes
    const candidateText = [
      candidate.tag,
      candidate.id,
      candidate.classes?.join(" "),
      candidate.ariaLabel,
      candidate.text,
      candidate.role,
      candidate.intentReasons?.join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    const candidateTokens = tokenize(candidateText);
    const overlap = queryTokens.filter((t) => candidateTokens.includes(t))
      .length;
    const score = overlap / (queryTokens.length + 1);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebMCP-Selenium MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
