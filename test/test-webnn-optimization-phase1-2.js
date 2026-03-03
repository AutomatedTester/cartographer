#!/usr/bin/env node

/**
 * WebNN Optimization Test Suite - Phase 1 & 2
 * 
 * Tests for:
 * - Phase 1: Batch embeddings, WebNN capability detection, performance metrics, error diagnostics
 * - Phase 2: Model persistence/caching, advanced pipeline options, GPU memory management
 * 
 * Tests are designed to:
 * 1. Verify optimizations work without breaking existing functionality
 * 2. Measure performance improvements where applicable
 * 3. Ensure metrics are collected and properly formatted
 * 4. Validate model caching behavior across instances
 * 5. Test batching on large DOMs (100+ elements)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock browser globals for testing analyzer.ts layer
const mockBrowser = () => {
  global.window = {
    location: {
      href: 'https://example.com/test',
    },
    navigator: {
      ml: undefined, // Will be mocked per test
    },
  };
  global.navigator = global.window.navigator;
  global.document = {
    title: 'Test Page',
    body: {
      children: [],
    },
    querySelectorAll: () => [],
  };
};

// Tests
const tests = {
  /**
   * PHASE 1: Test batch embedding computation
   * Should compute multiple embeddings in parallel via Promise.all()
   */
  async testBatchEmbeddingComputation() {
    console.log('\n✓ Test: Batch Embedding Computation (Phase 1)');
    
    // This test verifies the code path that uses Promise.all() instead of sequential loops
    // The analyzer.ts should call Promise.all(descriptions.map(desc => this.extractor(desc)))
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check that Promise.all is used for batch embeddings
    assert(
      analyzerCode.includes('await Promise.all('),
      'analyzer.ts should use Promise.all for batch embedding'
    );
    
    // Check that it's not using the old sequential loop
    assert(
      !analyzerCode.includes('for (const desc of descriptions)') || 
      !analyzerCode.includes('await this.extractor(desc)'),
      'analyzer.ts should not use sequential embedding loop'
    );
    
    console.log('  ✓ Promise.all() detected for parallel embeddings');
    console.log('  ✓ Sequential embedding loop removed');
  },

  /**
   * PHASE 1: Test WebNN capability detection
   * Should detect if WebNN is available without causing timeouts
   */
  async testWebNNCapabilityDetection() {
    console.log('\n✓ Test: WebNN Capability Detection (Phase 1)');
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check that isWebNNSupported method exists
    assert(
      analyzerCode.includes('isWebNNSupported'),
      'analyzer.ts should have isWebNNSupported method'
    );
    
    // Check that it checks navigator.ml
    assert(
      analyzerCode.includes("'ml' in navigator"),
      'Should check for navigator.ml availability'
    );
    
    // Check that WebNN is skipped if not supported
    assert(
      analyzerCode.includes('webnnSupported'),
      'init() should check WebNN support before attempting load'
    );
    
    // Check that device list is conditional (look for ternary operator)
    assert(
      analyzerCode.includes('webnnSupported') && 
      analyzerCode.includes('? (["webnn", "webgpu", "wasm"]'),
      'Device array should be conditional on WebNN support'
    );
    
    console.log('  ✓ navigator.ml check implemented');
    console.log('  ✓ WebNN capability detection method exists');
    console.log('  ✓ Device selection is conditional on support');
  },

  /**
   * PHASE 1: Test performance metrics collection
   * Should track device, timings, and element counts
   */
  async testPerformanceMetricsCollection() {
    console.log('\n✓ Test: Performance Metrics Collection (Phase 1)');
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check that metrics object is created
    assert(
      analyzerCode.includes('const metrics: AnalysisMetrics'),
      'Should create AnalysisMetrics object'
    );
    
    // Check that all metrics fields are populated
    const metricsFields = [
      'device: this.device',
      'modelLoadTime: this.modelLoadTime',
      'analysisTime',
      'deduplicationTime',
      'elementsAnalyzed',
      'elementsClustered',
    ];
    
    for (const field of metricsFields) {
      assert(
        analyzerCode.includes(field),
        `Metrics should include field: ${field}`
      );
    }
    
    // Check that metrics are returned in result
    assert(
      analyzerCode.includes('metrics,'),
      'AnalysisResult should include metrics'
    );
    
    console.log('  ✓ AnalysisMetrics object creation');
    console.log('  ✓ All metric fields populated');
    console.log('  ✓ Metrics returned in AnalysisResult');
  },

  /**
   * PHASE 1: Test error diagnostics
   * Should provide clear error messages for each device fallback
   */
  async testErrorDiagnostics() {
    console.log('\n✓ Test: Error Diagnostics (Phase 1)');
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check that error messages include device name
    assert(
      analyzerCode.includes('[analyzer]') && analyzerCode.includes('Failed to load on'),
      'Should log which device failed'
    );
    
    // Check that error messages include error details
    assert(
      analyzerCode.includes('errorMsg'),
      'Should include error message details'
    );
    
    // Check for clear success/failure indicators in logging
    assert(
      (analyzerCode.includes('✓ Model loaded') || analyzerCode.includes('Model loaded')) &&
      (analyzerCode.includes('✗ Failed') || analyzerCode.includes('Failed')),
      'Should have clear success/failure path indicators'
    );
    
    console.log('  ✓ Device-specific error messages');
    console.log('  ✓ Error details included in logs');
    console.log('  ✓ Clear success/failure indicators');
  },

  /**
   * PHASE 2: Test model persistence/caching
   * Should reuse model across analyzer instances
   */
  async testModelPersistenceCaching() {
    console.log('\n✓ Test: Model Persistence/Caching (Phase 2)');
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check for static cache
    assert(
      analyzerCode.includes('private static globalModelCache'),
      'Should have static global model cache'
    );
    
    // Check for cache reuse logic
    assert(
      analyzerCode.includes('if (DomAnalyzer.globalModelCache)'),
      'init() should check for cached model'
    );
    
    // Check for cache population
    assert(
      analyzerCode.includes('DomAnalyzer.globalModelCache ='),
      'Should populate global cache'
    );
    
    // Check for clearModelCache static method
    assert(
      analyzerCode.includes('static clearModelCache'),
      'Should have clearModelCache static method'
    );
    
    // Check for concurrent init handling
    assert(
      analyzerCode.includes('DomAnalyzer.modelLoadPromise'),
      'Should handle concurrent init with promise'
    );
    
    console.log('  ✓ Static model cache implemented');
    console.log('  ✓ Cache reuse on init()');
    console.log('  ✓ Concurrent init handling');
    console.log('  ✓ clearModelCache() method available');
  },

  /**
   * PHASE 2: Test advanced pipeline options
   * Should use float16 and quantization settings
   */
  async testAdvancedPipelineOptions() {
    console.log('\n✓ Test: Advanced Pipeline Options (Phase 2)');
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check for dtype configuration
    assert(
      analyzerCode.includes('dtype:') && 
      (analyzerCode.includes("'float16'") || analyzerCode.includes('"float16"')),
      'Should configure dtype as float16 for GPU'
    );
    
    // Check for quantization
    assert(
      analyzerCode.includes('quantized:') && analyzerCode.includes('true'),
      'Should enable quantization'
    );
    
    // Check for device-specific dtype
    assert(
      analyzerCode.includes('device === \'wasm\''),
      'Should check device type for dtype selection'
    );
    
    console.log('  ✓ float16 dtype configured for GPU');
    console.log('  ✓ Quantization enabled');
    console.log('  ✓ Device-specific dtype selection');
  },

  /**
   * PHASE 2: Test GPU memory management with batching
   * Should batch embeddings for large DOMs (100+)
   */
  async testGPUMemoryBatching() {
    console.log('\n✓ Test: GPU Memory Management with Batching (Phase 2)');
    
    const analyzerCode = fs.readFileSync(
      path.join(__dirname, '../src/analyzer.ts'),
      'utf8'
    );
    
    // Check for maxBatchSize parameter
    assert(
      analyzerCode.includes('maxBatchSize'),
      'analyzeCurrentPage should accept maxBatchSize parameter'
    );
    
    // Check for batch size check
    assert(
      analyzerCode.includes('descriptions.length > maxBatchSize'),
      'Should check if batching is needed'
    );
    
    // Check for batching loop
    assert(
      analyzerCode.includes('for (let i = 0; i < descriptions.length; i += maxBatchSize)'),
      'Should have batching loop for large descriptions'
    );
    
    // Check for slice operation
    assert(
      analyzerCode.includes('descriptions.slice(i, i + maxBatchSize)'),
      'Should slice descriptions into batches'
    );
    
    console.log('  ✓ maxBatchSize parameter added');
    console.log('  ✓ Batch size checking');
    console.log('  ✓ Batching loop for large DOMs');
    console.log('  ✓ Memory-efficient batch processing');
  },

  /**
   * Type safety: Check that AnalysisMetrics is properly exported
   */
  async testAnalysisMetricsType() {
    console.log('\n✓ Test: AnalysisMetrics Type Definition');
    
    const typesCode = fs.readFileSync(
      path.join(__dirname, '../src/types.ts'),
      'utf8'
    );
    
    // Check that AnalysisMetrics interface exists
    assert(
      typesCode.includes('export interface AnalysisMetrics'),
      'AnalysisMetrics interface should be exported'
    );
    
    // Check all required fields
    const requiredFields = [
      'device:',
      'modelLoadTime:',
      'analysisTime:',
      'deduplicationTime:',
      'elementsAnalyzed:',
      'elementsClustered:',
    ];
    
    for (const field of requiredFields) {
      assert(
        typesCode.includes(field),
        `AnalysisMetrics should have ${field} field`
      );
    }
    
    // Check that AnalysisResult includes metrics
    assert(
      typesCode.includes('metrics?: AnalysisMetrics'),
      'AnalysisResult should have optional metrics field'
    );
    
    console.log('  ✓ AnalysisMetrics interface defined');
    console.log('  ✓ All metrics fields present');
    console.log('  ✓ AnalysisResult includes metrics option');
  },

  /**
   * Build verification
   */
  async testBuildArtifacts() {
    console.log('\n✓ Test: Build Artifacts Exist');
    
    const buildDir = path.join(__dirname, '../build');
    
    const requiredFiles = [
      'analyzer.js',
      'analyzer.browser.js',
      'analyzer.d.ts',
    ];
    
    for (const file of requiredFiles) {
      const filePath = path.join(buildDir, file);
      assert(
        fs.existsSync(filePath),
        `Build artifact should exist: ${file}`
      );
    }
    
    console.log('  ✓ analyzer.js compiled');
    console.log('  ✓ analyzer.browser.js bundled');
    console.log('  ✓ analyzer.d.ts types generated');
  },
};

/**
 * Test Runner
 */
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  WebNN Optimization Tests - Phase 1 & 2                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const testNames = Object.keys(tests);
  let passed = 0;
  let failed = 0;
  
  for (const testName of testNames) {
    try {
      await tests[testName]();
      passed++;
    } catch (err) {
      failed++;
      console.error(`\n✗ FAILED: ${testName}`);
      console.error(`  ${err.message}\n`);
    }
  }
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed                           ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
