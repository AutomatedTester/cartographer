import {
    CrawlSession,
    CrawledPage,
    DetectedWorkflow,
    MultiPageCrawlConfig,
} from './types.js';

/**
 * SessionManager maintains state across multiple pages during a crawl,
 * tracking pages visited, element interactions, and detected workflows.
 */
export class SessionManager {
    private session: CrawlSession;
    private visitedUrls: Set<string>;
    private navigationGraph: Map<string, string[]>;
    private config: MultiPageCrawlConfig;

    constructor(startUrl: string, config: MultiPageCrawlConfig, sessionId?: string) {
        this.config = config;
        this.session = {
            sessionId: sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            startUrl,
            pages: [],
            metadata: {
                startTime: Date.now(),
                totalPages: 0,
                totalElementsAnalyzed: 0,
                totalHighIntentElements: 0,
            },
            sessionState: {},
            workflows: [],
        };
        // Don't pre-mark startUrl as visited - it will be marked visited after crawling
        this.visitedUrls = new Set();
        this.navigationGraph = new Map();
    }

    /**
     * Add a crawled page to the session
     */
    addPage(page: CrawledPage): void {
        this.session.pages.push(page);
        this.session.metadata.totalPages++;
        this.session.metadata.totalElementsAnalyzed += page.highIntentElements.length;
        this.session.metadata.totalHighIntentElements += page.highIntentElements.filter(
            (el) => el.intentScore >= (this.config.intentThreshold || 25)
        ).length;
    }

    /**
     * Get current session state
     */
    getState(): Record<string, any> {
        return { ...this.session.sessionState };
    }

    /**
     * Update session state (e.g., form values, selections, auth tokens)
     */
    updateState(key: string, value: any): void {
        this.session.sessionState[key] = value;
    }

    /**
     * Record navigation links found on a page
     */
    recordNavigation(fromUrl: string, toUrls: string[]): void {
        const existing = this.navigationGraph.get(fromUrl) || [];
        this.navigationGraph.set(fromUrl, [...existing, ...toUrls]);
    }

    /**
     * Check if URL has already been visited
     */
    isVisited(url: string): boolean {
        return this.visitedUrls.has(url);
    }

    /**
     * Mark URL as visited
     */
    markAsVisited(url: string): void {
        this.visitedUrls.add(url);
    }

    /**
     * Get unvisited links for next crawl iteration (BFS)
     */
    getUnvisitedLinks(): string[] {
        const unvisited: string[] = [];

        // Iterate through pages in order (BFS)
        for (const page of this.session.pages) {
            const linksFromPage = this.navigationGraph.get(page.url) || [];
            for (const link of linksFromPage) {
                if (!this.isVisited(link) && !unvisited.includes(link)) {
                    unvisited.push(link);
                }
            }
        }

        return unvisited;
    }

    /**
     * Finalize session and detect workflows
     */
    async finalize(): Promise<CrawlSession> {
        this.session.metadata.endTime = Date.now();

        if (this.config.detectWorkflows !== false) {
            // Import here to avoid circular dependencies
            const { WorkflowDetector } = await import('./workflow-detector.js');
            this.session.workflows = WorkflowDetector.detect(
                this.session,
                this.config.workflowStrategy || 'both',
                this.config.enableWorkflowCaching ?? true
            );
        }

        return this.session;
    }

    /**
     * Get page by URL
     */
    getPageByUrl(url: string): CrawledPage | undefined {
        return this.session.pages.find((p) => p.url === url);
    }

    /**
     * Get session object
     */
    getSession(): CrawlSession {
        return this.session;
    }

    /**
     * Get session ID
     */
    getSessionId(): string {
        return this.session.sessionId;
    }

    /**
     * Export session to JSON string
     */
    toJSON(): string {
        return JSON.stringify(this.session, null, 2);
    }

    /**
     * Load session from JSON string
     */
    static fromJSON(json: string, config: MultiPageCrawlConfig): SessionManager {
        const data = JSON.parse(json) as CrawlSession;
        const sm = new SessionManager(data.startUrl, config, data.sessionId);
        sm.session = data;
        return sm;
    }
}
