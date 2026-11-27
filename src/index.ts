#!/usr/bin/env node
/**
 * Cartographer – MCP server entry point.
 *
 * Exposes, among others:
 *   crawl_and_analyze   – Crawls a URL and returns AI-generated test
 *                         recommendations.
 *   get_element_locator – Returns the most stable locator for a described
 *                         element using cached crawl data.
 *   audit_aria          – On request, advises on ARIA that is likely to make
 *                         the page harder to use with assistive technology.
 */

import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { SiteCrawler } from "./crawler.js";
import { AnalysisResult, HighIntentElement, TestExecutionSummary, MultiPageCrawlResult, DetectedWorkflow, CrawlSession } from "./types.js";
import { MarkdownExporter } from "./markdown-exporter.js";
import { TestExecutor } from "./test-executor.js";
import { SemanticToolGenerator } from "./webmcp-semantic-tools.js";
import { MultiPageCrawler } from "./multi-page-crawler.js";
import { SessionManager } from "./session-manager.js";
import { WorkflowDetector } from "./workflow-detector.js";
import { LocatorGenerator } from "./locator-generator.js";
import { BrowserAnalysisPipeline } from "./browser-pipeline.js";
import { SemanticMatcher, LOCATOR_MODEL_ENV, minSimilarityFromEnv } from "./semantic-matcher.js";
import { envSetting } from "./env.js";

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Normalize URLs by adding protocol if missing
 * www.example.com → https://www.example.com
 */
function normalizeUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // Add https:// for URLs without protocol
  return `https://${url}`;
}

// ---------------------------------------------------------------------------
// Shared singletons (initialised once)
// ---------------------------------------------------------------------------

const crawler = new SiteCrawler();

/** Browser-based analysis pipeline for Phase 2 optimization */
const browserPipeline = new BrowserAnalysisPipeline();

/**
 * Embedding model for get_element_locator, loaded on first use. Null when
 * turned off with CARTOGRAPHER_SEMANTIC_LOCATOR=off, which leaves keyword matching.
 * CARTOGRAPHER_LOCATOR_MODEL picks another model, such as a fine-tuned one.
 */
const semanticMatcher = SemanticMatcher.disabledByEnv()
  ? null
  : new SemanticMatcher({ model: envSetting(LOCATOR_MODEL_ENV) });

/**
 * Minimum similarity for a semantic-only locator match. Unset keeps the
 * default calibrated for the stock model; set it for a fine-tuned model.
 */
const locatorMinSimilarity = minSimilarityFromEnv();

/** Most-recent analysis result, used by get_element_locator. */
let lastAnalysis: AnalysisResult | null = null;

/** Session storage for multi-page crawls - maps sessionId to CrawlSession */
const sessions = new Map<string, CrawlSession>();
const sessionTimestamps = new Map<string, number>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function storeSession(sessionId: string, session: CrawlSession): void {
  evictExpiredSessions();
  sessions.set(sessionId, session);
  sessionTimestamps.set(sessionId, Date.now());
}

function evictExpiredSessions(): void {
  const now = Date.now();
  for (const [id, ts] of sessionTimestamps) {
    if (now - ts > SESSION_TTL_MS) {
      sessions.delete(id);
      sessionTimestamps.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Input schemas (validated with Zod)
// ---------------------------------------------------------------------------

const CrawlAndAnalyzeInput = z.object({
  url: z.string().url({ message: "A valid URL is required." }),
  format: z.enum(["json", "markdown", "markdown-summary"]).optional().default("markdown"),
  ariaAudit: z.boolean().optional().default(false),
});

const AuditAriaInput = z.object({
  url: z.string().url({ message: "A valid URL is required." }),
  format: z.enum(["json", "markdown"]).optional().default("markdown"),
});

const GetElementLocatorInput = z.object({
  description: z
    .string()
    .min(1, { message: "Element description cannot be empty." }),
});

const RunCriticalTestsInput = z.object({
  url: z.string().url({ message: "A valid URL is required." }),
  testIds: z.array(z.string()).optional(),
  retryCount: z.number().int().min(0).default(0).optional(),
  format: z.enum(["json", "markdown"]).optional().default("json"),
});

const CrawlMultiPageInput = z.object({
  startUrl: z.string().transform((url) => normalizeUrl(url)).pipe(z.string().url({ message: "A valid URL is required." })),
  maxPages: z.number().int().min(2).max(50).optional().default(10),
  maxDepth: z.number().int().min(1).max(5).optional().default(3),
  pageLoadTimeout: z.number().int().min(5000).max(180000).optional().default(30000),
  scriptTimeoutMs: z.number().int().min(10000).max(300000).optional().default(120000),
  analysisTimeoutMs: z.number().int().min(5000).max(240000).optional().default(90000),
  modelLoadTimeoutMs: z.number().int().min(1000).max(120000).optional().default(5000),
  detectWorkflows: z.boolean().optional().default(true),
  workflowStrategy: z.enum(["heuristic", "ml-based", "both"]).optional().default("both"),
  enableAutoLogin: z.boolean().optional().default(true),
  credentials: z.object({
    username: z.string().min(1, { message: "Username is required." }),
    password: z.string().min(1, { message: "Password is required." }),
  }).optional(),
  format: z.enum(["json", "markdown"]).optional().default("json"),
});

const GetWorkflowByNameInput = z.object({
  sessionId: z.string().min(1, { message: "Session ID is required." }),
  workflowName: z.string().min(1, { message: "Workflow name is required." }),
});

const ExportWorkflowVisualizationInput = z.object({
  sessionId: z.string().min(1, { message: "Session ID is required." }),
  workflowIds: z.array(z.string()).optional(),
  format: z.enum(["individual", "comparison", "full"]).optional().default("full"),
});

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "Cartographer", version: "1.0.0" },
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
          ariaAudit: {
            type: "boolean",
            description: "Also return an ARIA advisory for the page (see audit_aria). Off unless requested.",
            default: false,
          },
        },
        required: ["url"],
      },
    },
    {
      name: "audit_aria",
      description:
        "Advisory review of the ARIA on a page. No ARIA is better than bad ARIA: this points out roles, states and references that are likely to mislead screen reader, voice control or keyboard users. For each one it explains what the user experiences, what to do instead, and what would be lost if the ARIA were removed. Gives advice only and never reports a failure.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: {
            type: "string",
            description: "The fully-qualified URL to review (e.g. https://example.com).",
          },
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description: "Output format: 'markdown' for a readable advisory (default) or 'json' for structured findings.",
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
    {
      name: "run_critical_tests",
      description:
        "Run critical tests on a website by executing semantic webmcp tools in the browser. Only tests with intent score >= 50 are executed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: {
            type: "string",
            description: "The fully-qualified URL to test (e.g. https://example.com).",
          },
          testIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional. Specific test IDs to run. If omitted, all critical tests are executed.",
          },
          retryCount: {
            type: "number",
            description: "Number of times to retry failed tests (default: 0).",
            default: 0,
          },
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description: "Output format for results (default: json).",
            default: "json",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "crawl_multi_page",
      description:
        "Crawl multiple pages of a website starting from a URL, detect user workflows (e.g., checkout, registration, login flows), and automatically handle login forms if credentials are provided.",
      inputSchema: {
        type: "object" as const,
        properties: {
          startUrl: {
            type: "string",
            description: "The fully-qualified starting URL (e.g. https://example.com).",
          },
          maxPages: {
            type: "number",
            description: "Maximum number of pages to crawl (2-50, default: 10).",
            default: 10,
            minimum: 2,
            maximum: 50,
          },
          maxDepth: {
            type: "number",
            description: "Maximum depth from start URL (1-5, default: 3).",
            default: 3,
            minimum: 1,
            maximum: 5,
          },
          pageLoadTimeout: {
            type: "number",
            description: "Page load timeout in milliseconds (default: 30000).",
            default: 30000,
          },
          scriptTimeoutMs: {
            type: "number",
            description: "Selenium async script timeout in milliseconds (default: 120000).",
            default: 120000,
          },
          analysisTimeoutMs: {
            type: "number",
            description: "In-browser analyzer watchdog timeout in milliseconds (default: 90000).",
            default: 90000,
          },
          modelLoadTimeoutMs: {
            type: "number",
            description: "ML model initialization timeout before heuristic fallback (default: 5000).",
            default: 5000,
          },
          detectWorkflows: {
            type: "boolean",
            description: "Whether to detect workflows automatically (default: true).",
            default: true,
          },
          workflowStrategy: {
            type: "string",
            enum: ["heuristic", "ml-based", "both"],
            description: "Workflow detection strategy: 'heuristic' (pattern-based), 'ml-based' (semantic), or 'both' (default: both).",
            default: "both",
          },
          enableAutoLogin: {
            type: "boolean",
            description: "Enable automatic login form detection and filling (default: true). Requires credentials to be provided.",
            default: true,
          },
          credentials: {
            type: "object",
            description: "Login credentials for sites behind authentication. When provided, crawler will auto-detect login forms and authenticate before crawling protected pages.",
            properties: {
              username: {
                type: "string",
                description: "Username or email for login.",
              },
              password: {
                type: "string",
                description: "Password for login.",
              },
            },
            required: ["username", "password"],
          },
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description: "Output format: 'json' for structured data or 'markdown' for readable report (default: json).",
            default: "json",
          },
        },
        required: ["startUrl"],
      },
    },
    {
      name: "get_workflow_by_name",
      description:
        "Retrieve a specific detected workflow by name from a completed multi-page crawl session.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID returned from crawl_multi_page tool.",
          },
          workflowName: {
            type: "string",
            description: "Name of the workflow to retrieve (e.g., 'checkout_flow', 'login_flow', 'product_browsing_flow').",
          },
        },
        required: ["sessionId", "workflowName"],
      },
    },
    {
      name: "export_workflow_visualization",
      description:
        "Export detected workflows from a multi-page crawl session as readable markdown visualizations showing page sequences, actions, and flow diagrams.",
      inputSchema: {
        type: "object" as const,
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID returned from crawl_multi_page tool.",
          },
          workflowIds: {
            type: "array",
            items: { type: "string" },
            description: "Optional. Specific workflow IDs to export. If omitted, all workflows are exported.",
          },
          format: {
            type: "string",
            enum: ["individual", "comparison", "full"],
            description: "Export format: 'individual' (one workflow each), 'comparison' (multi-workflow analysis), or 'full' (complete report).",
            default: "full",
          },
        },
        required: ["sessionId"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "crawl_and_analyze") {
    const { url, format, ariaAudit } = CrawlAndAnalyzeInput.parse(args);

    try {
      await crawler.init();
      lastAnalysis = await crawler.crawlAndAnalyze(url, 25, { ariaAudit });
      // Load the locator model now, so the first lookup does not wait for it.
      semanticMatcher?.warmUp();
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
      if (lastAnalysis.ariaAudit) {
        output += "\n\n" + MarkdownExporter.exportAriaAudit(lastAnalysis.ariaAudit, 2);
      }
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

  if (name === "audit_aria") {
    const { url, format } = AuditAriaInput.parse(args);

    // A separate crawler so an audit never disturbs lastAnalysis or the
    // shared crawl browser.
    const auditor = new SiteCrawler();
    let report;
    try {
      await auditor.init();
      report = await auditor.auditAria(url);
    } catch (error) {
      // The page could not be loaded at all. That is a tool failure, unlike
      // findings, which are advice and never an error.
      return {
        content: [
          {
            type: "text" as const,
            text: `ARIA advisory could not run: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    } finally {
      await auditor.close().catch(() => {});
    }

    return {
      content: [
        {
          type: "text" as const,
          text: format === "json" ? JSON.stringify(report, null, 2) : MarkdownExporter.exportAriaAudit(report),
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

    // Rank by meaning when the embedding model is available, otherwise by
    // keyword overlap alone. Both run locally; no LLM call.
    const allElements = lastAnalysis.highIntentElements ?? [];
    const similarities = semanticMatcher
      ? await semanticMatcher.similarities(description, allElements)
      : null;
    const locatorGen = new LocatorGenerator({ minSimilarity: locatorMinSimilarity });
    const locator = locatorGen.generateLocator(description, allElements, similarities);

    const matchedBy = locator.matchedBy ?? "none";
    const mode = similarities ? "semantic + keyword" : "keyword only";
    return {
      content: [
        {
          type: "text" as const,
          text:
            `Locator: ${locator.selector}\nType: ${locator.type}\n` +
            `Confidence: ${(locator.confidence * 100).toFixed(0)}%\nReason: ${locator.reason}\n` +
            `Matched by: ${matchedBy} (${mode})`,
        },
      ],
    };
  }

  if (name === "run_critical_tests") {
    const { url, testIds, retryCount, format } = RunCriticalTestsInput.parse(args);

    let analysis: AnalysisResult;
    try {
      await crawler.init();
      analysis = await crawler.crawlAndAnalyze(url);
    } finally {
      await crawler.close();
    }

    // Filter to critical tests
    const criticalTests = (analysis.generatedTestCases || []).filter(
      (t) => t.priority === "critical" && t.semanticTool
    );

    // Further filter by testIds if provided
    const testsToRun = testIds
      ? criticalTests.filter((t) => testIds.includes(t.id))
      : criticalTests;

    if (testsToRun.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No critical tests found to execute.",
          },
        ],
      };
    }

    let output: string;
    try {
      // Create a new crawler instance for test execution
      const testCrawler = new SiteCrawler();
      await testCrawler.init();

      try {
        // Re-crawl to get a fresh browser with injected handlers
        const crawlResult = await testCrawler.crawlAndAnalyze(url);
        const driver = testCrawler.getDriver();
        if (!driver) throw new Error("WebDriver not available after crawl");
        const executor = new TestExecutor(driver);

        // Get semantic tool schemas
        const semanticTools = SemanticToolGenerator.generate(crawlResult.highIntentElements);

        // Execute tests
        const summary: TestExecutionSummary = await executor.executeTests(
          testsToRun,
          semanticTools,
          url,
          retryCount
        );

        if (format === "json") {
          output = JSON.stringify(summary, null, 2);
        } else {
          // Markdown format
          output = formatTestResultsMarkdown(summary);
        }
      } finally {
        await testCrawler.close();
      }
    } catch (error) {
      output = `Test execution failed: ${error instanceof Error ? error.message : String(error)}`;
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

  if (name === "crawl_multi_page") {
    const {
      startUrl,
      maxPages,
      maxDepth,
      pageLoadTimeout,
      scriptTimeoutMs,
      analysisTimeoutMs,
      modelLoadTimeoutMs,
      detectWorkflows,
      workflowStrategy,
      enableAutoLogin,
      credentials,
      format,
    } = CrawlMultiPageInput.parse(args);

    try {
      const crawler = new MultiPageCrawler({
        startUrl,
        maxPages,
        maxDepth,
          pageLoadTimeout,
          scriptTimeoutMs,
          analysisTimeoutMs,
          modelLoadTimeoutMs,
        detectWorkflows,
        workflowStrategy,
        enableAutoLogin,
        credentials,
      });

      // If credentials provided, store them in session state for login handler
      if (credentials) {
        const session = (crawler as any)['sessionManager'];
        session.updateState('username', credentials.username);
        session.updateState('password', credentials.password);
        console.error(`[index] Credentials stored in session for auto-login`);
      }

      const result = await crawler.crawl();

      // Store the session for later retrieval (TTL-bounded)
      const sessionId = result.session.sessionId;
      storeSession(sessionId, result.session);

      let output: string;
      if (format === "json") {
        output = JSON.stringify(result, null, 2);
      } else {
        // Markdown format
        output = formatMultiPageCrawlMarkdown(result, sessionId);
      }

      const zeroPageFailure =
        result.summary.pagesVisited === 0 &&
        (result.crawlErrors?.length || 0) > 0;

      if (zeroPageFailure) {
        return {
          content: [
            {
              type: "text" as const,
              text: output,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: output,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Multi-page crawl failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "get_workflow_by_name") {
    const { sessionId, workflowName } = GetWorkflowByNameInput.parse(args);

    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session not found: ${sessionId}. Available sessions: ${Array.from(sessions.keys()).join(", ") || "none"}`,
          },
        ],
        isError: true,
      };
    }

    const workflow = session.workflows.find((w) => w.name === workflowName);
    if (!workflow) {
      const availableWorkflows = session.workflows.map((w) => w.name).join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text: `Workflow not found: ${workflowName}. Available workflows: ${availableWorkflows || "none"}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(workflow, null, 2),
        },
      ],
    };
  }

  if (name === "export_workflow_visualization") {
    const { sessionId, workflowIds, format } = ExportWorkflowVisualizationInput.parse(args);

    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Session not found: ${sessionId}. Available sessions: ${Array.from(sessions.keys()).join(", ") || "none"}`,
          },
        ],
        isError: true,
      };
    }

    // Filter workflows if specific IDs provided
    const workflowsToExport = workflowIds
      ? session.workflows.filter((w) => workflowIds.includes(w.id))
      : session.workflows;

    if (workflowsToExport.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No workflows found matching the criteria.`,
          },
        ],
      };
    }

    let output: string;
    if (format === "individual") {
      // Export each workflow individually
      output = workflowsToExport
        .map((w) => MarkdownExporter.exportWorkflowSequence(w))
        .join("\n\n---\n\n");
    } else if (format === "comparison") {
      // Compare multiple workflows
      output = MarkdownExporter.exportWorkflowComparison(workflowsToExport);
    } else {
      // Full detailed report with all workflows
      output = MarkdownExporter.exportDetectedWorkflows(workflowsToExport);
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

  return {
    content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

function formatTestResultsMarkdown(summary: TestExecutionSummary): string {
  const { url, totalTests, passedTests, failedTests, results, totalDuration } = summary;

  let markdown = `# Test Execution Results\n\n`;
  markdown += `**URL:** ${url}\n`;
  markdown += `**Total Duration:** ${totalDuration}ms\n\n`;

  markdown += `## Summary\n\n`;
  markdown += `| Metric | Count |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total Tests | ${totalTests} |\n`;
  markdown += `| Passed | ${passedTests} |\n`;
  markdown += `| Failed | ${failedTests} |\n`;
  markdown += `| Pass Rate | ${((passedTests / totalTests) * 100).toFixed(1)}% |\n\n`;

  markdown += `## Test Results\n\n`;

  for (const result of results) {
    const status = result.success ? "✅ PASS" : "❌ FAIL";
    markdown += `### ${status} - ${result.testId}\n\n`;
    markdown += `- **Tool:** ${result.toolName}\n`;
    markdown += `- **Message:** ${result.message}\n`;
    markdown += `- **Duration:** ${result.duration}ms\n`;
    if (result.error) {
      markdown += `- **Error:** ${result.error}\n`;
    }
    markdown += "\n";
  }

  return markdown;
}

function formatMultiPageCrawlMarkdown(result: MultiPageCrawlResult, sessionId: string): string {
  const { session, detectedWorkflows, inferredJourneys, summary, crawlErrors } = result;

  let markdown = `# Multi-Page Crawl Results\n\n`;
  markdown += `**Session ID:** \`${sessionId}\`\n`;
  markdown += `**Start URL:** ${session.startUrl}\n\n`;

  markdown += `## Summary\n\n`;
  markdown += `| Metric | Count |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Pages Visited | ${summary.pagesVisited} |\n`;
  markdown += `| Failed Pages | ${summary.failedPages || 0} |\n`;
  markdown += `| Total Elements | ${summary.totalElements} |\n`;
  markdown += `| High-Intent Elements | ${summary.highIntentElements} |\n`;
  markdown += `| Workflows Detected | ${summary.workflowsDetected} |\n`;
  markdown += `| Estimated User Journeys | ${summary.estimatedUserJourneys} |\n\n`;

  if (crawlErrors && crawlErrors.length > 0) {
    markdown += `## Crawl Errors\n\n`;
    for (const err of crawlErrors.slice(0, 10)) {
      markdown += `- **${err.phase.toUpperCase()}** ${err.url} (depth ${err.depth}): ${err.message}\n`;
    }
    markdown += `\n`;
  }

  if (detectedWorkflows.length > 0) {
    markdown += `## Detected Workflows\n\n`;
    for (const workflow of detectedWorkflows) {
      markdown += `### ${workflow.name}\n`;
      markdown += `- **ID:** \`${workflow.id}\`\n`;
      markdown += `- **Confidence:** ${workflow.confidence}%\n`;
      markdown += `- **Pages:** ${workflow.pageSequence.length}\n`;
      markdown += `- **Tags:** ${workflow.tags.join(", ")}\n\n`;
    }
  }

  if (inferredJourneys && inferredJourneys.length > 0) {
    markdown += `## Inferred User Journeys\n\n`;
    for (const journey of inferredJourneys) {
      markdown += `### ${journey.name}\n`;
      markdown += `- **Description:** ${journey.description}\n`;
      markdown += `- **Confidence:** ${journey.confidence}%\n`;
      markdown += `- **Pages in Journey:** ${journey.pageSequence.length}\n`;
      markdown += `- **Element Patterns:** ${journey.elementPatterns.join(", ")}\n`;
      markdown += `- **Tags:** ${journey.tags.join(", ")}\n\n`;
    }
  }

  markdown += `## Usage\n\n`;
  markdown += `To retrieve a specific workflow, use:\n`;
  markdown += `\`\`\`\n`;
  markdown += `get_workflow_by_name(sessionId: "${sessionId}", workflowName: "<workflow_name>")\n`;
  markdown += `\`\`\`\n\n`;

  markdown += `To export workflow visualizations, use:\n`;
  markdown += `\`\`\`\n`;
  markdown += `export_workflow_visualization(sessionId: "${sessionId}", format: "full")\n`;
  markdown += `\`\`\`\n`;

  return markdown;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * The configured MCP server, exported so it can be driven in-process.
 *
 * Tests connect this to an in-memory transport instead of spawning the binary.
 * Running the server in a child process means none of this file's request
 * handlers are visible to coverage, which is why its 839 lines read as
 * completely untested while being exercised on every integration run.
 */
export { server };

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Cartographer MCP server running on stdio");
}

// Only auto-start when executed directly. Importing this module — which is how
// the in-process tests reach `server` — must not seize stdio, or the importing
// process's own stdout becomes a protocol stream.
const executedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
