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

/** Performance metrics for DOM analysis */
export interface AnalysisMetrics {
    /** Device used for ML inference: webnn, webgpu, wasm, or none */
    device: 'webnn' | 'webgpu' | 'wasm' | 'none';
    /** Model load time in milliseconds */
    modelLoadTime: number;
    /** DOM analysis time in milliseconds */
    analysisTime: number;
    /** Embedding/deduplication time in milliseconds */
    deduplicationTime: number;
    /** Total number of elements analyzed */
    elementsAnalyzed: number;
    /** Number of high-intent elements after clustering */
    elementsClustered: number;
    /**
     * Number of LLM/API tokens consumed during analysis.
     * This is always 0 because all ML inference runs locally in the browser
     * via WebNN, WebGPU, or WASM — no cloud API calls are made.
     */
    tokensUsed: number;
}

/** Full output produced by the analyzer. */
export interface AnalysisResult {
    url: string;
    title: string;
    highIntentElements: HighIntentElement[];
    generatedTestCases?: GeneratedTestCase[];
    consoleLogs: string[];
    /** Fallback: All navigation links found on page (href targets) */
    allNavigationLinks?: string[];
    /** Performance and device metrics for this analysis */
    metrics?: AnalysisMetrics;
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

/**
 * ============================================================================
 * MULTI-PAGE CRAWLING TYPE DEFINITIONS
 * ============================================================================
 */

/** Represents a single page in a crawl session */
export interface CrawledPage {
    /** URL of the page */
    url: string;
    /** Page title or heading */
    title: string;
    /** Timestamp when page was crawled */
    timestamp: number;
    /** High-intent elements found on this page */
    highIntentElements: HighIntentElement[];
    /** Generated test cases for this page */
    generatedTestCases?: GeneratedTestCase[];
    /** Browser console logs during page analysis */
    consoleLogs: string[];
}

/** State maintained across a multi-page crawling session */
export interface CrawlSession {
    /** Unique identifier for this crawl session */
    sessionId: string;
    /** Starting URL for the crawl */
    startUrl: string;
    /** All pages collected during this session */
    pages: CrawledPage[];
    /** Session metadata and statistics */
    metadata: {
        startTime: number;
        endTime?: number;
        totalPages: number;
        totalElementsAnalyzed: number;
        totalHighIntentElements: number;
    };
    /** Session-level state variables (user input, selections, auth tokens, etc.) */
    sessionState: Record<string, any>;
    /** Detected workflows through the website */
    workflows: DetectedWorkflow[];
    /** Inferred user journeys from heuristic analysis */
    inferredJourneys?: Array<{
        id: string;
        name: string;
        description: string;
        pageSequence: string[];
        elementPatterns: string[];
        confidence: number;
        tags: string[];
    }>;
}

/** A single action within a workflow */
export interface WorkflowAction {
    /** URL where the action occurred */
    pageUrl: string;
    /** CSS or XPath locator for the element */
    elementLocator: string;
    /** Type of interaction: click, input, submit, navigate, etc. */
    actionType: 'click' | 'input' | 'submit' | 'navigate' | 'delete' | 'select' | 'hover';
    /** Data provided with the action (e.g., input values) */
    actionData?: Record<string, any>;
    /** URL navigated to as a result of this action */
    resultingNavigation?: string;
    /** When the action occurred */
    timestamp: number;
}

/** State transition between pages in a workflow */
export interface StateTransition {
    /** Source page URL */
    fromPage: string;
    /** Target page URL */
    toPage: string;
    /** Action that caused the transition */
    action: WorkflowAction;
    /** State changes that occurred during transition */
    stateChanges: Record<string, any>;
}

/** Detected user workflow or journey through the site */
export interface DetectedWorkflow {
    /** Unique identifier for this workflow */
    id: string;
    /** Human-readable name (e.g., "user_signup_flow") */
    name: string;
    /** Sequence of page URLs in this workflow */
    pageSequence: string[];
    /** Sequence of actions taken in this workflow */
    actionSequence: WorkflowAction[];
    /** State transitions between pages */
    stateTransitions: StateTransition[];
    /** Confidence score (0-100) that this is a real workflow */
    confidence: number;
    /** Tags for categorization and filtering */
    tags: string[];
}

/** Configuration for multi-page crawling operations */
export interface MultiPageCrawlConfig {
    /** Starting URL (required) */
    startUrl: string;
    /** Maximum number of pages to crawl (default: 10) */
    maxPages?: number;
    /** Maximum depth from start URL (default: 3) */
    maxDepth?: number;
    /** Page load timeout in milliseconds (default: 30000) */
    pageLoadTimeout?: number;
    /** Intent score threshold for element selection (default: 25) */
    intentThreshold?: number;
    /** Whether to auto-detect workflows (default: true) */
    detectWorkflows?: boolean;
    /** Workflow detection strategy: 'heuristic', 'ml-based', or 'both' (default: 'both') */
    workflowStrategy?: 'heuristic' | 'ml-based' | 'both';
    /** URL patterns to include/exclude from crawling */
    urlPatterns?: {
        include?: string[]; // Regex patterns
        exclude?: string[]; // Regex patterns
    };
    /** CSS selectors to wait for before considering page loaded */
    waitForElements?: string[];
    /** Test data for form filling and simulation */
    testData?: Record<string, any>;
    /** Maximum concurrent page crawls (default: 3) */
    concurrencyLimit?: number;
    /** Enable workflow detection caching (default: true) */
    enableWorkflowCaching?: boolean;
    /** Enable memory optimizations (default: true) */
    enableMemoryOptimization?: boolean;
    /** Credentials for login automation (optional) */
    credentials?: {
        /** Username or email for login */
        username: string;
        /** Password for login */
        password: string;
    };
    /** Enable automatic login form detection and filling (default: true) */
    enableAutoLogin?: boolean;
}

/** Cache entry for workflow detection results */
export interface WorkflowDetectionCache {
    /** Hash of page sequence for cache key */
    sequenceHash: string;
    /** Cached detected workflows */
    workflows: DetectedWorkflow[];
    /** When cache entry was created */
    timestamp: number;
    /** TTL in milliseconds (default: 1 hour) */
    ttl?: number;
}

/** Result of a multi-page crawl operation */
export interface MultiPageCrawlResult {
    /** Complete session with all data */
    session: CrawlSession;
    /** Detected workflows */
    detectedWorkflows: DetectedWorkflow[];
    /** Inferred user journeys */
    inferredJourneys?: Array<{
        id: string;
        name: string;
        description: string;
        pageSequence: string[];
        elementPatterns: string[];
        confidence: number;
        tags: string[];
    }>;
    /** Summary statistics */
    summary: {
        pagesVisited: number;
        totalElements: number;
        highIntentElements: number;
        workflowsDetected: number;
        estimatedUserJourneys: number;
    };
    /** Performance metrics for this crawl */
    performance?: {
        /** Total crawl time in milliseconds */
        totalTime?: number;
        /** Number of concurrent pages processed */
        concurrency?: number;
        /** Workflow detection cache hits */
        cacheHits?: number;
        /** Workflow detection cache misses */
        cacheMisses?: number;
        /** Peak memory usage in MB */
        peakMemory?: number;
        /** Average time per page in ms */
        avgTimePerPage?: number;
    };
}

