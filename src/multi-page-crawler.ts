import { SiteCrawler } from './crawler.js';
import { SessionManager } from './session-manager.js';
import {
    MultiPageCrawlConfig,
    MultiPageCrawlResult,
    CrawledPage,
} from './types.js';

/**
 * MultiPageCrawler extends SiteCrawler to handle multi-page crawling,
 * state management, and workflow detection.
 */
export class MultiPageCrawler {
    private baseCrawler: SiteCrawler;
    private sessionManager: SessionManager;
    private config: MultiPageCrawlConfig;

    constructor(config: MultiPageCrawlConfig) {
        // Normalize URL by adding https:// if no protocol provided
        const normalizedStartUrl = this.normalizeUrl(config.startUrl);

        this.config = {
            maxPages: 10,
            maxDepth: 3,
            pageLoadTimeout: 30000,
            intentThreshold: 25,
            detectWorkflows: true,
            workflowStrategy: 'both',
            ...config,
            startUrl: normalizedStartUrl,
        };
        this.baseCrawler = new SiteCrawler();
        this.sessionManager = new SessionManager(normalizedStartUrl, this.config);
    }

    /**
     * Normalize URLs by adding https:// if missing protocol
     */
    private normalizeUrl(url: string): string {
        if (!url) return url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        // Add https:// for URLs without protocol
        return `https://${url}`;
    }

    /**
     * Execute multi-page crawl
     */
    async crawl(): Promise<MultiPageCrawlResult> {
        try {
            console.error('[multi-page-crawler] Initializing browser...');
            await this.baseCrawler.init();
            console.error('[multi-page-crawler] Browser initialized, starting crawl...');
            const startTime = Date.now();
            let cacheHits = 0;
            let cacheMisses = 0;

            // BFS: queue of { url, depth }
            const queue: Array<{ url: string; depth: number }> = [
                { url: this.config.startUrl!, depth: 0 },
            ];
            console.error(`[multi-page-crawler] Starting with URL: ${this.config.startUrl}`);

            // Concurrency configuration
            const concurrencyLimit = this.config.concurrencyLimit ?? 3;
            const enableMemoryOptimization = this.config.enableMemoryOptimization ?? true;

            // Process queue with parallel concurrency control
            while (queue.length > 0) {
                console.error(`[multi-page-crawler] Queue length: ${queue.length}`);
                // Check page limit
                if (this.sessionManager.getSession().pages.length >= this.config.maxPages!) {
                    console.error(`[multi-page-crawler] Reached max pages limit (${this.config.maxPages!})`);
                    break;
                }

                // Take up to concurrencyLimit items from queue
                const batchSize = Math.min(concurrencyLimit, queue.length);
                const batch = queue.splice(0, batchSize);
                console.error(`[multi-page-crawler] Processing batch of ${batch.length} URLs`);

                // Process batch in parallel
                const crawlPromises = batch.map(({ url, depth }) => {
                    console.error(`[multi-page-crawler] Starting crawl of ${url} at depth ${depth}`);
                    return this.crawlSinglePage(url, depth).catch((error) => {
                        console.error(`[multi-page-crawler] Error crawling ${url}:`, error);
                        return null;
                    });
                });

                const results = await Promise.all(crawlPromises);
                console.error(`[multi-page-crawler] Batch complete, got ${results.filter(r => r !== null).length} results`);

                // Process results and queue new URLs
                for (let i = 0; i < results.length; i++) {
                    const result = results[i];
                    if (!result) continue;

                    const { url, nextUrls } = result;
                    this.sessionManager.recordNavigation(url, nextUrls);

                    // Queue unvisited links
                    for (const nextUrl of nextUrls) {
                        if (!this.sessionManager.isVisited(nextUrl)) {
                            const nextDepth = batch[i].depth + 1;
                            if (nextDepth <= this.config.maxDepth!) {
                                queue.push({ url: nextUrl, depth: nextDepth });
                            }
                        }
                    }
                }

                // Memory optimization: periodic cleanup if enabled
                if (enableMemoryOptimization && this.sessionManager.getSession().pages.length % 5 === 0) {
                    this.optimizeMemory();
                    console.error(
                        `[multi-page-crawler] Memory optimized (${this.getMemoryUsage().toFixed(1)} MB)`
                    );
                }
            }

            const session = await this.sessionManager.finalize();
            const totalTime = Date.now() - startTime;

            return {
                session,
                detectedWorkflows: session.workflows,
                summary: {
                    pagesVisited: session.pages.length,
                    totalElements: session.pages.reduce((acc, p) => acc + p.highIntentElements.length, 0),
                    highIntentElements: session.metadata.totalHighIntentElements,
                    workflowsDetected: session.workflows.length,
                    estimatedUserJourneys: session.workflows.filter((w) => w.confidence > 0.75).length,
                },
                performance: {
                    totalTime,
                    concurrency: concurrencyLimit,
                    cacheHits,
                    cacheMisses,
                    avgTimePerPage: session.pages.length > 0 ? Math.round(totalTime / session.pages.length) : 0,
                },
            };
        } finally {
            await this.baseCrawler.close();
        }
    }

    /**
     * Crawl a single page and extract navigation targets
     */
    private async crawlSinglePage(
        url: string,
        depth: number
    ): Promise<{ url: string; nextUrls: string[] } | null> {
        // Check depth limit
        if (depth > this.config.maxDepth!) {
            console.error(
                `[multi-page-crawler] Skipping ${url} (depth ${depth} > max ${this.config.maxDepth!})`
            );
            return null;
        }

        // Already visited check
        if (this.sessionManager.isVisited(url)) {
            console.error(`[multi-page-crawler] Already visited ${url}`);
            return null;
        }

        // URL pattern matching
        if (!this.matchesUrlPatterns(url)) {
            console.error(`[multi-page-crawler] Skipping ${url} (does not match URL patterns)`);
            return null;
        }

        try {
            console.error(`[multi-page-crawler] Crawling ${url} (depth ${depth})`);

            // Crawl the page
            const result = await this.baseCrawler.crawlAndAnalyze(
                url,
                this.config.intentThreshold
            );
            console.error(`[multi-page-crawler] Page analyzed, got ${result.highIntentElements?.length || 0} high-intent elements`);

            const page: CrawledPage = {
                url,
                title: result.title,
                timestamp: Date.now(),
                highIntentElements: result.highIntentElements,
                generatedTestCases: result.generatedTestCases,
                consoleLogs: result.consoleLogs,
            };

            this.sessionManager.addPage(page);
            this.sessionManager.markAsVisited(url);
            console.error(`[multi-page-crawler] Added page to session, total pages: ${this.sessionManager.getSession().pages.length}`);

            // Extract navigation targets
            const nextUrls = this.extractNavigationTargets(page, url);
            return { url, nextUrls };
        } catch (error) {
            console.error(`[multi-page-crawler] Error crawling ${url}:`, error);
            return null;
        }
    }

    /**
     * Extract navigation targets from page elements
     */
    private extractNavigationTargets(page: CrawledPage, pageUrl: string): string[] {
        const targets = new Set<string>();

        // Primary: Extract from high-intent navigating elements
        for (const el of page.highIntentElements) {
            if (el.navigates && el.navigationTarget) {
                targets.add(this.resolveUrl(el.navigationTarget, pageUrl));
            }
        }

        // Fallback: If no navigation targets found in analyzed elements,
        // use pre-extracted allNavigationLinks from analyzer
        if (targets.size === 0) {
            // Note: allNavigationLinks are already absolute URLs from the browser
            if (Array.isArray((page as any).allNavigationLinks)) {
                for (const link of (page as any).allNavigationLinks) {
                    if (link && typeof link === 'string') {
                        targets.add(link);
                    }
                }
            }
        }

        return Array.from(targets);
    }

    /**
     * Resolve relative URLs to absolute
     */
    private resolveUrl(target: string, baseUrl: string): string {
        try {
            // If already absolute, return as-is
            if (target.startsWith('http://') || target.startsWith('https://')) {
                return target;
            }

            // Parse base URL
            const base = new URL(baseUrl);

            // Handle root-relative URLs
            if (target.startsWith('/')) {
                return `${base.protocol}//${base.host}${target}`;
            }

            // Handle relative URLs
            const basePath = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
            const resolved = new URL(target, basePath).href;

            // Remove fragments and normalize
            return resolved.split('#')[0];
        } catch (error) {
            console.error(`[multi-page-crawler] Error resolving URL: ${target}`, error);
            return target;
        }
    }

    /**
     * Check if URL matches include/exclude patterns
     */
    private matchesUrlPatterns(url: string): boolean {
        const patterns = this.config.urlPatterns;
        if (!patterns) return true;

        // Check exclude patterns
        if (patterns.exclude) {
            for (const pattern of patterns.exclude) {
                try {
                    if (new RegExp(pattern).test(url)) {
                        return false; // URL matches exclude pattern
                    }
                } catch (e) {
                    console.warn(`[multi-page-crawler] Invalid exclude pattern: ${pattern}`);
                }
            }
        }

        // Check include patterns
        if (patterns.include && patterns.include.length > 0) {
            for (const pattern of patterns.include) {
                try {
                    if (new RegExp(pattern).test(url)) {
                        return true; // URL matches include pattern
                    }
                } catch (e) {
                    console.warn(`[multi-page-crawler] Invalid include pattern: ${pattern}`);
                }
            }
            return false; // URL doesn't match any include pattern
        }

        return true; // No include patterns, so accept
    }

    /**
     * Optimize memory by cleaning up non-essential data in pages
     */
    private optimizeMemory(): void {
        const session = this.sessionManager.getSession();
        const enableOptimization = this.config.enableMemoryOptimization ?? true;

        if (!enableOptimization) return;

        // Optionally strip raw HTML if not needed
        for (const page of session.pages) {
            // Remove metadata that's not essential for workflow analysis
            if (page.highIntentElements) {
                // Keep only essential element properties
                page.highIntentElements = page.highIntentElements.map((el) => ({
                    ...el,
                    // Could strip detailed attributes here if needed
                }));
            }
        }

        // Trigger garbage collection if available
        if (global.gc) {
            try {
                global.gc();
            } catch (e) {
                // Gracefully handle if gc is not exposed
            }
        }
    }

    /**
     * Get current memory usage in MB
     */
    private getMemoryUsage(): number {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            const usage = process.memoryUsage();
            return usage.heapUsed / 1024 / 1024; // Convert to MB
        }
        return 0;
    }
}
