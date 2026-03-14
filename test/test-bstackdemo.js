#!/usr/bin/env node

/**
 * Direct test of multi-page crawler on www.bstackdemo.com
 * Tests all three fixes:
 * 1. URL protocol normalization
 * 2. Navigation link extraction
 * 3. Fallback navigation links
 */

import { MultiPageCrawler } from '../build/multi-page-crawler.js';

(async () => {
    console.log('=== Multi-Page Crawler Test ===\n');
    console.log('Testing on www.bstackdemo.com with all fixes applied\n');

    const testConfigs = [
        {
            name: 'Without protocol (www.bstackdemo.com)',
            config: {
                startUrl: 'www.bstackdemo.com',
                maxPages: 5,
                maxDepth: 2,
                detectWorkflows: false,
            },
        },
        {
            name: 'With https protocol',
            config: {
                startUrl: 'https://www.bstackdemo.com',
                maxPages: 5,
                maxDepth: 2,
                detectWorkflows: false,
            },
        },
    ];

    for (const { name, config } of testConfigs) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Test: ${name}`);
        console.log(`Config: ${JSON.stringify(config)}`);
        console.log('='.repeat(60));

        try {
            const crawler = new MultiPageCrawler(config);
            console.log('Starting crawl...\n');

            const startTime = Date.now();
            const result = await crawler.crawl();
            const duration = Date.now() - startTime;

            console.log('\n✅ CRAWL COMPLETED\n');
            console.log(`Results:`);
            console.log(`  Pages crawled: ${result.summary.pagesVisited}`);
            console.log(`  Workflows detected: ${result.summary.workflowsDetected}`);
            console.log(`  Total elements analyzed: ${result.summary.totalElements}`);
            console.log(`  High-intent elements: ${result.summary.highIntentElements}`);
            console.log(`  Duration: ${duration}ms`);
            console.log(`  Avg per page: ${Math.round(duration / Math.max(result.summary.pagesVisited, 1))}ms`);

            if (result.performance) {
                console.log(`\nPerformance Metrics:`);
                console.log(`  Total time: ${result.performance.totalTime}ms`);
                console.log(`  Concurrency: ${result.performance.concurrency}`);
                console.log(`  Cache hits: ${result.performance.cacheHits}`);
                console.log(`  Cache misses: ${result.performance.cacheMisses}`);
            }

            if (result.session.pages.length > 0) {
                console.log(`\nPages crawled:`);
                for (let i = 0; i < Math.min(5, result.session.pages.length); i++) {
                    const page = result.session.pages[i];
                    console.log(`  ${i + 1}. ${page.url}`);
                    console.log(`     Title: ${page.title}`);
                    console.log(`     Elements: ${page.highIntentElements.length}`);
                }
                if (result.session.pages.length > 5) {
                    console.log(`  ... and ${result.session.pages.length - 5} more pages`);
                }
            }

            if (result.session.workflows.length > 0) {
                console.log(`\nDetected Workflows:`);
                for (const wf of result.session.workflows.slice(0, 3)) {
                    console.log(`  - ${wf.name} (confidence: ${Math.round(wf.confidence)}%)`);
                }
            }

            if (result.inferredJourneys && result.inferredJourneys.length > 0) {
                console.log(`\n✨ Inferred User Journeys:`);
                console.log(`  Found ${result.inferredJourneys.length} journeys:`);
                for (const journey of result.inferredJourneys) {
                    console.log(`\n  📌 ${journey.name}`);
                    console.log(`     Description: ${journey.description}`);
                    console.log(`     Confidence: ${journey.confidence}%`);
                    console.log(`     Pages: ${journey.pageSequence.length}`);
                    console.log(`     Tags: ${journey.tags.join(", ")}`);
                }
            }
        } catch (error) {
            console.error(`\n❌ ERROR:`, error instanceof Error ? error.message : error);
            console.error('\nFull error:');
            console.error(error);
        }

        console.log('\n');
    }

    console.log('='.repeat(60));
    console.log('Test Complete');
    console.log('='.repeat(60));
})();
