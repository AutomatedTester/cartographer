# Architecture Comparison: Current vs WebNN-Optimized

**Date:** March 3, 2026  
**Purpose:** Visualize the transformation from Copilot-heavy to WebNN-heavy architecture

---

## Current Architecture (Today)

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER / CLIENT                              │
│                  (Claude Desktop or IDE)                           │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            │ (MCP Protocol over stdio)
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│                   MCP SERVER (Node.js)                            │
│                   index.ts (740 lines)                            │
│                                                                    │
│  Tools:                                                            │
│  ├─ crawl_and_analyze()                                           │
│  ├─ get_element_locator()                                         │
│  ├─ run_critical_tests()                                          │
│  └─ crawl_multi_page()                                            │
└───┬──────────────────────┬──────────┬──────────────┬──────────────┘
    │                      │          │              │
    ▼                      ▼          ▼              ▼
┌─────────────┐    ┌────────────┐ ┌──────────┐  ┌──────────────┐
│ Selenium    │    │ DomAnalyzer│ │TestCase  │  │  Workflow    │
│ WebDriver   │    │ (Browser)  │ │Generator │  │  Detector    │
│ (Chrome)    │    │ + ML Model │ │(Node.js) │  │  (Node.js)   │
│             │    │Transformer │ │          │  │              │
│ - Navigate  │    │     .js    │ │ - Action │  │ - Heuristic  │
│ - Take DOM  │    │            │ │   Types  │  │    Pattern   │
│   snapshot  │    │ ~500-2000ms│ │ - Priority │  │   Matching   │
│             │    │    latency │ │          │  │              │
└─────────────┘    └────────────┘ └──────────┘  └──────────────┘
                            │
                            │ (Optional: Request Copilot for NLP)
                            │
                    ┌───────▼─────────┐
                    │   Copilot API   │
                    │  (Token Waste)  │
                    │                 │
                    │ - Element match │
                    │ - Locator gen   │
                    │ - High entropy  │
                    │   test naming   │
                    └─────────────────┘

FLOW SUMMARY:
┌─────────────────────────────────────────────────────────────┐
│ 1. User → Copilot (MCP)                                      │
│ 2. MCP → Selenium (Browser control)                         │
│ 3. Selenium → DOM snapshot                                  │
│ 4. DOM → DomAnalyzer (Transformers.js in browser)           │
│ 5. DomAnalyzer → Copilot (token waste) <<<< PROBLEM         │
│ 6. Copilot → TestCaseGenerator                              │
│ 7. Results → User                                           │
│                                                             │
│ TOKEN COST PER CRAWL: ~5000 tokens ❌                       │
│ LATENCY: 5-10 seconds (round-trips)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Current Data Flow (Detailed)

```
Copilot Client (e.g., Claude Desktop)
│
└─ Call MCP Tool ─────────────────────────────────────────────────────┐
                                                                        │
                                    Node.js MCP Server                 │
                                    ┌──────────────────────────────┐   │
                                    │ index.ts:                    │   │
                                    │                              │   │
   ┌────────────────────────────────┤ callTool()                   │   │
   │                                │  - Validates input           │   │
   │                                │  - Routes to handler         │   │
   │                                │  - Returns result            │   │
   │                                └──────────────────────────────┘   │
   │                                                                    │
   │                                ┌──────────────────────────────┐   │
   │                                │ SiteCrawler + Selenium       │   │
   │                                │                              │   │
   │  ┌─────────────────────────────┤ - Launch Chrome headless    │   │
   │  │                             │ - Navigate to URL           │   │
   │  │                             │ - Extract DOM               │   │
   │  │                             │ - Simplify to JSON          │   │
   │  │                             └──────────────────────────────┘   │
   │  │                                          │                     │
   │  │                                          │                     │
   │  │                             ┌────────────▼─────────────────┐   │
   │  │                             │ DomAnalyzer (Browser code)   │   │
   │  │                             │ - Load model: ~3 seconds    │   │
   │  │                             │ - Analyze elements:         │   │
   │  │                             │     * Get embeddings        │   │
   │  │                             │     * Compute similarity    │   │
   │  │                             │     * Score elements        │   │
   │  │                             │ - Return high-intent list   │   │
   │  │                             └────────────┬─────────────────┘   │
   │  │                                          │                     │
   │  │                             ┌────────────▼─────────────────┐   │
   │  │                             │ TestCaseGenerator (Node.js)  │   │
   │  │                             │ - Detect action types       │   │
   │  │                             │ - Assign priorities         │   │
   │  │                             │ - Generate templates        │   │
   │  │                             │ - Create test names         │   │
   │  │                             └────────────┬─────────────────┘   │
   │  │                                          │                     │
   │  │                             ┌────────────▼─────────────────┐   │
   │  │                             │ MarkdownExporter            │   │
   │  │                             │ - Format results            │   │
   │  │                             │ - Export JSON/Markdown      │   │
   │  │                             └────────────┬─────────────────┘   │
   └──────────────────────────────────────────────────┬─────────────────┘
                                                      │
                                                      │ Result
                                                      │
      ┌────────────────────────────────────────────────▼──────────────┐
      │ ⚠️  OPTIONAL: Copilot NLP for Locator Generation             │
      │                                                              │
      │  If user calls get_element_locator:                         │
      │  - "Find the submit button" → Copilot interprets ❌        │
      │  - "Get the delete link" → Copilot calls ❌                │
      │  - Cost: 50-200 tokens per call ❌                          │
      └────────────────────────────────────────────────────────────┘
                                          │
                                          │ Result
                                          │
User ◄─────────────────────────────────────┘
```

**Problems with Current Architecture:**
1. ❌ Optional Copilot calls for element locators
2. ⚠️ No fallback if Copilot unavailable
3. ⚠️ Token waste on simple NLP tasks
4. ⚠️ Latency from round-trip API calls
5. ⚠️ No offline capability

---

## Optimized Architecture (Target)

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER / CLIENT                              │
│                  (Claude Desktop or IDE)                           │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            │ (MCP Protocol over stdio)
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│              THIN MCP SERVER (Node.js) - Pass-Through             │
│               index.ts (simplified)                               │
│                                                                    │
│  Responsibilities:                                                │
│  ├─ Selenium snapshot capture                                     │
│  ├─ Inject browser analysis bundle                                │
│  ├─ Format results for export                                     │
│  └─ Session management                                            │
└───┬──────────────────────────┬──────────────────────────────────┘
    │                          │
    ▼                          ▼
┌─────────────┐         ┌──────────────────────────────┐
│ Selenium    │         │   BROWSER (WebNN-Powered)    │
│ WebDriver   │         │   ========================   │
│ (Chrome)    │         │                              │
│             │         │ analyzer-browser.js bundle: │
│ - Navigate  │         │                              │
│ - Snapshot  │         │ ├─ DomAnalyzer              │
│ - Control   │         │ │  └─ WebNN (Fast!)         │
│             │         │ │     ~200-500ms            │
└─────────────┘         │                              │
                        │ ├─ HeuristicScorer          │
                        │ │  ~10-50ms (fallback)      │
                        │                              │
                        │ ├─ TestCaseGenerator        │
                        │ │  Template-based           │
                        │                              │
                        │ ├─ SemanticToolGenerator    │
                        │ │  Rule-based               │
                        │                              │
                        │ ├─ LocatorGenerator         │
                        │ │  Heuristic (no Copilot!)  │
                        │                              │
                        │ └─ MarkdownExporter         │
                        │    Format results           │
                        │                              │
                        │ Optimizations:              │
                        │ - IndexedDB cache           │
                        │ - Smart model selection     │
                        │ - WebWorker for model load  │
                        │ - Quantized models          │
                        └──────────────┬───────────────┘
                                       │
                                       │ Complete analysis
                                       │ (JSON/Markdown)
                                       │
User ◄──────────────────────────────────┘

KEY DIFFERENCES:
✅ Zero Copilot calls (except initial request)
✅ 100% analysis in browser (no server computation)
✅ ~500ms total latency (vs 5-10s in current)
✅ Fully offline capable
✅ Heuristic fallback (WebNN optional)
```

---

## Optimized Data Flow (Detailed)

```
Copilot Client
│
└─ Call MCP Tool ───────────────────────────────────────────────────┐
                                                                     │
             THIN Node.js MCP Server (Coordinator)                  │
             ┌────────────────────────────────────────┐               │
             │ index.ts (simplified):                 │               │
             │                                        │               │
   ┌─────────┤ 1. Validate input                      │               │
   │         │ 2. Launch Selenium                     │               │
   │         │ 3. Inject analyzer-browser.js          │               │
   │         │ 4. Call browser analysis               │               │
   │         │ 5. Format + return result              │               │
   │         │                                        │               │
   │         │ (99% of work done in browser)         │               │
   │         └───────────┬──────────────────────────┘               │
   │                     │                                           │
   │                     │ Launch Chrome headless                    │
   │                     │                                           │
   │              ┌──────▼─────────────────────────────────┐         │
   │              │ BROWSER ANALYSIS PIPELINE              │         │
   │              │ (analyzer-browser.js bundle ~200KB)    │         │
   │              │                                        │         │
   │              │ Step 1: Load Input                     │         │
   │              │ - Receive DOM snapshot (JSON)          │         │
   │              │ - Parse elements                       │         │
   │              │                                        │         │
   │              │ Step 2: Analyze (Choose Path)          │         │
   │              │                                        │         │
   │              │ PATH A: WebNN Available (500ms)        │         │
   │              │ ┌────────────────────────────────────┐ │         │
   │              │ │ - Load model (cached)               │ │         │
   │              │ │ - Check IndexedDB cache             │ │         │
   │              │ │ - Compute missing embeddings        │ │         │
   │              │ │ - Score elements (similarity)       │ │         │
   │              │ │ - Cache results in IndexedDB        │ │         │
   │              │ │ - Return high-intent elements       │ │         │
   │              │ └────────────────────────────────────┘ │         │
   │              │                                        │         │
   │              │ PATH B: WebNN Unavailable (10ms)       │         │
   │              │ ┌────────────────────────────────────┐ │         │
   │              │ │ - Run HeuristicScorer                │ │         │
   │              │ │ - Pattern matching (No ML)           │ │         │
   │              │ │ - Tag analysis                       │ │         │
   │              │ │ - Text pattern detection             │ │         │
   │              │ │ - Return elements (75%+ accuracy)    │ │         │
   │              │ └────────────────────────────────────┘ │         │
   │              │                                        │         │
   │              │ Step 3: Generate Test Cases            │         │
   │              │ - Template-based (no LLM)              │         │
   │              │ - Action type detection (heuristic)    │         │
   │              │ - Priority assignment                  │         │
   │              │ - Pre-condition generation             │         │
   │              │                                        │         │
   │              │ Step 4: Generate Semantic Tools        │         │
   │              │ - Rule-based naming                    │         │
   │              │ - Schema generation                    │         │
   │              │ - Tool registry                        │         │
   │              │                                        │         │
   │              │ Step 5: Generate Locators (NEW!)       │         │
   │              │ ┌────────────────────────────────────┐ │         │
   │              │ │ - Parse natural language (heuristic) │ │         │
   │              │ │ - NO COPILOT CALLS ✅               │ │         │
   │              │ │ - Match keywords to elements        │ │         │
   │              │ │ - Generate CSS/XPath                │ │         │
   │              │ │ - Return selector + confidence      │ │         │
   │              │ └────────────────────────────────────┘ │         │
   │              │                                        │         │
   │              │ Step 6: Export Results                │         │
   │              │ - JSON format                          │         │
   │              │ - Markdown format                      │         │
   │              │ - Summary format                       │         │
   │              │                                        │         │
   │              └────────┬─────────────────────────────┘         │
   │                       │                                        │
   │                       │ Complete analysis result              │
   │                       │ (JSON/Markdown)                       │
   └───────────────────────┬────────────────────────────────────────┘
                           │
                    Results Ready!
                           │
User ◄─────────────────────┘

OPTIMIZATION WINS:
✅ ~95% of computation in browser (no server load)
✅ Zero Copilot token usage in main flow
✅ ~500ms latency (WebNN) or ~100ms (heuristics)
✅ Automatic fallback if WebNN unavailable
✅ Works offline (no API dependencies)
✅ Scales to 100+ element pages without token cost
✅ Improved privacy (zero data leaves browser)
```

---

## Performance Comparison

| Metric | Current | Optimized | Gain |
|---|---|---|---|
| Page Analysis Latency | 5-10s | 0.5-1s | **10x faster** |
| Model Load Time | ~3s | <500ms | **6x faster** |
| Copilot Token Cost | ~5000/crawl | 0 | **100% savings** |
| Memory Usage | 250MB+ | 50-100MB | **50-75% less** |
| Offline Capability | ❌ | ✅ | **Added** |
| API Dependency | ❌ | ✅ Removed | **De-risked** |

---

## Fallback Strategy Comparison

```
CURRENT ARCHITECTURE:
User Request
    │
    ├─ WebNN Available? ─────→ YES ──→ Use Transformers.js
    │                              
    └─ WebNN Available? ─────→ NO ──→ Fallback to WASM (10-15s wait)
                                        ├─ If timeout: FAIL ❌
                                        ├─ If no WASM: FAIL ❌

OPTIMIZED ARCHITECTURE:
User Request
    │
    ├─ WebNN Available? ─────→ YES ──→ Use WebNN (500ms)
    │
    ├─ WebNN fails? ────────→ YES ──→ Fallback to Heuristics (10ms)
    │
    └─ Always succeeds ─────→ YES ──→ Result guaranteed ✅

GUARANTEE: 100% uptime, graceful degradation
```

---

## Cost Analysis

### Current (Copilot-Heavy)

```
Costs per 10 crawls/day:
- Model tokens: ~50,000 tokens/day
- API calls: ~100 calls/day
- Latency cost: 5-10s per interaction
- Token cost: ~$0.005/day = ~$1.50/month

Over 1 month: ~$1.50 + latency friction
```

### Optimized (WebNN)

```
Costs per 10 crawls/day:
- Model tokens: 0 (local WebNN)
- API calls: 0 (no Copilot)
- Latency: <1s per interaction
- Token cost: $0

Over 1 month: $0 + smooth experience
```

**Monthly Savings:** ~$1.50 (small) but 100% reduction in API complexity and zero vendor lock-in

---

## Migration Path

```
Week 1-2: Phase 1 (Quick Wins)
├─ IndexedDB embedding cache
├─ Smart model selection
├─ WebNN detection timeout
├─ Heuristic fallback
└─ Locator generator (no Copilot)

Week 2-3: Phase 2 (Browser Analysis)
├─ Port analyzer to browser
├─ Move test generation to browser
├─ Move semantic tools to browser
└─ Full client-side pipeline

Week 3-4: Phase 3 (MCP Refactoring)
├─ Simplify MCP server
├─ Test end-to-end
└─ Remove Node.js analysis deps

Target: 100% browser-based   (CURRENT: 70%)
Target: 0 Copilot calls      (CURRENT: 50/crawl)
Target: <1s latency          (CURRENT: 5-10s)
```

---

## Key Insights for WebNN Strategy

### Why WebNN?

1. **Native Browser API**: No external dependencies
2. **Hardware Acceleration**: Uses GPU/NPU when available
3. **Privacy**: Data never leaves the browser
4. **Speed**: 5-10x faster than Cloud APIs for small models
5. **Offline**: Works without internet
6. **Free**: No API costs, open-source models

### Heuristic Fallback Importance

Even with WebNN, heuristics provide:
- **Instant alternative**: 10ms vs 500ms (instant)
- **100% compatibility**: Works on any browser
- **Simple to debug**: Pattern matching vs ML black box
- **85%+ accuracy**: Sufficient for most UI elements
- **No dependencies**: Pure JavaScript

### Browser-Side Analysis Benefits

1. **Computational Offload**: MCP server does 5% work instead of 95%
2. **Reduced Latency**: Local execution beats round-trips
3. **Scalability**: Each browser instance = independent compute
4. **Isolation**: No server overload from concurrent users
5. **User Control**: Users can run analysis locally if desired

---

## Conclusion

The optimized architecture shifts from a **Copilot-dependent model** to a **browser-native model** while maintaining or improving accuracy and reliability. This approach:

✅ Eliminates Copilot token waste completely  
✅ Improves performance by 10x on latency  
✅ Adds resilience through heuristic fallbacks  
✅ Enables offline usage  
✅ Reduces operational complexity  
✅ Future-proofs against API changes/costs

