/**
 * Shared type definitions used by both the Node.js crawler and the
 * browser-side analyzer. This file must remain free of browser or Node.js
 * specific APIs so it can be compiled by both tsconfig.json (Node) and
 * tsconfig.browser.json (browser).
 */


/** A single element identified as high intent for user interaction. */
export interface HighIntentElement {
    /** CSS-like path describing the element's location. */
    path: string;
    tag: string;
    id?: string;
    classes?: string[];
    role?: string;
    ariaLabel?: string;
    text?: string;
    locator: string;
    /** Human-readable explanation of why this element is high intent. */
    intentReasons: string[];
    /** Higher value = higher priority for user intent. */
    intentScore: number;
    /** True if this element likely triggers navigation. */
    navigates?: boolean;
    /** Target of navigation if applicable (e.g., href, action). */
    navigationTarget?: string;
    /** Element attributes (type, placeholder, href, etc.) */
    attributes?: Record<string, string>;
}

/** A candidate test case derived from a page snapshot. */
export interface TestCandidate {
    description: string;
    /** Suggested stable locator strategy (CSS or XPath). */
    locator: string;
    riskScore: number;
}

/** Priority level for test case ordering */
export type TestPriority = 'critical' | 'high' | 'medium' | 'low';

/** A semantic webmcp tool definition */
export interface SemanticToolSchema {
    /** Tool name in camelCase (e.g., "search", "subscribeToNewsletter") */
    name: string;
    /** Human-readable description of what the tool does */
    description: string;
    /** Type of action the tool performs */
    actionType: 'click' | 'input' | 'submit' | 'navigate' | 'delete' | 'select' | 'hover';
    /** Input schema for the tool (e.g., optional query parameter) */
    inputSchema: Record<string, unknown>;
    /** Return type documentation */
    returnType: string;
}

/** A generated test case from a high-intent element */
export interface GeneratedTestCase {
    /** Unique identifier for the test case */
    id: string;
    /** Human-readable test case name */
    name: string;
    /** Detailed description of what the test should verify */
    description: string;
    /** Priority level based on intent score */
    priority: TestPriority;
    /** Type of interaction: click, input, submit, navigate, delete, etc. */
    actionType: 'click' | 'input' | 'submit' | 'navigate' | 'delete' | 'select' | 'hover';
    /** The stable locator for this element */
    locator: string;
    /** Pre-conditions needed for this test */
    preconditions: string[];
    /** Steps to execute the test */
    steps: string[];
    /** Expected outcomes */
    expectedResults: string[];
    /** Source intent score (0-100) */
    intentScore: number;
    /** Tags for categorization */
    tags: string[];
    /** Associated element that generated this test */
    sourceElement: HighIntentElement;
    /** Reference to the semantic webmcp tool this test calls */
    semanticTool?: string;
    /** Executable test code that calls the semantic tool */
    testCode?: string;
}

/** Full output produced by the analyzer. */
export interface AnalysisResult {
    url: string;
    title: string;
    highIntentElements: HighIntentElement[];
    generatedTestCases?: GeneratedTestCase[];
    consoleLogs: string[];
}

/** Result of executing a single test */
export interface TestExecutionResult {
    /** Test case ID */
    testId: string;
    /** Tool name that was executed */
    toolName: string;
    /** Whether the test passed */
    success: boolean;
    /** Result message */
    message: string;
    /** Execution duration in milliseconds */
    duration: number;
    /** Error details if test failed */
    error?: string;
}

/** Aggregated test execution results */
export interface TestExecutionSummary {
    url: string;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    results: TestExecutionResult[];
    totalDuration: number;
    semanticTools: SemanticToolSchema[];
}

