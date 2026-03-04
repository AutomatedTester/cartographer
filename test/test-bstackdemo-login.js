#!/usr/bin/env node

/**
 * Test multi-page crawler on www.bstackdemo.com with login
 * Tests the enhanced login handler with React Select support
 */

import { MultiPageCrawler } from '../build/multi-page-crawler.js';

(async () => {
    console.log('=== BrowserStack Demo - Multi-Page Crawler with Login ===\n');

    const config = {
        startUrl: 'https://www.bstackdemo.com',
        maxPages: 10,
        maxDepth: 2,
        detectWorkflows: true,
        enableAutoLogin: true,
        credentials: {
            username: 'demouser',
            password: 'testingisfun99',
        },
    };

    console.log('Configuration:');
    console.log(JSON.stringify({
        ...config,
        credentials: {
            username: config.credentials.username,
            password: '***',
        },
    }, null, 2));
    console.log('\n' + '='.repeat(60));

    try {
        const crawler = new MultiPageCrawler(config);
        console.log('\n🚀 Starting crawl...\n');

        const startTime = Date.now();
        const result = await crawler.crawl();
        const duration = Date.now() - startTime;

        console.log('\n✅ CRAWL COMPLETED\n');
        console.log('Summary:');
        console.log(`  Pages crawled: ${result.summary.pagesVisited}`);
        console.log(`  Workflows detected: ${result.summary.workflowsDetected}`);
        console.log(`  Total elements analyzed: ${result.summary.totalElements}`);
        console.log(`  High-intent elements: ${result.summary.highIntentElements}`);
        console.log(`  Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

        if (result.session.pages.length > 0) {
            console.log(`\nPages crawled (${result.session.pages.length} total):`);
            result.session.pages.forEach((page, idx) => {
                console.log(`  ${idx + 1}. ${page.url}`);
                if (page.title) {
                    console.log(`     Title: ${page.title}`);
                }
                console.log(`     Elements: ${page.highIntentElements?.length || 0} high-intent`);
            });
        }

        if (result.session.workflows && result.session.workflows.length > 0) {
            console.log(`\nDetected Workflows (${result.session.workflows.length} total):`);
            result.session.workflows.forEach((wf) => {
                console.log(`  - ${wf.name}`);
                console.log(`    Confidence: ${Math.round(wf.confidence)}%`);
                if (wf.steps && wf.steps.length > 0) {
                    console.log(`    Steps: ${wf.steps.length}`);
                }
            });
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ Test completed successfully');
        console.log('='.repeat(60));
    } catch (error) {
        console.error('\n❌ ERROR:', error instanceof Error ? error.message : error);
        console.error('\nFull error:');
        console.error(error);
        process.exit(1);
    }
})();
