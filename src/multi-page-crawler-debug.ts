/**
 * Debug version of MultiPageCrawler with detailed logging
 * Helps diagnose why pages aren't being found
 */

import { SiteCrawler } from './crawler.js';
import { SessionManager } from './session-manager.js';
import {
    MultiPageCrawlConfig,
    MultiPageCrawlResult,
    CrawledPage,
} from './types.js';

export class MultiPageCrawlerDebug {
    private baseCrawler: SiteCrawler;
    private sessionManager: SessionManager;
    private config: MultiPageCrawlConfig;
    private debugLogs: string[] = [];

    constructor(config: MultiPageCrawlConfig) {
        this.config = {
            maxPages: 10,
            maxDepth: 3,
            pageLoadTimeout: 30000,
            intentThreshold: 25,
            detectWorkflows: true,
            workflowStrategy: 'both',
            ...config,
        };
        this.baseCrawler = new SiteCrawler();
        this.sessionManager = new SessionManager(config.startUrl, this.config);
    }

    private log(message: string): void {
        console.log(`[DEBUG] ${message}`);
        this.debugLogs.push(message);
    }

    async crawl(): Promise<{ result: MultiPageCrawlResult; debug: string[] }> {
        try {
            this.log(`Starting crawl with config: ${JSON.stringify(this.config)}`);
            await this.baseCrawler.init();
            this.log('SiteCrawler initialized');

            const startTime = Date.now();
            const concurrencyLimit = this.config.concurrencyLimit ?? 3;

            // BFS: queue of { url, depth }
            const queue: Array<{ url: string; depth: number }> = [
                { url: this.config.startUrl!, depth: 0 },
            ];

            this.log(`Initial queue: [${this.config.startUrl}]`);

            let processedCount = 0;
            let queueRound = 0;

            while (queue.length > 0) {
                queueRound++;
                this.log(`\n--- Queue Round ${queueRound} ---`);
                this.log(`Queue length: ${queue.length}, Processed pages: ${processedCount}`);

                if (this.sessionManager.getSession().pages.length >= this.config.maxPages!) {
                    this.log(`✓ Reached max pages limit (${this.config.maxPages!})`);
                    break;
                }

                const batchSize = Math.min(concurrencyLimit, queue.length);
                const batch = queue.splice(0, batchSize);
                this.log(`Processing batch of ${batchSize} pages`);

                for (let i = 0; i < batch.length; i++) {
                    const { url, depth } = batch[i];
                    this.log(`  [${i + 1}/${batchSize}] Attempting: ${url} (depth ${depth})`);

                    // Check depth limit
                    if (depth > this.config.maxDepth!) {
                        this.log(`    → Skipped (depth ${depth} > max ${this.config.maxDepth!})`);
                        continue;
                    }

                    // Already visited check
                    if (this.sessionManager.isVisited(url)) {
                        this.log(`    → Skipped (already visited)`);
                        continue;
                    }

                    // URL pattern matching
                    if (!this.matchesUrlPatterns(url)) {
                        this.log(`    → Skipped (doesn't match URL patterns)`);
                        continue;
                    }

                    try {
                        this.log(`    → Crawling...`);
                        const result = await this.baseCrawler.crawlAndAnalyze(
                            url,
                            this.config.intentThreshold
                        );

                        this.log(`    ✓ Crawled successfully. Found ${result.highIntentElements.length} high-intent elements`);

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
                        processedCount++;

                        // Extract navigation targets
                        const nextUrls = this.extractNavigationTargets(page, url);
                        this.log(`    → Found ${nextUrls.length} navigation targets`);
                        for (const nextUrl of nextUrls) {
                            this.log(`      - ${nextUrl}`);
                        }

                        this.sessionManager.recordNavigation(url, nextUrls);

                        // Queue unvisited links
                        let queuedCount = 0;
                        for (const nextUrl of nextUrls) {
                            if (!this.sessionManager.isVisited(nextUrl)) {
                                queue.push({ url: nextUrl, depth: depth + 1 });
                                queuedCount++;
                            }
                        }
                        this.log(`    → Queued ${queuedCount} new URLs`);
                    } catch (error) {
                        this.log(`    ✗ Error crawling: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }

            const session = await this.sessionManager.finalize();
            const totalTime = Date.now() - startTime;

            this.log(`\n--- Crawl Complete ---`);
            this.log(`Total pages crawled: ${session.pages.length}`);
            this.log(`Total time: ${totalTime}ms`);
            this.log(`Workflows detected: ${session.workflows.length}`);

            return {
                result: {
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
                        cacheHits: 0,
                        cacheMisses: 0,
                        avgTimePerPage: session.pages.length > 0 ? Math.round(totalTime / session.pages.length) : 0,
                    },
                },
                debug: this.debugLogs,
            };
        } finally {
            await this.baseCrawler.close();
        }
    }

    private extractNavigationTargets(page: CrawledPage, pageUrl: string): string[] {
        // Get all anchors from high-intent elements
        const targets = new Set<string>();

        // This is a simple heuristic - in production you'd extract all <a> tags
        for (const element of page.highIntentElements) {
            if (element.actionType === 'navigate' && element.navigates) {
                // Would need actual href extraction here
                targets.add(element.locator);
            }
        }

        return Array.from(targets);
    }

    private matchesUrlPatterns(url: string): boolean {
        const patterns = this.config.urlPatterns;
        if (!patterns) {
            this.log(`    [patterns] No URL patterns configured, accepting all URLs`);
            return true;
        }

        if (patterns.exclude) {
            for (const pattern of patterns.exclude) {
                try {
                    if (new RegExp(pattern).test(url)) {
                        this.log(`    [patterns] URL matches exclude pattern: ${pattern}`);
                        return false;
                    }
                } catch (e) {
                    console.warn(`[patterns] Invalid exclude pattern: ${pattern}`);
                }
            }
        }

        if (patterns.include && patterns.include.length > 0) {
            for (const pattern of patterns.include) {
                try {
                    if (new RegExp(pattern).test(url)) {
                        this.log(`    [patterns] URL matches include pattern: ${pattern}`);
                        return true;
                    }
                } catch (e) {
                    console.warn(`[patterns] Invalid include pattern: ${pattern}`);
                }
            }
            this.log(`    [patterns] URL doesn't match any include patterns`);
            return false;
        }

        this.log(`    [patterns] No include patterns, accepting URL`);
        return true;
    }
}
