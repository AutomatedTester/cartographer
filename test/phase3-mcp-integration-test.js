/**
 * Phase 3 MCP Integration Test
 * Tests the new MCP tools for multi-page crawling and workflow management:
 * - crawl_multi_page tool
 * - get_workflow_by_name tool
 * - export_workflow_visualization tool
 */

import assert from "assert";
import { MultiPageCrawler } from "../build/multi-page-crawler.js";
import { SessionManager } from "../build/session-manager.js";
import { WorkflowDetector } from "../build/workflow-detector.js";
import { MarkdownExporter } from "../build/markdown-exporter.js";

// Test utilities
function createMockCrawledPage(url, title, elements = []) {
    return {
        url,
        title,
        timestamp: Date.now(),
        highIntentElements: elements,
        consoleLogs: [],
    };
}

function createMockHighIntentElement(
    tag,
    text,
    intentScore,
    navigates = false,
    navigationTarget = "",
    attributes = {}
) {
    return {
        path: `div > ${tag}`,
        tag,
        text,
        locator: `#element-${Math.random().toString(36).substr(2, 5)}`,
        intentReasons: ["high-intent-keyword", "user-interaction"],
        intentScore,
        navigates,
        navigationTarget,
        attributes,
    };
}

function createMockCrawlSession(pages) {
    return {
        sessionId: `session-${Date.now()}`,
        startUrl: pages[0].url,
        pages,
        metadata: {
            startTime: Date.now(),
            totalPages: pages.length,
            totalElementsAnalyzed: pages.reduce((sum, p) => sum + p.highIntentElements.length, 0),
            totalHighIntentElements: pages.reduce((sum, p) => sum + p.highIntentElements.length, 0),
        },
        sessionState: {},
        workflows: [],
    };
}

// Test Suite
console.log("Starting Phase 3 MCP Integration Tests...\n");

// Test 1: Session Storage Simulation
console.log("Test 1: Simulate session storage for MCP tool calls");
try {
    const sessions = new Map();

    // Create a mock crawl session
    const pages = [
        createMockCrawledPage("https://example.com/category", "Category", [
            createMockHighIntentElement("a", "Product 1", 80, true),
            createMockHighIntentElement("a", "Product 2", 78, true),
        ]),
        createMockCrawledPage("https://example.com/product/1", "Product 1", [
            createMockHighIntentElement("button", "Add to Cart", 88),
            createMockHighIntentElement("a", "Checkout", 85, true),
        ]),
        createMockCrawledPage("https://example.com/checkout", "Checkout", [
            createMockHighIntentElement("form", "", 0, false, "", { role: "form" }),
            createMockHighIntentElement("input", "Email", 85),
            createMockHighIntentElement("button", "Continue", 87, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/success", "Order Confirmed", [
            createMockHighIntentElement("h1", "Thank you", 80),
            createMockHighIntentElement("a", "Home", 70, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    // Simulate MCP tool storing session
    const sessionId = session.sessionId;
    sessions.set(sessionId, session);

    assert(sessions.has(sessionId), "Session should be stored");
    assert(sessions.get(sessionId).workflows.length > 0, "Session should have workflows");

    console.log(`✓ Session storage working`);
    console.log(`  Session ID: ${sessionId}`);
    console.log(`  Stored workflows: ${sessions.get(sessionId).workflows.length}\n`);
} catch (error) {
    console.error(`✗ Session storage failed: ${error.message}\n`);
}

// Test 2: get_workflow_by_name simulation
console.log("Test 2: Simulate get_workflow_by_name MCP tool");
try {
    const sessions = new Map();

    const pages = [
        createMockCrawledPage("https://example.com/login", "Login", [
            createMockHighIntentElement("input", "Username", 85, false, "", { type: "text" }),
            createMockHighIntentElement("input", "Password", 90, false, "", { type: "password" }),
            createMockHighIntentElement("button", "Login", 92, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/dashboard", "Dashboard", [
            createMockHighIntentElement("h1", "Welcome", 75),
            createMockHighIntentElement("a", "Profile", 70, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    const sessionId = session.sessionId;
    sessions.set(sessionId, session);

    // Simulate get_workflow_by_name call
    const workflowName = workflows[0].name;
    const workflow = session.workflows.find((w) => w.name === workflowName);

    assert(workflow, "Should find workflow by name");
    assert.strictEqual(workflow.name, workflowName, "Workflow name should match");

    console.log(`✓ get_workflow_by_name simulation successful`);
    console.log(`  Session ID: ${sessionId}`);
    console.log(`  Found workflow: ${workflow.name}`);
    console.log(`  Confidence: ${workflow.confidence}%\n`);
} catch (error) {
    console.error(`✗ get_workflow_by_name simulation failed: ${error.message}\n`);
}

// Test 3: export_workflow_visualization (individual)
console.log("Test 3: Simulate export_workflow_visualization with individual format");
try {
    const pages = [
        createMockCrawledPage("https://example.com/", "Home", [
            createMockHighIntentElement("a", "Shop", 80, true),
        ]),
        createMockCrawledPage("https://example.com/products", "Products", [
            createMockHighIntentElement("a", "Product 1", 85, true),
        ]),
        createMockCrawledPage("https://example.com/product/1", "Product 1", [
            createMockHighIntentElement("button", "Buy", 88),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    // Simulate individual format export
    if (workflows.length > 0) {
        const visualization = MarkdownExporter.exportWorkflowSequence(workflows[0]);

        assert(visualization.includes("# Workflow:"), "Should have workflow heading");
        assert(visualization.includes("Confidence:"), "Should include confidence");

        console.log(`✓ Individual workflow visualization generated`);
        console.log(`  Workflow: ${workflows[0].name}`);
        console.log(`  Markdown length: ${visualization.length} characters\n`);
    }
} catch (error) {
    console.error(`✗ Individual visualization failed: ${error.message}\n`);
}

// Test 4: export_workflow_visualization (full)
console.log("Test 4: Simulate export_workflow_visualization with full format");
try {
    const pages = [
        createMockCrawledPage("https://example.com/", "Home", [
            createMockHighIntentElement("a", "Register", 80, true),
        ]),
        createMockCrawledPage("https://example.com/signup", "Sign Up", [
            createMockHighIntentElement("input", "Email", 85),
            createMockHighIntentElement("button", "Next", 88),
        ]),
        createMockCrawledPage("https://example.com/setup", "Setup Profile", [
            createMockHighIntentElement("input", "Name", 84),
            createMockHighIntentElement("button", "Complete", 87),
        ]),
        createMockCrawledPage("https://example.com/dashboard", "Dashboard", [
            createMockHighIntentElement("h1", "Welcome", 75),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    // Simulate full format export
    const fullVisualization = MarkdownExporter.exportDetectedWorkflows(workflows);

    assert(fullVisualization.includes("# Detected Workflows"), "Should have main heading");
    assert(fullVisualization.includes("Workflow Summary"), "Should have summary section");

    console.log(`✓ Full report visualization generated`);
    console.log(`  Total workflows: ${workflows.length}`);
    console.log(`  Markdown length: ${fullVisualization.length} characters\n`);
} catch (error) {
    console.error(`✗ Full visualization failed: ${error.message}\n`);
}

// Test 5: Multiple workflow detection for comparison
console.log("Test 5: Simulate export_workflow_visualization with comparison format");
try {
    const pages = [
        createMockCrawledPage("https://example.com/", "Home", [
            createMockHighIntentElement("a", "Login", 85, true),
            createMockHighIntentElement("a", "Browse", 75, true),
        ]),
        createMockCrawledPage("https://example.com/login", "Login", [
            createMockHighIntentElement("input", "Username", 85, false, "", { type: "text" }),
            createMockHighIntentElement("input", "Password", 90, false, "", { type: "password" }),
            createMockHighIntentElement("button", "Login", 92, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/dashboard", "Dashboard", [
            createMockHighIntentElement("h1", "Welcome", 80),
        ]),
        createMockCrawledPage("https://example.com/products", "Products", [
            createMockHighIntentElement("a", "Product A", 80, true),
            createMockHighIntentElement("a", "Product B", 78, true),
        ]),
        createMockCrawledPage("https://example.com/product/a", "Product A", [
            createMockHighIntentElement("button", "Add to Cart", 85),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    if (workflows.length >= 2) {
        const comparison = MarkdownExporter.exportWorkflowComparison(workflows.slice(0, 2));

        assert(comparison.includes("# Workflow Comparison"), "Should have comparison heading");
        assert(comparison.includes("Workflow"), "Should list workflows");

        console.log(`✓ Workflow comparison generated`);
        console.log(`  Compared workflows: ${Math.min(2, workflows.length)}`);
        console.log(`  Markdown length: ${comparison.length} characters\n`);
    } else {
        console.log(`⊘ Insufficient workflows for comparison (need 2+, found ${workflows.length})\n`);
    }
} catch (error) {
    console.error(`✗ Comparison visualization failed: ${error.message}\n`);
}

// Test 6: Error handling - workflow not found
console.log("Test 6: Simulate error handling for missing workflow");
try {
    const sessions = new Map();

    const pages = [
        createMockCrawledPage("https://example.com/page1", "Page 1", [
            createMockHighIntentElement("a", "Next", 80, true),
        ]),
        createMockCrawledPage("https://example.com/page2", "Page 2", [
            createMockHighIntentElement("a", "Prev", 75, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    const sessionId = session.sessionId;
    sessions.set(sessionId, session);

    // Try to get non-existent workflow
    const nonExistentWorkflow = session.workflows.find((w) => w.name === "non_existent_flow");

    if (!nonExistentWorkflow) {
        console.log(`✓ Correctly handled missing workflow`);
        console.log(`  Available workflows: ${session.workflows.map((w) => w.name).join(", ") || "none"}\n`);
    }
} catch (error) {
    console.error(`✗ Error handling failed: ${error.message}\n`);
}

// Test 7: Error handling - session not found
console.log("Test 7: Simulate error handling for missing session");
try {
    const sessions = new Map();
    const nonExistentSessionId = "session-9999999";

    const session = sessions.get(nonExistentSessionId);

    if (!session) {
        console.log(`✓ Correctly detected missing session`);
        console.log(`  Looked for: ${nonExistentSessionId}`);
        console.log(`  Available sessions: ${Array.from(sessions.keys()).join(", ") || "none"}\n`);
    }
} catch (error) {
    console.error(`✗ Session error handling failed: ${error.message}\n`);
}

// Test 8: Markdown export input/output validation
console.log("Test 8: Validate MCP tool output formatting");
try {
    const pages = [
        createMockCrawledPage("https://example.com/step1", "Step 1", [
            createMockHighIntentElement("button", "Next", 85),
        ]),
        createMockCrawledPage("https://example.com/step2", "Step 2", [
            createMockHighIntentElement("button", "Continue", 85),
        ]),
        createMockCrawledPage("https://example.com/step3", "Step 3", [
            createMockHighIntentElement("h1", "Success", 80),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    session.workflows = workflows;

    if (workflows.length > 0) {
        // Verify JSON-serializable output
        const jsonOutput = JSON.stringify(workflows[0], null, 2);
        assert(jsonOutput.includes("id"), "JSON should include workflow ID");
        assert(jsonOutput.includes("name"), "JSON should include workflow name");
        assert(jsonOutput.includes("confidence"), "JSON should include confidence");

        // Verify markdown output
        const markdownOutput = MarkdownExporter.exportWorkflowSequence(workflows[0]);
        assert(typeof markdownOutput === "string", "Markdown output should be string");
        assert(markdownOutput.length > 0, "Markdown output should not be empty");

        console.log(`✓ Output formatting validated`);
        console.log(`  JSON size: ${jsonOutput.length} bytes`);
        console.log(`  Markdown size: ${markdownOutput.length} bytes\n`);
    }
} catch (error) {
    console.error(`✗ Output validation failed: ${error.message}\n`);
}

console.log("========================================");
console.log("Phase 3 MCP Integration Tests Complete!");
console.log("========================================");
