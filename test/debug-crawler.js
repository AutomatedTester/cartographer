#!/usr/bin/env node

/**
 * Debug test for multi-page crawler
 * Tests various URL formats and logs detailed diagnostics
 */

import { MultiPageCrawlerDebug } from '../build/multi-page-crawler-debug.js';

console.log('=== Multi-Page Crawler Debug Test ===\n');

const testUrls = [
    'https://www.bstackdemo.com',
    'http://www.bstackdemo.com',
    'www.bstackdemo.com',
];

for (const url of testUrls) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing URL: ${url}`);
    console.log('='.repeat(60));

    try {
        const config = {
            startUrl: url,
            maxPages: 5,
            maxDepth: 2,
            detectWorkflows: false, // Disable to focus on crawling
        };

        console.log(`\nConfig: ${JSON.stringify(config)}`);
        console.log('\nStarting crawl...\n');

        const crawler = new MultiPageCrawlerDebug(config);
        const { result, debug } = await crawler.crawl();

        console.log('\n' + '='.repeat(60));
        console.log('RESULTS');
        console.log('='.repeat(60));
        console.log(`Pages crawled: ${result.summary.pagesVisited}`);
        console.log(`Workflows detected: ${result.summary.workflowsDetected}`);
        console.log(`Total time: ${result.performance?.totalTime}ms`);

        if (result.summary.pagesVisited > 0) {
            console.log('\nPages crawled:');
            for (const page of result.session.pages) {
                console.log(`  - ${page.url} (${page.highIntentElements.length} elements)`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('DEBUG LOG');
        console.log('='.repeat(60));
        for (const log of debug) {
            console.log(log);
        }
    } catch (error) {
        console.error(`\n✗ Error with URL "${url}":`, error instanceof Error ? error.message : error);
    }

    console.log('\n');
}

console.log('\n=== Test Complete ===');
