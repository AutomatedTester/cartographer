#!/usr/bin/env node

/**
 * Multi-page crawl test for https://the-internet.herokuapp.com/
 * Demonstrates crawling with login automation
 */

import { MultiPageCrawler } from '../build/multi-page-crawler.js';

async function crawlInternet() {
    const config = {
        startUrl: 'https://the-internet.herokuapp.com/',
        maxPages: 15,
        maxDepth: 3,
        enableAutoLogin: true,
        detectWorkflows: true,
        workflowStrategy: 'both',
        credentials: {
            username: 'tomsmith',
            password: 'SuperSecretPassword!'
        }
    };

    console.log('\n=== Crawling https://the-internet.herokuapp.com/ ===\n');
    console.log('Config:', JSON.stringify({
        ...config,
        credentials: '[redacted]'
    }, null, 2));
    console.log('\n');

    const crawler = new MultiPageCrawler(config);
    
    try {
        const result = await crawler.crawl();
        
        console.log('\n=== Crawl Complete ===\n');
        
        // Display summary
        if (result.summary) {
            console.log('Summary:');
            console.log(`  Pages visited: ${result.summary.pagesVisited}`);
            console.log(`  Total elements: ${result.summary.totalElements}`);
            console.log(`  High-intent elements: ${result.summary.highIntentElements}`);
            console.log(`  Workflows detected: ${result.summary.workflowsDetected}`);
            console.log(`  Estimated user journeys: ${result.summary.estimatedUserJourneys}`);
        }
        
        // Display performance metrics
        if (result.performance) {
            console.log('\nPerformance:');
            console.log(`  Total time: ${result.performance.totalTime}ms`);
            console.log(`  Concurrency level: ${result.performance.concurrency}`);
            console.log(`  Avg time per page: ${result.performance.avgTimePerPage}ms`);
        }
        
        // Display pages visited
        if (result.session && result.session.pages && result.session.pages.length > 0) {
            console.log(`\nPages visited (${result.session.pages.length}):`);
            result.session.pages.slice(0, 10).forEach((page, idx) => {
                console.log(`  ${idx + 1}. ${page.url}`);
            });
            if (result.session.pages.length > 10) {
                console.log(`  ... and ${result.session.pages.length - 10} more pages`);
            }
        }
        
        // Display detected workflows
        if (result.detectedWorkflows && result.detectedWorkflows.length > 0) {
            console.log(`\nDetected workflows (${result.detectedWorkflows.length}):`);
            result.detectedWorkflows.forEach((workflow, idx) => {
                console.log(`  ${idx + 1}. ${workflow.name} (${workflow.type})`);
            });
        } else {
            console.log('\nNo workflows detected');
        }
        
        console.log('\n=== Full Result JSON ===\n');
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('Crawl failed:', error);
        process.exit(1);
    }
}

crawlInternet();
