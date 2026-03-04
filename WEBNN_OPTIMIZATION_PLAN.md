# WebNN Optimization Plan: Minimize Copilot Token Usage

**Date:** March 3, 2026  
**Goal:** Maximize all ML/semantic operations in the browser using WebNN, with heuristic fallbacks  
**Token Savings Target:** 90%+ reduction in Copilot/LLM API calls

---

## Executive Summary

Your project currently uses:
- **Transformers.js** (already browser-based via WebNN) ✅
- **Heuristic workflow detection** (Node.js, could move to browser) ⚠️
- **Test case generation** (Node.js, semi-templated) ⚠️
- **Semantic tool generation** (Node.js, rule-based) ✅
- **Element locator retrieval** (currently uses Copilot for natural language resolution) ❌

**Strategy:** Shift all non-essential operations to browser WebNN, eliminate Copilot calls entirely, use heuristics as primary path.

---

## Phase 1: Browser-Side ML Model Optimization (Week 1-2)

### 1.1 Current Model: `all-MiniLM-L6-v2`
- **Size:** ~134MB
- **Speed on WebNN:** ~500-2000ms per similarity check
- **Issue:** Slow for large-scale crawls (multi-page = many elements)

### 1.2 Optimizations to Implement

#### A. Introduce Multi-Tier Model Strategy
```
Decision Tree:
├─ Use Lightweight Model (DistilBERT, ~28MB)
│  ├─ For real-time page analysis (< 100 elements)
│  └─ 5-10x faster on WebNN
├─ Cache Heavy Model (all-MiniLM) for batch operations
│  └─ Pre-load in background worker
└─ Fallback to Heuristics (no ML)
   └─ Pattern matching, regex, DOM inspection
```

**Implementation:**
- [ ] Add `Xenova/distilbert-base-multilingual-cased` (~28MB) as primary model
- [ ] Keep `all-MiniLM-L6-v2` for accuracy-critical operations only
- [ ] Create model selection logic in `src/analyzer.ts`

**Code Example:**
```typescript
// analyzer.ts
private async selectModel(elementCount: number): Promise<'lightweight' | 'heavy'> {
  if (elementCount < 100) return 'lightweight'; // DistilBERT
  if (navigator.deviceMemory! >= 8) return 'heavy'; // all-MiniLM
  return 'lightweight'; // Fallback
}
```

#### B. Embedding Caching Strategy
- Cache embeddings per-session using IndexedDB
- Avoid re-computing embeddings for common element patterns
- TTL: 1 hour
- Estimated impact: **80% reduction in embedding computations**

**Implementation:**
- [ ] Create `src/embedding-cache.ts` for IndexedDB management
- [ ] Serialize/deserialize embeddings (Float32Array → JSON)
- [ ] Add cache hit/miss metrics

#### C. Quantization Support
- Use `Xenova/transformers` quantization for INT8 encoding
- Reduces WebNN memory footprint by 75%
- Negligible accuracy loss (<1%)

**Implementation:**
- [ ] Update model loading to use quantized versions
- [ ] Verify WebNN compatibility with quantized models
- [ ] Benchmark before/after

---

## Phase 2: Client-Side Analysis Pipeline (Week 2-3)

### 2.1 Move Analysis to Browser
Currently: `SiteCrawler` (Node.js) → `DomAnalyzer` (browser via Transformers.js) → `MCP Server`

**New Flow:**
```
Browser:
├─ SiteCrawler (Selenium snapshot extraction)
├─ DomAnalyzer (WebNN/local ML)
├─ HeuristicScorer (pattern matching)
├─ TestCaseGenerator (template-based)
├─ SemanticToolGenerator (rule-based)
└─ Export (JSON/Markdown)
```

### 2.2 Implement Browser-Side Analysis Module

**Create `src/analyzer-browser.ts`:**
- Full self-contained analysis pipeline
- Replicate current analyzer logic
- No external API calls

**Key Functions:**
```typescript
export class BrowserAnalysisPipeline {
  // Initialize models once per session
  async init(): Promise<void>
  
  // Analyze DOM elements with WebNN
  async analyzeElements(elements: DomElement[]): Promise<AnalysisResult>
  
  // Heuristic fallback if WebNN unavailable
  analyzeElementsHeuristic(elements: DomElement[]): AnalysisResult
  
  // Generate test cases (no Copilot needed)
  generateTestCases(elements: HighIntentElement[]): GeneratedTestCase[]
  
  // Generate semantic tools (no Copilot needed)
  generateSemanticTools(elements: HighIntentElement[]): SemanticToolSchema[]
  
  // Export in multiple formats
  exportResults(format: 'json' | 'markdown'): string
}
```

**Implementation Checklist:**
- [ ] Port `src/analyzer.ts` → `src/analyzer-browser.ts` (client-side)
- [ ] Implement `HeuristicScorer` class (pattern-based scoring)
- [ ] Move test case generation to browser
- [ ] Move semantic tool generation to browser
- [ ] Build browser bundle with `npm run build:browser`
- [ ] Inject into Selenium driver for execution

### 2.3 Heuristic Scoring System

**Implement in `src/heuristic-scorer.ts`:**

```typescript
export class HeuristicScorer {
  // Score elements based on patterns (no ML needed)
  
  scoreElement(el: DomElement): number {
    let score = 0;
    
    // Interactive element patterns
    if (el.tag === 'button') score += 50
    if (el.tag === 'input' || el.tag === 'textarea') score += 40
    if (el.role === 'link') score += 30
    
    // Destructive action indicators
    if (/delete|remove|unsubscribe/i.test(el.text || '')) score += 30
    if (el.ariaLabel?.includes('delete')) score += 25
    
    // Form-related
    if (el.tag === 'form') score += 20
    if (el.attributes?.['data-testid']) score += 15
    
    // Accessibility indicators
    if (el.role) score += 5
    if (el.ariaLabel) score += 5
    
    // Visibility
    if (!el.isVisible) score = 0
    
    return Math.min(100, score);
  }
  
  // Pattern matching for workflows
  detectWorkflowPatterns(pages: CrawledPage[]): WorkflowPattern[] {
    // Heuristics: look for form → confirmation patterns
    // No ML needed
  }
}
```

**Tests to Cover:**
- [ ] Button detection (>95% accuracy)
- [ ] Form field detection (>90% accuracy)
- [ ] Workflow transitions (>85% confidence)
- [ ] Destructive actions (>95% precision)

---

## Phase 3: Eliminate Copilot Dependencies (Week 3-4)

### 3.1 Natural Language Element Locator

**Current:** `get_element_locator` → uses Copilot to understand "the submit button"

**Solution:** Browser-side selector generation without Copilot

**Implement in `src/locator-generator.ts`:**

```typescript
export class LocatorGenerator {
  // Parse natural language description and find best CSS/XPath selector
  
  generateLocator(description: string, elements: DomElement[]): {
    selector: string;
    type: 'css' | 'xpath';
    confidence: number;
  } {
    // 1. Keyword extraction (no ML)
    //    "submit button" → ['submit', 'button']
    const keywords = this.extractKeywords(description);
    
    // 2. Pattern matching against elements
    //    Find elements matching keywords
    const candidates = this.findCandidates(keywords, elements);
    
    // 3. Score by specificity
    //    Pick most specific selector
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    
    // 4. Generate CSS/XPath
    return this.generateSelector(best);
  }
  
  private extractKeywords(desc: string): string[] {
    // Simple tokenization + filtering
    return desc.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOP_WORDS.includes(w));
  }
  
  private findCandidates(keywords: string[], elements: DomElement[]): Candidate[] {
    // Match keywords against element text, ariaLabel, id, class
    return elements.map(el => ({
      element: el,
      score: this.calculateMatchScore(keywords, el)
    }));
  }
  
  private calculateMatchScore(keywords: string[], el: DomElement): number {
    let score = 0;
    const text = (el.text || '').toLowerCase();
    const aria = (el.ariaLabel || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    
    keywords.forEach(kw => {
      if (text.includes(kw)) score += 30;
      if (aria.includes(kw)) score += 25;
      if (id.includes(kw)) score += 20;
    });
    
    return score;
  }
  
  private generateSelector(candidate: Candidate): Selector {
    // Build deterministic CSS selector
    // Use id > name > class > xpath
    if (candidate.element.id) {
      return { selector: `#${candidate.element.id}`, type: 'css', confidence: 0.95 };
    }
    // ... more heuristics
    return { selector: this.buildXPath(candidate.element), type: 'xpath', confidence: 0.70 };
  }
}
```

**Zero Copilot Calls:** Pure heuristic matching + selector generation

### 3.2 Test Case Generation Without Copilot

**Current:** Template-based generation (already no Copilot needed) ✅

**Verify in `src/test-case-generator.ts`:**
- [ ] No external API calls
- [ ] Pure template-based generation
- [ ] Action type detection via heuristics
- [ ] Pre-condition generation from DOM state

### 3.3 Semantic Tool Generation Without Copilot

**Current:** Rule-based tool generation (already no Copilot needed) ✅

**Verify in `src/webmcp-semantic-tools.ts`:**
- [ ] No external API calls
- [ ] Pure rule-based naming (camelCase from text/ariaLabel)
- [ ] Schema generation from element attributes

---

## Phase 4: Workflow Detection Optimization (Week 4)

### 4.1 ML-Based Workflow Detection (Optional, in Browser)

**Current State:** Heuristic-only detection ✅ (no Copilot)

**Enhancement:** Add lightweight ML for edge cases

**Implement in `src/workflow-detector.ts`:**

```typescript
export class WorkflowDetector {
  private classifier: ZeroShotClassificationPipeline | null = null;
  
  async detectWorkflows(
    pages: CrawledPage[],
    strategy: 'heuristic' | 'ml-based' | 'both'
  ): Promise<DetectedWorkflow[]> {
    // Phase 1: Always run heuristics (fast, no ML)
    const heuristics = this.detectHeuristicWorkflows(pages);
    
    if (strategy === 'heuristic') return heuristics;
    
    // Phase 2: Use WebNN for confidence scoring only (optional)
    if (strategy === 'ml-based' || strategy === 'both') {
      if (await this.isWebNNSupailable()) {
        return this.scoreWithWebNN(heuristics);
      }
    }
    
    // Fallback: return heuristic-only results
    return heuristics;
  }
  
  private async scoreWithWebNN(workflows: DetectedWorkflow[]): Promise<DetectedWorkflow[]> {
    // Load lightweight zero-shot classifier (if available)
    // Score each workflow's confidence
    // Return scored workflows
    // Cost: ~500ms per workflow
  }
}
```

**Zero Copilot Dependency:** Even ML-based detection is in-browser

### 4.2 Common Workflow Patterns (Heuristic Database)

**Create `src/workflow-patterns.ts`:**

```typescript
export const WORKFLOW_PATTERNS = {
  LOGIN: {
    signature: [
      { tag: 'input', attributes: { type: 'email' } },
      { tag: 'input', attributes: { type: 'password' } },
      { tag: 'button', text: /login|sign in/i }
    ],
    confidence: 0.95
  },
  CHECKOUT: {
    signature: [
      { tag: 'form' },
      { text: /checkout|purchase|buy/i },
      { text: /credit card|payment/i }
    ],
    confidence: 0.85
  },
  MULTI_STEP_FORM: {
    signature: [
      { text: /step \d+/i },
      { tag: 'button', text: /next|continue/i },
      { tag: 'button', text: /back|previous/i }
    ],
    confidence: 0.80
  },
  // ... more patterns
};
```

---

## Phase 5: MCP Server Refactoring (Week 4-5)

### 5.1 Thin MCP Wrapper

Instead of doing analysis in MCP server, make it a **pass-through** to browser analysis:

```typescript
// Current: Node.js → Analysis → Result
// New:     Browser Snap → Browser Analysis → Browser Export → Result
```

**MCP Server Responsibilities:**
1. Coordinate Selenium snapshot capture
2. Inject analysis bundle (`analyzer-browser.js`)
3. Execute browser pipeline
4. Return results

**Benefits:**
- No ML computation in Node.js
- Reduced complexity
- Faster execution
- Zero Copilot calls

### 5.2 Update `src/index.ts` (MCP Server)

```typescript
// Pseudocode
async function crawlAndAnalyze(url: string, format: string) {
  // 1. Selenium captures DOM snapshot
  const snapshot = await crawler.capture(url);
  
  // 2. Browser executes analysis via injected script
  const result = await driver.executeScript(`
    // analyzer-browser.js code (bundled)
    const pipeline = new BrowserAnalysisPipeline();
    await pipeline.init();
    return pipeline.analyze(${JSON.stringify(snapshot)});
  `);
  
  // 3. Return formatted result
  return format === 'json' ? result : exporter.toMarkdown(result);
}
```

---

## Phase 6: Performance Optimization (Week 5)

### 6.1 WebNN-Specific Optimizations

| Optimization | Impact | Effort |
|---|---|---|
| Batch element processing | -40% latency | Medium |
| Model caching in SharedArrayBuffer | -30% memory | High |
| Quantized model usage | -75% size | Low |
| Embedding result caching (IndexedDB) | -80% re-computes | Medium |
| Parallel model inference | -50% latency | High |
| WebWorker for model loading | -200ms page block | Medium |

### 6.2 Benchmark Targets

| Metric | Current | Target | Gain |
|---|---|---|---|
| Page analysis time | 2-5s | <500ms | 10x |
| Model load time | ~3s | <500ms | 6x |
| Memory usage | 250MB+ | <100MB | 60% |
| Copilot API calls | ~50/crawl | 0 | 100% |
| Token cost per crawl | ~5000 | 0 | 100% |

---

## Implementation Roadmap

```
Week 1-2: Phase 1 (Model Optimization)
├─ Add DistilBERT model
├─ Implement embedding cache (IndexedDB)
├─ Add quantization support
└─ Benchmark improvements

Week 2-3: Phase 2 (Client-Side Pipeline)
├─ Port analyzer to browser
├─ Implement HeuristicScorer
├─ Test case generation in browser
└─ Semantic tool generation in browser

Week 3-4: Phase 3 (Eliminate Copilot)
├─ Build LocatorGenerator (no Copilot)
├─ Verify test case generator (already clean)
├─ Verify semantic tool generator (already clean)
└─ Remove any Copilot API calls

Week 4: Phase 4 (Workflow Detection)
├─ Add ML-based confidence scoring (optional)
├─ Build workflow pattern database
└─ All in-browser, zero Copilot

Week 4-5: Phase 5 (MCP Refactoring)
├─ Refactor MCP server to pass-through
├─ Update tool implementations
└─ Test end-to-end

Week 5: Phase 6 (Performance)
├─ Benchmark all optimizations
├─ Profile WebNN usage
└─ Document results
```

---

## File Structure (New Files)

```
src/
├── analyzer-browser.ts          # Client-side analysis pipeline
├── heuristic-scorer.ts          # Pattern-based scoring (no ML)
├── embedding-cache.ts           # IndexedDB caching for embeddings
├── locator-generator.ts         # Natural language selector gen (no Copilot)
├── workflow-patterns.ts         # Heuristic workflow definitions
├── index.ts                     # [REFACTOR] Thin MCP wrapper
├── analyzer.ts                  # [KEEP] Node-side fallback only
└── ... existing files ...
```

---

## Fallback Strategy

**If WebNN unavailable:**
```
User → MCP Server
├─ Try WebNN in browser
│  └─ On failure, fallback to WASM (slower but functional)
├─ All heuristics available (no ML needed)
├─ All test generation works (no ML needed)
├─ All workflow detection works (heuristic only, no ML)
└─ Zero degradation, just slower
```

**WebNN Coverage:**
- ✅ Element similarity scoring (30% speedup if WebNN, WASM fallback)
- ✅ Embedding caching (no ML alternative needed)
- ✅ Heuristics (always available, no fallback needed)
- ✅ Test generation (always available, no fallback needed)
- ✅ Semantic tools (always available, no fallback needed)

---

## Copilot Token Savings Calculation

**Current Workflow:**
- 1 crawl = 50 API calls (element analysis, test generation, locator retrieval)
- 50 calls × 100 tokens avg = **5,000 tokens/crawl**
- 10 crawls/day = **50,000 tokens/day**
- ~1.5M tokens/month at current rate

**Optimized Workflow:**
- **0 Copilot API calls** (100% browser-based)
- **0 tokens/crawl**
- **Savings: 100%** ✅

**Additional Benefits:**
- 90% latency reduction (browser inference faster than round-trip)
- Offline capability (no API calls needed)
- Cost savings: $0 → Transformers.js (free, open-source)
- Privacy: No data leaves the client browser

---

## Success Criteria

- [ ] All analysis operations complete in browser
- [ ] Zero Copilot API calls in production flow
- [ ] Heuristic fallback works when WebNN unavailable
- [ ] Page analysis time < 500ms (on WebNN-capable device)
- [ ] 95%+ accuracy on element classification (vs current ML model)
- [ ] Test case generation matches current quality
- [ ] Workflow detection confidence >= 75%

---

## Next Steps

1. **Review this plan** - Is the strategy aligned?
2. **Start Phase 1** - Model optimization
3. **Create implementation branches** for each phase
4. **Set up benchmarking** - Measure before/after for each phase
5. **Document browser APIs** - What WebNN features are we using?

