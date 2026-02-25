/**
 * Shared type definitions used by both the Node.js crawler and the
 * browser-side analyzer. This file must remain free of browser or Node.js
 * specific APIs so it can be compiled by both tsconfig.json (Node) and
 * tsconfig.browser.json (browser).
 */

/** A single element flagged as a testing risk. */
export interface RiskyElement {
    /** CSS-like path describing the element's location. */
    path: string;
    tag: string;
    id?: string;
    classes?: string[];
    /** Human-readable explanation of why this element is flagged. */
    reason: string;
    /** Higher value = higher priority for test coverage. */
    riskScore: number;
}

/** A candidate test case derived from a page snapshot. */
export interface TestCandidate {
    description: string;
    /** Suggested stable locator strategy (CSS or XPath). */
    locator: string;
    riskScore: number;
}

/** Full output produced by the analyzer. */
export interface AnalysisResult {
    url: string;
    title: string;
    riskyElements: RiskyElement[];
    priorityTestList: TestCandidate[];
    consoleLogs: string[];
}
