# WebNN Implementation Reference Guide

**Date:** March 3, 2026  
**Purpose:** Quick lookup for developers implementing the optimization plan  
**Format:** Checklists, code snippets, and decision trees

---

## Quick Reference: Which Phase Should I Do?

```
Question: How much time do you have?

├─ < 1 week?
│  └─ Do Quick Wins (Phase 1)
│     Result: 80% token reduction, immediate ROI
│
├─ 2-4 weeks?
│  └─ Do Quick Wins + Browser Pipeline (Phases 1-2)
│     Result: 100% token elimination, full browser-side
│
└─ 4+ weeks?
   └─ Do Full Plan (Phases 1-6)
      Result: 100% token elimination + 10x speedup + optimization
```

---

## Phase 1: Quick Wins Checklist (This Week)

### Quick Win #1: IndexedDB Cache (2 hours)

**Checklist:**
- [ ] Create `src/embedding-cache.ts`
- [ ] Implement IDBDatabase initialization
- [ ] Add `getEmbedding()` method
- [ ] Add `setEmbedding()` method
- [ ] Add `clearExpired()` method
- [ ] Update `src/analyzer.ts` to use cache
- [ ] Test: `npm run test:unit`
- [ ] Measure cache hit rate

**Key Code Points:**
```typescript
// In src/analyzer.ts, top of class:
private cache: EmbeddingCache | null = null;

// In init() method:
this.cache = new EmbeddingCache();
await this.cache.init();

// Before computing embedding:
let embedding = await this.cache?.getEmbedding(text);
if (!embedding) {
  embedding = await this.computeEmbedding(text);
  await this.cache?.setEmbedding(text, embedding);
}
```

**Validation:**
```bash
# Check for cache stats in logs
npm run test:unit 2>&1 | grep -i "cache stats"
```

---

### Quick Win #2: WebNN Detection (1 hour)

**Checklist:**
- [ ] Update `src/analyzer.ts` - `isWebNNSupported()` method
- [ ] Add 1-second timeout to WebNN check
- [ ] Log WebNN availability
- [ ] Test on WebNN-capable device
- [ ] Test on WebNN-unavailable device
- [ ] Verify fallback to WASM

**Key Code Points:**
```typescript
private async isWebNNSupported(): Promise<boolean> {
  if (typeof navigator === "undefined" || !('ml' in navigator)) {
    return false;
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    
    const context = await (navigator as any).ml.createContext();
    clearTimeout(timeout);
    await context?.close?.();
    
    console.log('[analyzer] ✓ WebNN available');
    return true;
  } catch (err) {
    console.log('[analyzer] WebNN unavailable');
    return false;
  }
}
```

**Testing:**
```bash
# Test on Chrome/Edge with WebNN
npm run test:unit

# Test on Safari (no WebNN support)
# Verify timeout < 1 second
```

---

### Quick Win #3: Smart Model Selection (30 minutes)

**Checklist:**
- [ ] Add `selectModel()` method to `DomAnalyzer`
- [ ] Check `navigator.deviceMemory`
- [ ] Check `navigator.connection?.effectiveType`
- [ ] Select DistilBERT for low-memory devices
- [ ] Select all-MiniLM for high-memory devices
- [ ] Update model loading to use selected model
- [ ] Test on multiple device types
- [ ] Measure model load time

**Key Code Points:**
```typescript
private async selectModel(): Promise<string> {
  const memory = navigator.deviceMemory || 4; // GB
  const connection = (navigator as any).connection?.effectiveType || '4g';
  
  if (memory < 4 || connection === '3g') {
    return 'Xenova/distilbert-base-multilingual-cased';
  }
  
  if (memory >= 8 && connection === '4g') {
    return 'Xenova/all-MiniLM-L6-v2';
  }
  
  return 'Xenova/distilbert-base-multilingual-cased'; // Safe default
}
```

---

### Quick Win #4: Heuristic Scorer (3 hours)

**Checklist:**
- [ ] Create `src/heuristic-scorer.ts`
- [ ] Implement `scoreElement()` method
- [ ] Implement `scoreElements()` method (batch)
- [ ] Add pattern matching for destructive actions
- [ ] Add pattern matching for form submissions
- [ ] Create fallback in `src/analyzer.ts`
- [ ] Test accuracy against ML scores
- [ ] Measure latency

**Key Code Points:**
```typescript
export class HeuristicScorer {
  scoreElement(element: DomElement): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    
    // Tag scoring
    if (element.tag === 'button') {
      score += 50;
      reasons.push('button tag (+50)');
    }
    
    // Pattern matching
    const text = (element.text || '').toLowerCase();
    if (/delete|remove/i.test(text)) {
      score += 35;
      reasons.push('destructive action (+35)');
    }
    
    // Visibility check
    if (!element.isVisible) {
      score = 0;
      reasons.push('not visible (zeroed)');
    }
    
    return { score: Math.min(100, score), reasons };
  }
}
```

**Fallback in analyzer.ts:**
```typescript
async analyzeElements(elements: DomElement[]): Promise<HighIntentElement[]> {
  try {
    if (this.extractor) {
      return await this.analyzeWithML(elements);
    }
  } catch (err) {
    console.warn('[analyzer] ML failed, using heuristics');
  }
  
  return this.analyzeWithHeuristics(elements);
}

private analyzeWithHeuristics(elements: DomElement[]): HighIntentElement[] {
  const scorer = new HeuristicScorer();
  return elements
    .map(el => {
      const { score, reasons } = scorer.scoreElement(el);
      return { ...el, intentScore: score, reason: reasons.join('; ') };
    })
    .filter(el => el.intentScore >= 25)
    .sort((a, b) => b.intentScore - a.intentScore);
}
```

---

### Quick Win #5: Locator Generator (1 hour)

**Checklist:**
- [ ] Create `src/locator-generator.ts`
- [ ] Implement `generateLocator()` method
- [ ] Implement keyword extraction
- [ ] Implement element matching
- [ ] Implement selector generation
- [ ] Update `src/index.ts` tool handler
- [ ] Test with various element descriptions
- [ ] Remove any Copilot calls

**Key Code Points:**
```typescript
export class LocatorGenerator {
  generateLocator(description: string, elements: DomElement[]): {
    selector: string;
    type: 'css' | 'xpath';
    confidence: number;
    reason: string;
  } {
    // 1. Extract keywords
    const keywords = this.extractKeywords(description);
    
    // 2. Find candidates
    const candidates = this.findMatches(keywords, elements)
      .sort((a, b) => b.score - a.score);
    
    if (candidates.length === 0) {
      return { selector: '*', type: 'css', confidence: 0, reason: 'No match' };
    }
    
    // 3. Generate selector
    return this.generateSelector(candidates[0]);
  }
  
  private extractKeywords(description: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to']);
    return description
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }
}
```

**Update MCP handler in `src/index.ts`:**
```typescript
case 'get_element_locator': {
  const { description } = GetElementLocatorInput.parse(input);
  
  const locGen = new LocatorGenerator();
  const locator = locGen.generateLocator(description, lastAnalysis.elements);
  
  return {
    content: [{
      type: 'text',
      text: `${locator.selector} (${locator.type}, ${(locator.confidence*100).toFixed(0)}%)\n${locator.reason}`
    }]
  };
}
```

---

## Phase 1 Testing Checklist

After implementing all 5 quick wins:

```
Functionality Tests:
├─ [ ] Element analysis still works
├─ [ ] Test cases still generate correctly
├─ [ ] Semantic tools still generate correctly
├─ [ ] Workflow detection still works
├─ [ ] Locator generation returns valid selectors
├─ [ ] Heuristic fallback works (disable WebNN)
└─ [ ] Cache hit rate > 50% on multi-page crawls

Performance Tests:
├─ [ ] WebNN check completes in < 1 second
├─ [ ] Model load uses cached version (< 500ms)
├─ [ ] Device-aware model selection is correct
├─ [ ] Heuristic scoring < 50ms
├─ [ ] Cache reduce embeddings by 70%+
└─ [ ] Overall latency down to 1-2 seconds

Integration Tests:
├─ [ ] npm run test passes
├─ [ ] npm run test:unit passes
├─ [ ] Manual crawl: npm run start
├─ [ ] MCP tool calls work
└─ [ ] No new errors in console
```

**Run All Tests:**
```bash
npm run build
npm run test
npm run test:unit
node test/test-bstackdemo.js
node test/test-internet-crawl.js
```

---

## Phase 2: Browser Pipeline Overview

**When Ready (Week 2-3):**

1. Create `src/analyzer-browser.ts`
   - Port `DomAnalyzer` from Node.js
   - Include WebNN initialization
   - Include heuristic fallback
   
2. Create `src/browser-pipeline.ts`
   - Orchestrates all browser analysis
   - Test case generation
   - Semantic tool generation
   - Locator generation
   - Result export

3. Update `src/index.ts`
   - Inject browser bundle into Selenium
   - Call browser pipeline
   - Format and return results

4. Build browser bundle:
   ```bash
   npm run build:browser
   ```

---

## Debugging Guide

### WebNN Not Detected?

```bash
# Check browser support
# Run in DevTools console:
console.log(typeof navigator.ml); // Should be "object"

# Check in analyzer logs
npm run test:unit 2>&1 | grep "WebNN"

# Force WASM fallback
# In analyzer.ts, temporarily:
this.webnnAvailable = false; // Force disable
```

### Cache Not Working?

```bash
# Check IndexedDB in DevTools
# Application → IndexedDB → webmcp_embeddings

# Check cache stats
npm run test:unit 2>&1 | grep "Cache stats"

# Should show: { hits: X, misses: Y, hitRate: "Z%" }
```

### Heuristic Accuracy Low?

```bash
# Check scoring results
// In analyzer.ts, add logging:
const { score, reasons } = scorer.scoreElement(el);
console.log(`[scorer] ${el.text}: ${score} - ${reasons.join(', ')}`);

# Adjust score thresholds
// In heuristic-scorer.ts:
// Increase destructivePatterns score
// Decrease generic element score
```

### Locator Generator Missing Elements?

```bash
# Check keyword extraction
// In locator-generator.ts, add logging:
const keywords = this.extractKeywords(description);
console.log('[locator] Keywords:', keywords);

# Check element matching
const matches = this.findMatches(keywords, elements);
console.log('[locator] Matches:', matches);

# Adjust scoring weights
// In calculateScore():
// Increase aria-label weight: +40 → +50
// Decrease id weight: -30 → +20
```

---

## Decision Trees for Development

### Should I Use WebNN or Heuristics?

```
Can you detect the specific element pattern accurately?
├─ Yes → Use Heuristics (faster, always works)
└─ No → Use WebNN (more accurate, requires model)

Is the model available and loaded?
├─ Yes → Use WebNN
└─ No → Fall back to Heuristics

Does the element have:
├─ ID? → Use CSS selector (#id)
├─ aria-label? → Use XPath selector
├─ Text content? → Use contains() XPath
└─ None? → Use tag + class selector
```

### Should I Cache This?

```
Is this computation expensive (> 10ms)?
├─ Yes → Cache it
└─ No → Skip caching

Will I compute the same value multiple times?
├─ Yes → Cache it
└─ No → Skip caching

Example: Embeddings = Yes, always cache
Example: Button detection = No, too fast
```

### Should This Run in Browser or Node?

```
Does this require Selenium/headless browser?
├─ Yes → Must be in Node.js
└─ No → Can be in browser

Does this require external API?
├─ Yes → Must be in Node.js (CORS issues)
└─ No → Can be in browser

Can the user run this offline?
├─ Yes → Must be in browser
└─ No → Can be in Node.js

Answer Yes to any?
└─ Probably stays in Node.js

Answer No to all?
└─ Move to browser (Phase 2)
```

---

## File Organization Summary

### Current Structure
```
src/
├── index.ts (MCP server)
├── analyzer.ts (ML-based)
├── crawler.ts (Selenium)
├── test-case-generator.ts
├── webmcp-semantic-tools.ts
├── workflow-detector.ts
├── multi-page-crawler.ts
└── ... other files
```

### After Phase 1 (Quick Wins)
```
src/
├── index.ts (MCP server) [UPDATED]
├── analyzer.ts [UPDATED with cache + detection]
├── crawler.ts
├── heuristic-scorer.ts [NEW]
├── embedding-cache.ts [NEW]
├── locator-generator.ts [NEW]
├── test-case-generator.ts
├── webmcp-semantic-tools.ts
├── workflow-detector.ts
├── multi-page-crawler.ts
└── ... other files
```

### After Phase 2 (Browser Pipeline)
```
src/
├── index.ts [THINNED - pass-through only]
├── analyzer.ts [NODE-ONLY FALLBACK]
├── analyzer-browser.ts [NEW - full pipeline]
├── browser-pipeline.ts [NEW - orchestration]
├── crawler.ts [UNCHANGED]
├── heuristic-scorer.ts
├── embedding-cache.ts [MOVED to browser]
├── locator-generator.ts [MOVED to browser]
├── test-case-generator.ts [MOVED to browser]
├── webmcp-semantic-tools.ts [MOVED/DUPLICATED]
├── workflow-detector.ts
├── multi-page-crawler.ts
└── ... other files
```

---

## Success Criteria by Phase

### Phase 1 Success
```
Measurable Results:
✅ Embedding cache hit rate > 70%
✅ WebNN detection completes in < 1 second
✅ Model load time < 500ms (first use)
✅ Heuristic scorer accuracy > 85%
✅ get_element_locator has 0 Copilot calls
✅ Overall analysis time < 2 seconds
✅ All tests pass: npm test
```

### Phase 2 Success
```
Measurable Results:
✅ 100% of analysis happens in browser
✅ 0% of Copilot tokens used
✅ Analysis time < 1 second (with WebNN)
✅ Analysis time < 500ms (with heuristics)
✅ MCP server does only coordination
✅ Works offline (no external API calls)
✅ All tests pass
```

### Phase 3 Success
```
Measurable Results:
✅ Page analysis time < 500ms (WebNN)
✅ Page analysis time < 100ms (heuristics)
✅ Model load time < 200ms (cached)
✅ Memory usage < 100MB (peak)
✅ WebNN adoption > 80% (on capable devices)
✅ Zero Copilot dependencies
✅ All benchmarks documented
```

---

## Contact & Support

If you get stuck on any phase:

1. **Refer to:** WEBNN_OPTIMIZATION_PLAN.md (detailed implementation)
2. **Check:** ARCHITECTURE_WEBNN_COMPARISON.md (visual reference)
3. **Review:** Code snippets in this document
4. **Debug:** Using the Debugging Guide section above

**Each quick win is independent** - you can complete them in any order and revert any without affecting others.

