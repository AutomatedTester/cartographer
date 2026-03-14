/**
 * Phase 4 Enhancement: Performance Optimization Layer
 * 
 * Optimizes analysis for large DOMs by:
 * - Batch processing with memory management
 * - Incremental analysis for progressive results  
 * - Adaptive thresholds based on DOM complexity
 * - Smart caching and deduplication
 */

import { HighIntentElement } from "./types.js";

/**
 * Performance metrics tracked during analysis
 */
export interface PerformanceMetrics {
  totalElements: number;
  highIntentElements: number;
  analysisTimeMs: number;
  memoryUsageMb: number;
  avgTimePerElement: number;
  batchCount: number;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * Configuration for performance optimization
 */
export interface OptimizationConfig {
  batchSize: number;
  maxElementsPerAnalysis: number;
  adaptiveThreshold: boolean;
  enableIncrementalResults: boolean;
  enableMemoryMonitoring: boolean;
  cachingStrategy: "aggressive" | "moderate" | "conservative";
}

/**
 * PerformanceOptimizer: Handles analysis scaling for large DOMs
 * 
 * Provides:
 * - Batch processing to prevent memory issues
 * - Incremental results for faster feedback
 * - Adaptive thresholds based on DOM complexity
 * - Smart memory management
 */
export class PerformanceOptimizer {
  private config: OptimizationConfig;
  private metrics: PerformanceMetrics;
  private elementCache: Map<string, HighIntentElement> = new Map();

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = {
      batchSize: config.batchSize ?? 50,
      maxElementsPerAnalysis: config.maxElementsPerAnalysis ?? 500,
      adaptiveThreshold: config.adaptiveThreshold ?? true,
      enableIncrementalResults: config.enableIncrementalResults ?? true,
      enableMemoryMonitoring: config.enableMemoryMonitoring ?? true,
      cachingStrategy: config.cachingStrategy ?? "moderate",
    };

    this.metrics = {
      totalElements: 0,
      highIntentElements: 0,
      analysisTimeMs: 0,
      memoryUsageMb: 0,
      avgTimePerElement: 0,
      batchCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Process elements in optimized batches
   * Yields incremental results as batches complete
   */
  async *processInBatches<T>(
    elements: T[],
    processor: (batch: T[]) => Promise<HighIntentElement[]>,
    onProgress?: (progress: number) => void
  ): AsyncGenerator<HighIntentElement[], void, unknown> {
    const batchSize = this.config.batchSize;
    const batches = Math.ceil(elements.length / batchSize);
    let allResults: HighIntentElement[] = [];

    for (let i = 0; i < batches; i++) {
      const startIdx = i * batchSize;
      const endIdx = Math.min(startIdx + batchSize, elements.length);
      const batch = elements.slice(startIdx, endIdx);

      const startTime = performance.now();
      const batchResults = await processor(batch);
      const batchTime = performance.now() - startTime;

      // Track metrics
      this.metrics.batchCount++;
      this.metrics.analysisTimeMs += batchTime;
      this.metrics.avgTimePerElement = this.metrics.analysisTimeMs / (i + 1) / batch.length;

      // Combine results
      allResults = allResults.concat(batchResults);

      // Yield incremental results
      if (this.config.enableIncrementalResults) {
        yield allResults;
      }

      // Report progress
      if (onProgress) {
        onProgress((i + 1) / batches);
      }

      // Memory monitoring and cleanup
      if (this.config.enableMemoryMonitoring) {
        this.checkAndCleanMemory();
      }
    }

    // Final yield with all results
    yield allResults;
  }

  /**
   * Adaptive threshold based on DOM complexity
   * Larger DOMs = higher threshold (be more selective)
   */
  calculateAdaptiveThreshold(elementCount: number, baseThreshold: number): number {
    if (!this.config.adaptiveThreshold) return baseThreshold;

    // Scale threshold based on element count
    // More elements = higher threshold to avoid noise
    const scaleFactor = 1 + Math.log10(Math.max(elementCount, 10)) / 10;
    return Math.floor(baseThreshold * scaleFactor);
  }

  /**
   * Deduplicate elements using smart caching
   */
  deduplicateElements(elements: HighIntentElement[]): HighIntentElement[] {
    const seen = new Set<string>();
    const deduplicated: HighIntentElement[] = [];

    for (const el of elements) {
      const key = this.getElementKey(el);

      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(el);

        // Cache for future lookups
        if (this.config.cachingStrategy === "aggressive") {
          this.elementCache.set(key, el);
        }
      } else {
        this.metrics.cacheHits++;
      }
    }

    this.metrics.cacheMisses = deduplicated.length - this.metrics.cacheHits;
    return deduplicated;
  }

  /**
   * Check memory usage and clear cache if needed
   */
  private checkAndCleanMemory(): void {
    if (typeof process !== "undefined" && process.memoryUsage) {
      const used = process.memoryUsage().heapUsed / 1024 / 1024;
      this.metrics.memoryUsageMb = used;

      // If using >200MB, clean cache
      if (used > 200 && this.elementCache.size > 0) {
        const toRemove = Math.floor(this.elementCache.size / 2);
        let removed = 0;

        for (const [key, _] of this.elementCache.entries()) {
          this.elementCache.delete(key);
          removed++;
          if (removed >= toRemove) break;
        }

        console.log(`[perf] Cleared ${removed} cached elements to free memory`);
      }
    }
  }

  /**
   * Get unique key for deduplication
   */
  private getElementKey(el: HighIntentElement): string {
    return `${el.tag}:${el.id || el.classes?.join(".") || el.text || el.ariaLabel || ""}`;
  }

  /**
   * Report performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics for new analysis
   */
  resetMetrics(): void {
    this.metrics = {
      totalElements: 0,
      highIntentElements: 0,
      analysisTimeMs: 0,
      memoryUsageMb: 0,
      avgTimePerElement: 0,
      batchCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.elementCache.clear();
  }
}

/**
 * Incremental Analysis Engine
 * 
 * Provides partial results as analysis progresses
 * Useful for UI feedback and early stopping
 */
export class IncrementalAnalyzer {
  private checkpoints: HighIntentElement[] = [];
  private lastCheckpointTime: number = 0;
  private checkpointIntervalMs: number = 500; // Report every 500ms

  recordProgress(elements: HighIntentElement[]): void {
    const now = performance.now();

    if (now - this.lastCheckpointTime > this.checkpointIntervalMs) {
      this.checkpoints.push(...elements);
      this.lastCheckpointTime = now;
    }
  }

  getCheckpoints(): HighIntentElement[] {
    return this.checkpoints;
  }

  reset(): void {
    this.checkpoints = [];
    this.lastCheckpointTime = 0;
  }
}

/**
 * DOM Complexity Analyzer
 * 
 * Estimates complexity to optimize analysis strategy
 */
export class DOMComplexityAnalyzer {
  /**
   * Analyze DOM complexity and suggest optimizations
   */
  static analyzeComplexity(elements: any[]): ComplexityMetrics {
    const metrics: ComplexityMetrics = {
      totalElements: elements.length,
      averageDepth: this.calculateAverageDepth(elements),
      nestingFactor: this.calculateNestingFactor(elements),
      estimatedComplexity: "unknown",
      suggestedBatchSize: 50,
      suggestedThreshold: 35,
    };

    // Classify complexity
    if (elements.length < 100) {
      metrics.estimatedComplexity = "low";
      metrics.suggestedBatchSize = 100;
      metrics.suggestedThreshold = 30;
    } else if (elements.length < 500) {
      metrics.estimatedComplexity = "medium";
      metrics.suggestedBatchSize = 50;
      metrics.suggestedThreshold = 35;
    } else {
      metrics.estimatedComplexity = "high";
      metrics.suggestedBatchSize = 25;
      metrics.suggestedThreshold = 40;
    }

    // Factor in nesting complexity
    if (metrics.averageDepth > 8) {
      metrics.estimatedComplexity = "high";
      if (metrics.suggestedBatchSize > 25) {
        metrics.suggestedBatchSize = 25;
      }
    }

    return metrics;
  }

  /**
   * Calculate average element depth in DOM tree
   */
  private static calculateAverageDepth(elements: any[]): number {
    if (elements.length === 0) return 0;

    let totalDepth = 0;
    elements.forEach((el) => {
      // Rough estimation based on path
      totalDepth += (el.children?.length || 0);
    });

    return totalDepth / elements.length;
  }

  /**
   * Calculate nesting factor (how deeply nested is the DOM)
   */
  private static calculateNestingFactor(elements: any[]): number {
    let maxNesting = 0;

    const calculateNesting = (el: any, depth: number): void => {
      maxNesting = Math.max(maxNesting, depth);
      if (el.children) {
        el.children.forEach((child: any) => calculateNesting(child, depth + 1));
      }
    };

    elements.forEach((el) => calculateNesting(el, 0));
    return maxNesting;
  }
}

export interface ComplexityMetrics {
  totalElements: number;
  averageDepth: number;
  nestingFactor: number;
  estimatedComplexity: "low" | "medium" | "high" | "unknown";
  suggestedBatchSize: number;
  suggestedThreshold: number;
}

export default PerformanceOptimizer;
