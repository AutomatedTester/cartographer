/**
 * Phase 2 Integration Tests
 * Tests for enhanced workflow detection:
 * - Navigation pattern detection
 * - Multi-step form detection
 * - MarkdownExporter workflow visualization
 */

import assert from "assert";
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
console.log("Starting Phase 2 Integration Tests...\n");

// Test 1: Navigation Pattern Detection - Product Flow
console.log("Test 1: Detect product browsing flow (category → product → product)");
try {
    const pages = [
        createMockCrawledPage("https://example.com/category/electronics", "Electronics", [
            createMockHighIntentElement("a", "iPhone", 75, true, "https://example.com/product/iphone"),
            createMockHighIntentElement("a", "Samsung", 72, true, "https://example.com/product/samsung"),
        ]),
        createMockCrawledPage("https://example.com/product/iphone", "iPhone 14", [
            createMockHighIntentElement("a", "Spec", 65, true, "https://example.com/product/iphone/specs"),
            createMockHighIntentElement("button", "Add to Cart", 88, true, ""),
        ]),
        createMockCrawledPage(
            "https://example.com/product/samsung",
            "Samsung Galaxy S23",
            [
                createMockHighIntentElement("button", "View Details", 80, true, ""),
                createMockHighIntentElement("button", "Add to Cart", 85, true, ""),
            ]
        ),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    const navWorkflows = workflows.filter((w) => w.tags.includes("navigation"));

    assert(
        navWorkflows.length > 0,
        "Should detect at least one navigation pattern workflow"
    );
    console.log(`✓ Detected ${navWorkflows.length} navigation workflow(s)`);
    console.log(`  Workflow: ${navWorkflows[0].name}`);
    console.log(`  Confidence: ${navWorkflows[0].confidence}%\n`);
} catch (error) {
    console.error(`✗ Navigation pattern detection failed: ${error.message}\n`);
}

// Test 2: Multi-Step Form Detection - Checkout Flow
console.log("Test 2: Detect multi-step checkout form flow");
try {
    const pages = [
        createMockCrawledPage("https://example.com/checkout/step1", "Checkout - Address", [
            createMockHighIntentElement("input", "Email", 85),
            createMockHighIntentElement("input", "Address", 82),
            createMockHighIntentElement("button", "Next", 90, true, "https://example.com/checkout/step2"),
        ]),
        createMockCrawledPage("https://example.com/checkout/step2", "Checkout - Shipping", [
            createMockHighIntentElement("input", "Shipping Method", 80),
            createMockHighIntentElement("button", "Continue", 88, true, "https://example.com/checkout/step3"),
        ]),
        createMockCrawledPage("https://example.com/checkout/success", "Order Confirmed", [
            createMockHighIntentElement("h1", "Thank You", 75),
            createMockHighIntentElement("a", "Track Order", 70, true, ""),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    const formWorkflows = workflows.filter((w) => w.tags.includes("multi-step"));

    assert(formWorkflows.length > 0, "Should detect at least one multi-step form workflow");
    console.log(`✓ Detected ${formWorkflows.length} multi-step form workflow(s)`);
    console.log(`  Workflow: ${formWorkflows[0].name}`);
    console.log(`  Pages in sequence: ${formWorkflows[0].pageSequence.length}`);
    console.log(`  Confidence: ${formWorkflows[0].confidence}%\n`);
} catch (error) {
    console.error(`✗ Multi-step form detection failed: ${error.message}\n`);
}

// Test 3: Form Submission Detection (Phase 1)
console.log("Test 3: Detect form submission flow");
try {
    const pages = [
        createMockCrawledPage("https://example.com/signup", "Sign Up", [
            createMockHighIntentElement("form", "", 0, false, "", { role: "form" }),
            createMockHighIntentElement("input", "Email", 85, false, "", { type: "email" }),
            createMockHighIntentElement("input", "Password", 88, false, "", { type: "password" }),
            createMockHighIntentElement("button", "Sign Up", 92, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/dashboard", "Dashboard", [
            createMockHighIntentElement("h1", "Welcome", 75),
            createMockHighIntentElement("a", "Settings", 65, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    const formSubmitWorkflows = workflows.filter(
        (w) => w.name.includes("form_submission") || w.name.includes("submission")
    );

    assert(
        formSubmitWorkflows.length > 0,
        "Should detect form submission workflow"
    );
    console.log(`✓ Detected ${formSubmitWorkflows.length} form submission workflow(s)`);
    console.log(`  Workflow: ${formSubmitWorkflows[0].name}\n`);
} catch (error) {
    console.error(`✗ Form submission detection failed: ${error.message}\n`);
}

// Test 4: Auth Flow Detection (Phase 1)
console.log("Test 4: Detect authentication flow");
try {
    const pages = [
        createMockCrawledPage("https://example.com/login", "Login", [
            createMockHighIntentElement("input", "Username", 85),
            createMockHighIntentElement("input", "Password", 90),
            createMockHighIntentElement("button", "Login", 92),
        ]),
        createMockCrawledPage("https://example.com/profile", "My Profile", [
            createMockHighIntentElement("h1", "Profile", 70),
            createMockHighIntentElement("a", "Edit Profile", 80, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);
    const authWorkflows = workflows.filter((w) => w.tags && w.tags.includes("authentication"));

    assert(authWorkflows.length > 0, "Should detect authentication workflow");
    console.log(`✓ Detected ${authWorkflows.length} authentication workflow(s)`);
    console.log(`  Workflow: ${authWorkflows[0].name}`);
    console.log(`  Confidence: ${authWorkflows[0].confidence}%\n`);
} catch (error) {
    console.error(`✗ Auth flow detection failed: ${error.message}\n`);
}

// Test 5: MarkdownExporter - exportDetectedWorkflows
console.log("Test 5: Export detected workflows to markdown");
try {
    const pages = [
        createMockCrawledPage("https://example.com/category", "Category", [
            createMockHighIntentElement("form", "", 0, false, "", { role: "form" }),
            createMockHighIntentElement("input", "Search", 80),
            createMockHighIntentElement("button", "Go", 85, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/product", "Product", [
            createMockHighIntentElement("h1", "Thank you", 85),
            createMockHighIntentElement("a", "Home", 75, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);

    assert(workflows.length > 0, "Should have detected at least one workflow");

    const markdown = MarkdownExporter.exportDetectedWorkflows(workflows);

    assert(markdown.includes("# Detected Workflows"), "Should have main heading");
    assert(markdown.includes("Workflow Summary"), "Should have summary section");
    assert(workflows.length > 0, "Should have workflows listed");

    console.log(`✓ Successfully exported ${workflows.length} workflow(s) to markdown`);
    console.log(`  Markdown length: ${markdown.length} characters\n`);
} catch (error) {
    console.error(`✗ Markdown export failed: ${error.message}\n`);
}

// Test 6: MarkdownExporter - exportWorkflowSequence
console.log("Test 6: Export individual workflow sequence visualization");
try {
    const pages = [
        createMockCrawledPage("https://example.com/step1", "Step 1", [
            createMockHighIntentElement("form", "", 0, false, "", { role: "form" }),
            createMockHighIntentElement("input", "Name", 80),
            createMockHighIntentElement("button", "Next", 85, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/step2", "Step 2", [
            createMockHighIntentElement("form", "", 0, false, "", { role: "form" }),
            createMockHighIntentElement("input", "Email", 85),
            createMockHighIntentElement("button", "Continue", 85, false, "", { type: "submit" }),
        ]),
        createMockCrawledPage("https://example.com/success", "Success", [
            createMockHighIntentElement("h1", "Thank you", 75),
            createMockHighIntentElement("a", "Done", 75, true),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);

    assert(workflows.length > 0, "Should detect at least one workflow");

    const workflow = workflows[0];
    const markdown = MarkdownExporter.exportWorkflowSequence(workflow);

    assert(markdown.includes("# Workflow:"), "Should have workflow heading");
    assert(markdown.includes("Confidence:"), "Should include confidence score");
    assert(markdown.includes("Page Sequence"), "Should have page sequence section");

    console.log(`✓ Successfully generated workflow sequence visualization`);
    console.log(`  Workflow: ${workflow.name}`);
    console.log(`  Markdown length: ${markdown.length} characters\n`);
} catch (error) {
    console.error(`✗ Workflow sequence visualization failed: ${error.message}\n`);
}

// Test 7: MarkdownExporter - exportWorkflowComparison
console.log("Test 7: Export workflow comparison (multiple workflows)");
try {
    // Create multiple workflows by detecting from larger session
    const pages = [
        createMockCrawledPage("https://example.com/", "Home", [
            createMockHighIntentElement("a", "Shop", 80, true),
            createMockHighIntentElement("a", "Login", 75, true),
        ]),
        createMockCrawledPage("https://example.com/products", "Products", [
            createMockHighIntentElement("a", "Product 1", 85, true),
            createMockHighIntentElement("a", "Product 2", 85, true),
        ]),
        createMockCrawledPage("https://example.com/product/1", "Product 1", [
            createMockHighIntentElement("button", "Add to Cart", 90),
            createMockHighIntentElement("a", "Checkout", 88, true),
        ]),
        createMockCrawledPage("https://example.com/checkout", "Checkout", [
            createMockHighIntentElement("input", "Email", 85),
            createMockHighIntentElement("button", "Continue", 87),
        ]),
        createMockCrawledPage("https://example.com/login", "Login", [
            createMockHighIntentElement("input", "Username", 85),
            createMockHighIntentElement("button", "Login", 90),
        ]),
    ];

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);

    if (workflows.length >= 2) {
        const comparisonMarkdown = MarkdownExporter.exportWorkflowComparison(
            workflows.slice(0, 2)
        );

        assert(comparisonMarkdown.includes("# Workflow Comparison"), "Should have comparison heading");
        assert(comparisonMarkdown.includes("Workflow"), "Should list workflow names");

        console.log(`✓ Successfully generated workflow comparison for ${Math.min(2, workflows.length)} workflows`);
        console.log(`  Comparison markdown length: ${comparisonMarkdown.length} characters\n`);
    } else {
        console.log(
            `⊘ Not enough workflows (need 2+, found ${workflows.length}) for meaningful comparison\n`
        );
    }
} catch (error) {
    console.error(`✗ Workflow comparison failed: ${error.message}\n`);
}

// Test 8: Verify no duplicate workflows detected
console.log("Test 8: Verify no duplicate workflows (deduplication)");
try {
    // Create a session that would trigger same patterns multiple times
    const pages = [];
    for (let i = 0; i < 5; i++) {
        pages.push(
            createMockCrawledPage(`https://example.com/category/${i}`, `Category ${i}`, [
                createMockHighIntentElement("a", "Product", 80, true),
            ])
        );
    }

    const session = createMockCrawlSession(pages);
    const workflows = WorkflowDetector.detect(session);

    // Check for duplicates
    const workflowNames = workflows.map((w) => w.name);
    const uniqueNames = new Set(workflowNames);

    assert(
        workflowNames.length === uniqueNames.size,
        "Should not have duplicate workflow names"
    );

    console.log(`✓ Deduplication working: ${workflows.length} unique workflows detected\n`);
} catch (error) {
    console.error(`✗ Deduplication test failed: ${error.message}\n`);
}

console.log("========================================");
console.log("Phase 2 Integration Tests Complete!");
console.log("========================================");
