import {
    CrawlSession,
    DetectedWorkflow,
    WorkflowAction,
    StateTransition,
    CrawledPage,
    WorkflowDetectionCache,
} from './types.js';

/**
 * WorkflowDetector analyzes crawled pages to identify user workflows.
 * Uses heuristics and ML to detect common patterns like signup, checkout, etc.
 */
export class WorkflowDetector {
    /** Cache for workflow detection results */
    private static detectionCache = new Map<string, WorkflowDetectionCache>();

    /** Default cache TTL in milliseconds (1 hour) */
    private static readonly DEFAULT_CACHE_TTL = 60 * 60 * 1000;

    /**
     * Detect workflows from a crawl session
     */
    static detect(
        session: CrawlSession,
        strategy: 'heuristic' | 'ml-based' | 'both' = 'both',
        enableCache = true
    ): DetectedWorkflow[] {
        // Generate cache key from session pages
        const cacheKey = this.generateCacheKey(session);

        // Check cache if enabled
        if (enableCache) {
            const cached = this.detectionCache.get(cacheKey);
            if (cached && !this.isCacheExpired(cached)) {
                console.error('[workflow-detector] Cache hit for workflow detection');
                return cached.workflows;
            } else if (cached) {
                console.error('[workflow-detector] Cache expired, recomputing');
                this.detectionCache.delete(cacheKey);
            }
        }

        // Perform detection
        const workflows: DetectedWorkflow[] = [];

        if (strategy === 'heuristic' || strategy === 'both') {
            workflows.push(...this.detectHeuristicWorkflows(session));
        }

        if (strategy === 'ml-based' || strategy === 'both') {
            // TODO: Implement ML-based detection in Phase 4
            // workflows.push(...this.detectMLBasedWorkflows(session));
        }

        // Deduplicate and rank by confidence
        const deduped = this.deduplicateWorkflows(workflows);

        // Store in cache if enabled
        if (enableCache) {
            const cacheEntry: WorkflowDetectionCache = {
                sequenceHash: cacheKey,
                workflows: deduped,
                timestamp: Date.now(),
                ttl: this.DEFAULT_CACHE_TTL,
            };
            this.detectionCache.set(cacheKey, cacheEntry);
        }

        return deduped;
    }

    /**
     * Generate a hash key from the session page sequence
     */
    private static generateCacheKey(session: CrawlSession): string {
        const urls = session.pages.map((p) => p.url).join('|');
        // Simple hash function - in production use crypto
        let hash = 0;
        for (let i = 0; i < urls.length; i++) {
            const char = urls.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `cache_${Math.abs(hash).toString(16)}`;
    }

    /**
     * Check if cache entry has expired
     */
    private static isCacheExpired(cache: WorkflowDetectionCache): boolean {
        const ttl = cache.ttl ?? this.DEFAULT_CACHE_TTL;
        return Date.now() - cache.timestamp > ttl;
    }

    /**
     * Clear the detection cache
     */
    static clearCache(): void {
        this.detectionCache.clear();
        console.error('[workflow-detector] Cache cleared');
    }

    /**
     * Get cache statistics
     */
    static getCacheStats(): { size: number; entries: string[] } {
        return {
            size: this.detectionCache.size,
            entries: Array.from(this.detectionCache.keys()),
        };
    }

    /**
     * Heuristic-based workflow detection
     */
    private static detectHeuristicWorkflows(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        workflows.push(...this.detectFormSubmissionFlows(session));
        workflows.push(...this.detectAuthFlows(session));
        workflows.push(...this.detectNavigationPatterns(session));
        workflows.push(...this.detectMultiStepForms(session));

        return workflows;
    }

    /**
     * Detect form submission workflows: form page → success page
     */
    private static detectFormSubmissionFlows(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        for (let i = 0; i < session.pages.length - 1; i++) {
            const currentPage = session.pages[i];
            const nextPage = session.pages[i + 1];

            // Check if current page has forms
            const hasForm = currentPage.highIntentElements.some(
                (el) => el.tag === 'form' || el.attributes?.role === 'form'
            );
            if (!hasForm) continue;

            // Check if current page has submit button
            const submitBtn = currentPage.highIntentElements.find(
                (el) =>
                    (el.tag === 'button' && el.attributes?.type === 'submit')
            );
            if (!submitBtn) continue;

            // Check if next page is significantly different (likely success page)
            const nextPageContent = nextPage.title + (nextPage.highIntentElements[0]?.text || '');
            const successKeywords = [
                'success',
                'thank',
                'confirm',
                'welcome',
                'dashboard',
                'complete',
            ];
            const isSuccessPage = successKeywords.some((kw) =>
                nextPageContent.toLowerCase().includes(kw)
            );

            if (
                isSuccessPage ||
                nextPage.url.includes('success') ||
                nextPage.url.includes('confirm')
            ) {
                workflows.push({
                    id: `wf_form_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: 'form_submission_flow',
                    pageSequence: [currentPage.url, nextPage.url],
                    actionSequence: this.buildActionSequence([currentPage, nextPage]),
                    stateTransitions: this.buildStateTransitions([currentPage, nextPage]),
                    confidence: isSuccessPage ? 85 : 65,
                    tags: ['form', 'submission', 'conversion'],
                });
            }
        }

        return workflows;
    }

    /**
     * Detect authentication workflows: login/signup → dashboard
     */
    private static detectAuthFlows(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        for (let i = 0; i < session.pages.length - 1; i++) {
            const page = session.pages[i];

            // Check for auth page indicators
            const isAuthPage =
                page.url.includes('/login') ||
                page.url.includes('/signin') ||
                page.url.includes('/signup') ||
                page.url.includes('/register') ||
                page.highIntentElements.some((el) => {
                    const text = (el.text || el.ariaLabel || '').toLowerCase();
                    return (
                        (text.includes('login') || text.includes('sign in')) &&
                        page.highIntentElements.some(
                            (e) => e.tag === 'input' && e.attributes?.type === 'password'
                        )
                    );
                });

            if (!isAuthPage) continue;

            // Find next page(s) and check for dashboard/profile indicators
            const nextPages = session.pages.slice(i + 1, i + 3);
            for (const nextPage of nextPages) {
                const isDashboard =
                    nextPage.url.includes('/dashboard') ||
                    nextPage.url.includes('/home') ||
                    nextPage.url.includes('/profile') ||
                    nextPage.title.toLowerCase().includes('welcome') ||
                    nextPage.title.toLowerCase().includes('dashboard');

                if (isDashboard) {
                    const isSignup =
                        page.url.includes('/signup') || page.url.includes('/register');
                    workflows.push({
                        id: `wf_auth_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        name: isSignup ? 'signup_flow' : 'login_flow',
                        pageSequence: [page.url, nextPage.url],
                        actionSequence: this.buildActionSequence([page, nextPage]),
                        stateTransitions: this.buildStateTransitions([page, nextPage]),
                        confidence: 80,
                        tags: ['authentication', isSignup ? 'signup' : 'login'],
                    });
                    break; // Only one workflow per auth page
                }
            }
        }

        return workflows;
    }

    /**
     * Detect navigation patterns
     */
    private static detectNavigationPatterns(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        // Look for consistent navigation through pages
        // Example: Home → Category → Product → Checkout
        for (let i = 0; i < session.pages.length - 2; i++) {
            const pageA = session.pages[i];
            const pageB = session.pages[i + 1];
            const pageC = session.pages[i + 2];

            // Check if all pages have high-intent navigation elements
            const aHasNav = pageA.highIntentElements.some((el) => el.navigates && el.intentScore > 50);
            const bHasNav = pageB.highIntentElements.some((el) => el.navigates && el.intentScore > 50);
            const cHasNav = pageC.highIntentElements.some((el) => el.navigates && el.intentScore > 50);

            if (!aHasNav || !bHasNav || !cHasNav) continue;

            // Check if pages are structurally similar (same site)
            const aUrl = new URL(pageA.url);
            const bUrl = new URL(pageB.url);
            const cUrl = new URL(pageC.url);

            if (aUrl.hostname !== bUrl.hostname || bUrl.hostname !== cUrl.hostname) continue;

            // Detect common navigation patterns
            const isProductFlow =
                (aUrl.pathname.includes('categor') || aUrl.pathname === '/') &&
                bUrl.pathname.includes('product') &&
                cUrl.pathname.includes('product');

            const isBrowsingFlow =
                aUrl.pathname.includes('search') &&
                bUrl.pathname.includes('search') &&
                (cUrl.pathname.includes('product') || cUrl.pathname.includes('detail'));

            if (isProductFlow || isBrowsingFlow) {
                workflows.push({
                    id: `wf_nav_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: isProductFlow ? 'product_browsing_flow' : 'search_browsing_flow',
                    pageSequence: [pageA.url, pageB.url, pageC.url],
                    actionSequence: this.buildActionSequence([pageA, pageB, pageC]),
                    stateTransitions: this.buildStateTransitions([pageA, pageB, pageC]),
                    confidence: 65,
                    tags: ['navigation', 'browsing'],
                });
            }
        }

        return workflows;
    }

    /**
     * Detect multi-step form sequences
     */
    private static detectMultiStepForms(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        // Look for sequences of form pages that lead to success
        // Example: Personal Info → Address → Payment → Confirmation
        for (let i = 0; i < session.pages.length - 2; i++) {
            const page1 = session.pages[i];
            const page2 = session.pages[i + 1];
            const page3 = session.pages[i + 2];

            // Check if first page has form/input elements
            const hasInputs1 = page1.highIntentElements.some(
                (el) =>
                    el.tag === 'input' ||
                    el.tag === 'textarea' ||
                    el.tag === 'select'
            );
            if (!hasInputs1) continue;

            // Check if second page also has inputs or buttons
            const hasInputs2 = page2.highIntentElements.some(
                (el) =>
                    el.tag === 'input' ||
                    el.tag === 'button' ||
                    el.tag === 'textarea'
            );
            if (!hasInputs2) continue;

            // Check if third page shows success/confirmation
            const successIndicators = [
                'success',
                'thank',
                'confirm',
                'complete',
                'order',
                'receipt',
                'submitted',
            ];
            const page3Content = (page3.title + ' ' + page3.highIntentElements.map(el => el.text).join(' ')).toLowerCase();
            const isSuccess = successIndicators.some((ind) => page3Content.includes(ind));

            if (isSuccess) {
                // Determine form type from page titles
                const formType = this.inferFormType([page1, page2, page3]);

                workflows.push({
                    id: `wf_form_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: `${formType}_flow`,
                    pageSequence: [page1.url, page2.url, page3.url],
                    actionSequence: this.buildActionSequence([page1, page2, page3]),
                    stateTransitions: this.buildStateTransitions([page1, page2, page3]),
                    confidence: 78,
                    tags: ['multi-step', 'form', formType],
                });
            }
        }

        return workflows;
    }

    /**
     * Infer form type from page sequence
     */
    private static inferFormType(pages: CrawledPage[]): string {
        const content = pages.map(p => (p.title + ' ' + p.highIntentElements.map(el => el.text).join(' ')).toLowerCase()).join(' ');

        if (content.includes('checkout') || content.includes('shipping') || content.includes('payment')) {
            return 'checkout';
        }
        if (content.includes('register') || content.includes('signup') || content.includes('account')) {
            return 'registration';
        }
        if (content.includes('profile') || content.includes('preferences') || content.includes('settings')) {
            return 'profile_setup';
        }
        if (content.includes('survey') || content.includes('questionnaire')) {
            return 'survey';
        }

        return 'multi_step_form';
    }

    /**
     * Build action sequence for a workflow
     */
    private static buildActionSequence(pages: CrawledPage[]): WorkflowAction[] {
        const actions: WorkflowAction[] = [];

        for (const page of pages) {
            // Find high-intent elements (likely user actions)
            const actionElements = page.highIntentElements.filter((el) => el.intentScore > 60);

            for (const el of actionElements) {
                actions.push({
                    pageUrl: page.url,
                    elementLocator: el.locator,
                    actionType: el.tag === 'input' ? 'input' : 'click',
                    actionData: undefined, // Default, can be updated from sessionState
                    resultingNavigation: el.navigationTarget,
                    timestamp: page.timestamp,
                });
            }
        }

        return actions;
    }

    /**
     * Build state transitions for a workflow
     */
    private static buildStateTransitions(pages: CrawledPage[]): StateTransition[] {
        const transitions: StateTransition[] = [];

        for (let i = 0; i < pages.length - 1; i++) {
            transitions.push({
                fromPage: pages[i].url,
                toPage: pages[i + 1].url,
                action: {
                    pageUrl: pages[i].url,
                    elementLocator: '',
                    actionType: 'navigate',
                    timestamp: pages[i].timestamp,
                },
                stateChanges: {}, // Can be populated from sessionState
            });
        }

        return transitions;
    }

    /**
     * Remove duplicate workflows, keep highest confidence
     */
    private static deduplicateWorkflows(workflows: DetectedWorkflow[]): DetectedWorkflow[] {
        const seen = new Map<string, DetectedWorkflow>();

        for (const workflow of workflows) {
            const key = workflow.name + JSON.stringify(workflow.pageSequence);
            const existing = seen.get(key);

            if (!existing || workflow.confidence > existing.confidence) {
                seen.set(key, workflow);
            }
        }

        // Sort by confidence descending
        return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
    }
}
