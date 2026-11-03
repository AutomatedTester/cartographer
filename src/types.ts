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
    /** Optional analysis error while still returning a structured payload */
    error?: string;
    /** Fallback: All navigation links found on page (href targets) */
    allNavigationLinks?: string[];
    /** Performance and device metrics for this analysis */
    metrics?: AnalysisMetrics;
    /** ARIA advisory report; only present when the caller asked for one */
    ariaAudit?: AriaAuditReport;
}

/**
 * ============================================================================
 * ARIA ADVISORY TYPE DEFINITIONS
 * ============================================================================
 */

/**
 * One element as seen by the in-page ARIA collector. Everything the rules need
 * that depends on the live DOM (focusability, rendering, id resolution, the
 * roles around the element) is resolved in the page, so the rules themselves
 * are pure functions over this snapshot.
 */
export interface AriaNodeSnapshot {
    tag: string;
    locator: string;
    /** Opening tag as written, truncated, for showing the author what was found */
    snippet: string;
    /** The role attribute exactly as authored, if any */
    roleAttr?: string;
    /** Role the browser exposes: first valid token of roleAttr, else the native role */
    effectiveRole: string | null;
    /** Role the element would have with no role attribute */
    implicitRole: string | null;
    /** Every aria-* attribute on the element */
    ariaAttributes: Record<string, string>;
    focusable: boolean;
    tabbable: boolean;
    /** Native control (button, a[href], input, select, textarea, summary) */
    nativelyInteractive: boolean;
    disabled: boolean;
    /** Approximation of the accessible name computation */
    accessibleName: string;
    nameSource: 'aria-labelledby' | 'aria-label' | 'native' | 'content' | 'title' | 'none';
    /** Text a sighted user sees inside the element */
    visibleText: string;
    /** IDREF attributes whose ids do not exist in the document */
    missingIdrefs: Record<string, string[]>;
    /** Nearest ancestor role, skipping generic and presentational wrappers */
    parentRole: string | null;
    /** Roles of owned elements, looking through generic and presentational wrappers */
    ownedRoles: string[];
    /** Inside an aria-hidden="true" subtree, so absent from the accessibility tree */
    inAriaHiddenSubtree: boolean;
    /** Number of focusable descendants */
    focusableDescendants: number;
}

/** Everything the collector found on one page. */
export interface AriaSnapshot {
    url: string;
    title: string;
    elements: AriaNodeSnapshot[];
    /** Elements walked, including those without ARIA */
    elementsScanned: number;
    /** True when the element cap was hit and the snapshot is partial */
    truncated: boolean;
}

export type AriaAdvisorySeverity = 'high' | 'medium' | 'low';

/** The kind of change the advice recommends. */
export type AriaFixKind = 'remove-aria' | 'change-aria' | 'add-aria' | 'use-native-html';

/** One piece of advice about ARIA on the page. Advisory: never a pass/fail. */
export interface AriaFinding {
    ruleId: string;
    title: string;
    severity: AriaAdvisorySeverity;
    locator: string;
    snippet: string;
    role: string | null;
    /** What is wrong with the markup */
    problem: string;
    /** How it comes across to someone using a screen reader, voice control or keyboard */
    userExperience: string;
    advice: string;
    fix: AriaFixKind;
    /** What a user would lose if the offending ARIA were simply deleted */
    ifRemoved: string;
    /** True when deleting the ARIA loses nothing users currently get from it */
    safeToRemove: boolean;
    reference: string;
}

/** The ARIA advisory report for one page. */
export interface AriaAuditReport {
    url: string;
    title: string;
    /** Always true: this report gives advice, it does not pass or fail a page */
    advisory: true;
    elementsScanned: number;
    elementsWithAria: number;
    truncated: boolean;
    findings: AriaFinding[];
    summary: {
        total: number;
        high: number;
        medium: number;
        low: number;
        /** Findings fixable by deleting ARIA without losing anything */
        safeToRemove: number;
    };
    /** Set when the audit could not run; the rest of the report is then empty */
    error?: string;
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
        failedPages?: number;
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
    /** Script execution timeout for browser analysis (default: 120000) */
    scriptTimeoutMs?: number;
    /** Watchdog timeout around analyzer execution in-browser (default: 90000) */
    analysisTimeoutMs?: number;
    /** Timeout per ML device backend before trying next, then heuristic fallback (default: 5000) */
    modelLoadTimeoutMs?: number;
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

/** Captures a page-level crawl failure with enough context for diagnostics */
export interface CrawlError {
    url: string;
    depth: number;
    phase: 'navigate' | 'analyze' | 'extract' | 'unknown';
    message: string;
    timestamp: number;
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
    /** Detailed per-page crawl failures captured during execution */
    crawlErrors?: CrawlError[];
    /** Summary statistics */
    summary: {
        pagesVisited: number;
        failedPages?: number;
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

