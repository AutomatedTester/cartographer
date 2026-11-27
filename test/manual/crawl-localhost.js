#!/usr/bin/env node

/**
 * Multi-page crawl test for localhost:4173
 */

import { MultiPageCrawler } from '../build/multi-page-crawler.js';

console.log('=== Multi-Page Crawl Test: localhost:4173 ===\n');

const config = {
    startUrl: 'http://localhost:4173/',
    maxPages: 20,
    maxDepth: 5,
    concurrencyLimit: 3,
    detectWorkflows: true,
    workflowStrategy: 'both',
    // Supply a login for the app under test via the environment, e.g.
    //   CRAWL_USERNAME=me@example.com CRAWL_PASSWORD=... node test/manual/run-manual.js crawl-localhost.js
    credentials: {
        username: process.env.CRAWL_USERNAME ?? '',
        password: process.env.CRAWL_PASSWORD ?? '',
    },
};

async function runCrawl() {
    try {
        console.log('Starting crawl with config:');
        console.log(`  Start URL: ${config.startUrl}`);
        console.log(`  Max Pages: ${config.maxPages}`);
        console.log(`  Max Depth: ${config.maxDepth}`);
        console.log(`  Detect Workflows: ${config.detectWorkflows}`);
        console.log(`  Has Credentials: ${!!config.credentials.username}\n`);

        const crawler = new MultiPageCrawler(config);
        const result = await crawler.crawl();

        console.log('\n=== Crawl Results ===\n');
        console.log(`Total Pages Visited: ${result.summary.pagesVisited}`);
        console.log(`Total Elements: ${result.summary.totalElements}`);
        console.log(`High Intent Elements: ${result.summary.highIntentElements}`);
        console.log(`Workflows Detected: ${result.summary.workflowsDetected}`);
        console.log(`Estimated User Journeys: ${result.summary.estimatedUserJourneys}`);
        console.log(`Total Time: ${(result.performance.totalTime / 1000).toFixed(2)}s`);
        console.log(`Performance: ${result.performance.avgTimePerPage}ms avg per page`);
        console.log(`\nSession State Keys: ${Object.keys(result.session.sessionState).join(', ') || 'none'}`);
        
        if (result.session.pages.length > 0) {
            console.log('\nPages visited:');
            result.session.pages.forEach((page, i) => {
                console.log(`  ${i + 1}. ${page.url}`);
                console.log(`     - Title: ${page.title}`);
                console.log(`     - High Intent Elements: ${page.highIntentElements?.length || 0}`);
                console.log(`     - Generated Test Cases: ${page.generatedTestCases?.length || 0}`);
                
                if (page.highIntentElements && page.highIntentElements.length > 0) {
                    console.log(`\n     Elements detail:`);
                    page.highIntentElements.forEach((el, idx) => {
                        const navText = el.navigationTarget ? ` -> ${el.navigationTarget}` : '';
                        const reasons = el.intentReasons ? ` [${el.intentReasons.join(', ')}]` : '';
                        console.log(
                            `       ${idx + 1}. <${el.tag}> "${el.text}" ` +
                            `[score=${el.intentScore}, navigates=${el.navigates}${navText}]${reasons}`
                        );
                    });
                }
                
                // Show pending button clicks if any
                if (page.pendingButtonClicks) {
                    console.log(`\n     Pending Button Clicks:`);
                    page.pendingButtonClicks.forEach((btn, idx) => {
                        console.log(`       ${idx + 1}. ${btn}`);
                    });
                }
            });
        }

        if (result.detectedWorkflows && result.detectedWorkflows.length > 0) {
            console.log('\nWorkflows detected:');
            result.detectedWorkflows.forEach((workflow, i) => {
                console.log(`  ${i + 1}. ${workflow.name}`);
                console.log(`     - Type: ${workflow.type}`);
                console.log(`     - Confidence: ${(workflow.confidence * 100).toFixed(1)}%`);
                console.log(`     - Steps: ${workflow.steps?.length || 0}`);
            });
        }

    } catch (error) {
        console.error('❌ Crawl failed:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
    }
}

runCrawl();
