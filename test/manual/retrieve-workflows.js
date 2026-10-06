#!/usr/bin/env node

/**
 * Workflow Retrieval and Export Script
 * 
 * Runs the multi-page crawl and then exports workflow data directly
 * without relying on disabled MCP tools.
 */

import { MultiPageCrawler } from '../build/multi-page-crawler.js';
import { MarkdownExporter } from '../build/markdown-exporter.js';
import fs from 'fs';

async function retrieveAndExportWorkflows() {
  console.log('\n=== Workflow Retrieval and Export ===\n');

  // Re-run the crawl to get fresh session data
  const config = {
    startUrl: 'https://the-internet.herokuapp.com/',
    maxPages: 25,
    maxDepth: 3,
    enableAutoLogin: true,
    detectWorkflows: true,
    workflowStrategy: 'both',
    credentials: {
      username: 'tomsmith',
      password: 'SuperSecretPassword!'
    }
  };

  console.log('Running multi-page crawl to retrieve workflow data...');
  const crawler = new MultiPageCrawler(config);
  
  try {
    const result = await crawler.crawl();

    console.log(`✓ Crawl complete. Session ID: ${result.session.sessionId}`);
    console.log(`✓ Workflows detected: ${result.detectedWorkflows?.length || 0}`);

    if (!result.detectedWorkflows || result.detectedWorkflows.length === 0) {
      console.log('\n⚠ No workflows detected in this crawl.');
      return;
    }

    // Export each workflow
    for (const workflow of result.detectedWorkflows) {
      console.log(`\nProcessing workflow: ${workflow.name}`);

      // Export as workflow sequence (individual format)
      const sequenceMarkdown = MarkdownExporter.exportWorkflowSequence(workflow);
      const sequenceFile = `${workflow.name.toUpperCase().replace(/\s+/g, '_')}_SEQUENCE.md`;
      fs.writeFileSync(sequenceFile, sequenceMarkdown);
      console.log(`  ✓ Written ${sequenceFile}`);

      // Export as JSON
      const jsonFile = `workflow-${workflow.name}.json`;
      fs.writeFileSync(jsonFile, JSON.stringify(workflow, null, 2));
      console.log(`  ✓ Written ${jsonFile}`);
    }

    // Full report with all workflows
    if (result.detectedWorkflows.length > 0) {
      const fullMarkdown = MarkdownExporter.exportDetectedWorkflows(result.detectedWorkflows);
      const fullFile = 'WORKFLOWS_FULL_REPORT.md';
      fs.writeFileSync(fullFile, fullMarkdown);
      console.log(`\n✓ Written ${fullFile}`);
    }

    // Comparison (if multiple workflows)
    if (result.detectedWorkflows.length > 1) {
      const comparisonMarkdown = MarkdownExporter.exportWorkflowComparison(result.detectedWorkflows);
      const comparisonFile = 'WORKFLOWS_COMPARISON.md';
      fs.writeFileSync(comparisonFile, comparisonMarkdown);
      console.log(`✓ Written ${comparisonFile}`);
    }

    console.log('\n=== Export Complete ===\n');
    console.log('Generated files:');
    for (const workflow of result.detectedWorkflows) {
      console.log(`  - ${workflow.name.toUpperCase().replace(/\s+/g, '_')}_SEQUENCE.md`);
      console.log(`  - workflow-${workflow.name}.json`);
    }
    if (result.detectedWorkflows.length > 0) {
      console.log(`  - WORKFLOWS_FULL_REPORT.md`);
    }
    if (result.detectedWorkflows.length > 1) {
      console.log(`  - WORKFLOWS_COMPARISON.md`);
    }

    console.log('\nWorkflow Summary:');
    for (const workflow of result.detectedWorkflows) {
      console.log(`\n  ${workflow.name}:`);
      console.log(`    ID: ${workflow.id}`);
      console.log(`    Confidence: ${(workflow.confidence * 100).toFixed(0)}%`);
      console.log(`    Pages: ${workflow.pageSequence?.length || 0}`);
      console.log(`    Tags: ${workflow.tags?.join(', ') || 'none'}`);
    }

  } catch (error) {
    console.error('Crawl/export failed:', error);
    process.exit(1);
  }
}

retrieveAndExportWorkflows();
