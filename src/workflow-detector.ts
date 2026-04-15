import {
    CrawlSession,
    DetectedWorkflow,
    WorkflowAction,
    StateTransition,
    CrawledPage,
    WorkflowDetectionCache,
    HighIntentElement,
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
        try {
            // Generate cache key from session pages
            const cacheKey = this.generateCacheKey(session);

            // Check cache if enabled
            if (enableCache) {
                const cached = this.detectionCache.get(cacheKey);
                if (cached && !this.isCacheExpired(cached)) {
                    return cached.workflows;
                } else if (cached) {
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
        } catch (error) {
            // Return empty array on error instead of crashing
            return [];
        }
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

        try {
            workflows.push(...this.detectFormSubmissionFlows(session));
        } catch (e) {
            // Continue on error
        }

        try {
            workflows.push(...this.detectAuthFlows(session));
        } catch (e) {
            // Continue on error
        }

        try {
            workflows.push(...this.detectNavigationPatterns(session));
        } catch (e) {
            // Continue on error
        }

        try {
            workflows.push(...this.detectNavMenuJourneys(session));
        } catch (e) {
            // Continue on error
        }

        try {
            workflows.push(...this.detectMultiStepForms(session));
        } catch (e) {
            // Continue on error
        }

        return workflows;
    }

    /**
     * Detect form submission workflows: form page → success page
     */
    private static detectFormSubmissionFlows(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        // Safety check
        if (!session || !session.pages || !Array.isArray(session.pages)) {
            return workflows;
        }

        for (let i = 0; i < session.pages.length - 1; i++) {
            const currentPage = session.pages[i];
            const nextPage = session.pages[i + 1];

            // Safety checks for page objects
            if (!currentPage || !currentPage.highIntentElements || !Array.isArray(currentPage.highIntentElements)) {
                continue;
            }
            if (!nextPage || !nextPage.highIntentElements || !Array.isArray(nextPage.highIntentElements)) {
                continue;
            }

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

        // Safety check
        if (!session || !session.pages || !Array.isArray(session.pages)) {
            return workflows;
        }

        for (let i = 0; i < session.pages.length - 1; i++) {
            const page = session.pages[i];

            // Safety check for page object
            if (!page || !page.highIntentElements || !Array.isArray(page.highIntentElements)) {
                continue;
            }

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
                // Safety check for next page
                if (!nextPage) continue;

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
     * Check if a page is a login form page and extract login field information
     */
    static isLoginFormPage(page: CrawledPage): {
        isLoginPage: boolean;
        hasUsernameField: boolean;
        hasPasswordField: boolean;
        hasSubmitButton: boolean;
        confidence: number;
    } {
        // Safety check
        if (!page || !page.highIntentElements || !Array.isArray(page.highIntentElements)) {
            return {
                isLoginPage: false,
                hasUsernameField: false,
                hasPasswordField: false,
                hasSubmitButton: false,
                confidence: 0,
            };
        }

        // Check URL patterns
        const isLoginUrl =
            page.url.includes('/login') ||
            page.url.includes('/signin') ||
            page.url.includes('/auth');

        // Check for password input
        const hasPasswordField = page.highIntentElements.some(
            (el) => el.tag === 'input' && el.attributes?.type === 'password'
        );

        // Check for username/email input
        const hasUsernameField = page.highIntentElements.some((el) => {
            if (el.tag !== 'input') return false;
            const type = el.attributes?.type || '';
            const name = el.attributes?.name || '';
            const id = el.attributes?.id || '';
            const placeholder = el.attributes?.placeholder || '';
            return (
                type === 'email' ||
                type === 'text' ||
                name.includes('user') ||
                name.includes('email') ||
                id.includes('user') ||
                id.includes('email') ||
                placeholder.toLowerCase().includes('user') ||
                placeholder.toLowerCase().includes('email')
            );
        });

        // Check for submit button
        const hasSubmitButton = page.highIntentElements.some(
            (el) =>
                (el.tag === 'button' || el.tag === 'input') &&
                (el.attributes?.type === 'submit' ||
                    (el.text || '').toLowerCase().includes('login') ||
                    (el.text || '').toLowerCase().includes('sign in') ||
                    (el.ariaLabel || '').toLowerCase().includes('login'))
        );

        // Calculate confidence score
        let confidence = 0;
        if (isLoginUrl) confidence += 40;
        if (hasPasswordField) confidence += 30;
        if (hasUsernameField) confidence += 20;
        if (hasSubmitButton) confidence += 10;

        const isLoginPage = confidence >= 50 && hasPasswordField;

        return {
            isLoginPage,
            hasUsernameField,
            hasPasswordField,
            hasSubmitButton,
            confidence,
        };
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
     * Detect navigation menu-driven journeys
     * Identifies intent sequences from top-level nav menu exploration
     * Examples:
     *   - Home → Find Doctors → Doctor Detail
     *   - Home → Specialties → Category → Results
     */
    private static detectNavMenuJourneys(session: CrawlSession): DetectedWorkflow[] {
        const workflows: DetectedWorkflow[] = [];

        if (!session?.pages?.length) return workflows;

        const firstPage = session.pages[0];
        if (!firstPage?.highIntentElements) return workflows;

        // Extract top-level navigation items from first page
        // Look for links or buttons with high intent scores and navigation intent reasons
        const navItems = firstPage.highIntentElements.filter((el) => {
            // Accept both <a> links and <button> elements with navigation intent
            const isNavElement = el.navigates && (el.tag === 'a' || el.tag === 'button') && el.intentScore >= 28;
            const isTopNav =
                el.intentReasons?.some((r) => r.includes('top-level navigation intent')) ||
                el.intentReasons?.some((r) => r.includes('Link in navigation context')) ||
                el.intentReasons?.some((r) => r.includes('Search interaction')); // "Find Doctors" has this
            return isNavElement && isTopNav;
        });

        // For each nav item, trace its journey through subsequent pages
        for (const navItem of navItems) {
            const navTarget = navItem.navigationTarget;
            const navText = navItem.text || navItem.ariaLabel || 'navigation';

            // If we don't have explicit navigation target, try to infer from text
            let targetPages: CrawledPage[] = [];

            if (navTarget) {
                // Match pages that contain the navigation target in their URL
                targetPages = session.pages.filter(
                    (p) => p.url.includes(decodeURIComponent(navTarget)) || p.url.toLowerCase().includes(navText.toLowerCase())
                );
            } else if (session.pages.length > 1) {
                // Fallback: Find pages based on title/content matching nav text
                const navKeywords = navText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
                targetPages = session.pages.slice(1).filter((p) => {
                    const pageContent = (p.title + ' ' + (p.highIntentElements.map((el) => el.text) || []).join(' ')).toLowerCase();
                    return navKeywords.some((kw) => pageContent.includes(kw));
                });
            }

            if (targetPages.length === 0) continue;

            // Build journey: Home → NavLink → TargetPage(s)
            const journey: string[] = [firstPage.url];
            const journeyPages: CrawledPage[] = [firstPage];

            for (const targetPage of targetPages) {
                journey.push(targetPage.url);
                journeyPages.push(targetPage);

                // Stop at 3 pages to avoid combinatorial explosion
                if (journey.length >= 3) break;
            }

            if (journey.length >= 2) {
                workflows.push({
                    id: `wf_navmenu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: 'navigation_menu_exploration',
                    pageSequence: journey,
                    actionSequence: this.buildActionSequenceFromNavigation(firstPage, navItem, journeyPages),
                    stateTransitions: this.buildStateTransitions(journeyPages),
                    confidence: 70,
                    tags: ['navigation', 'menu-driven', 'user-exploration', navText.toLowerCase().replace(/\s+/g, '-')],
                });
            }
        }

        return workflows;
    }

    /**
     * Build action sequence from navigation menu interaction
     */
    private static buildActionSequenceFromNavigation(
        homePage: CrawledPage,
        navItem: HighIntentElement,
        journeyPages: CrawledPage[]
    ): WorkflowAction[] {
        const actions: WorkflowAction[] = [];

        // Step 1: Click the navigation link
        actions.push({
            pageUrl: homePage.url,
            elementLocator: navItem.locator,
            actionType: 'click',
            resultingNavigation: navItem.navigationTarget,
            timestamp: homePage.timestamp,
        });

        // Step 2+: Interact with elements on subsequent pages
        for (let i = 1; i < journeyPages.length; i++) {
            const page = journeyPages[i];
            // Find high-intent elements that suggest further exploration
            const intentElements = page.highIntentElements
                .filter((el) => el.intentScore >= 50)
                .slice(0, 2); // Top 2 intent elements per page

            for (const el of intentElements) {
                actions.push({
                    pageUrl: page.url,
                    elementLocator: el.locator,
                    actionType: 'click',
                    resultingNavigation: el.navigationTarget,
                    timestamp: page.timestamp,
                });
            }
        }

        return actions;
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
        if (!Array.isArray(workflows) || workflows.length === 0) {
            return [];
        }

        // Build a workflow DAG once so all candidates share the same acyclic ordering.
        const dag = this.buildWorkflowDag(workflows);

        const normalized = workflows
            .map((workflow) => this.normalizeWorkflowWithDag(workflow, dag))
            .filter((workflow) => workflow.pageSequence.length >= 2);

        // Deduplicate by canonical page path (not detector name), keeping best confidence.
        const seen = new Map<string, DetectedWorkflow>();

        for (const workflow of normalized) {
            const key = JSON.stringify(workflow.pageSequence);
            const existing = seen.get(key);

            if (!existing || workflow.confidence > existing.confidence) {
                seen.set(key, workflow);
            } else if (existing) {
                existing.tags = Array.from(new Set([...(existing.tags || []), ...(workflow.tags || [])]));
            }
        }

        // Prune workflows that are strict subpaths of a stronger workflow.
        const pruned = this.pruneRedundantWorkflows(Array.from(seen.values()));

        // Sort by confidence descending
        return pruned.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Build DAG metadata for workflow paths.
     * Back-edges are ignored to keep traversal acyclic.
     */
    private static buildWorkflowDag(workflows: DetectedWorkflow[]): {
        adjacency: Map<string, Set<string>>;
        rankByUrl: Map<string, number>;
    } {
        const adjacency = new Map<string, Set<string>>();
        const rankByUrl = new Map<string, number>();

        for (const workflow of workflows) {
            const sequence = workflow.pageSequence || [];
            for (let i = 0; i < sequence.length; i++) {
                const url = sequence[i];
                if (!rankByUrl.has(url)) {
                    rankByUrl.set(url, i);
                } else {
                    rankByUrl.set(url, Math.min(rankByUrl.get(url)!, i));
                }
            }
        }

        for (const workflow of workflows) {
            const sequence = workflow.pageSequence || [];
            for (let i = 0; i < sequence.length - 1; i++) {
                const from = sequence[i];
                const to = sequence[i + 1];
                if (!from || !to || from === to) continue;

                const fromRank = rankByUrl.get(from) ?? Number.MAX_SAFE_INTEGER;
                const toRank = rankByUrl.get(to) ?? Number.MAX_SAFE_INTEGER;

                // Ignore back edges to preserve DAG shape.
                if (toRank < fromRank) continue;

                if (!adjacency.has(from)) {
                    adjacency.set(from, new Set<string>());
                }
                adjacency.get(from)!.add(to);
            }
        }

        return { adjacency, rankByUrl };
    }

    /**
     * Normalize a workflow path by pruning cycles/redundant steps using DAG ordering.
     */
    private static normalizeWorkflowWithDag(
        workflow: DetectedWorkflow,
        dag: { adjacency: Map<string, Set<string>>; rankByUrl: Map<string, number> }
    ): DetectedWorkflow {
        const cleanedSequence: string[] = [];
        const seen = new Set<string>();
        let lastRank = -1;

        for (const url of workflow.pageSequence || []) {
            if (!url) continue;
            if (cleanedSequence.length > 0 && cleanedSequence[cleanedSequence.length - 1] === url) continue;
            if (seen.has(url)) continue; // prune loops/backtracking cycles

            const rank = dag.rankByUrl.get(url) ?? Number.MAX_SAFE_INTEGER;
            if (rank < lastRank) continue; // prune non-DAG step

            cleanedSequence.push(url);
            seen.add(url);
            lastRank = rank;
        }

        const keptUrls = new Set(cleanedSequence);
        const actionSequence = (workflow.actionSequence || []).filter((action) =>
            keptUrls.has(action.pageUrl)
        );
        const stateTransitions = (workflow.stateTransitions || []).filter(
            (transition) => keptUrls.has(transition.fromPage) && keptUrls.has(transition.toPage)
        );

        return {
            ...workflow,
            pageSequence: cleanedSequence,
            actionSequence,
            stateTransitions,
        };
    }

    /**
     * Remove workflows whose page sequence is a strict subsequence of a stronger one.
     */
    private static pruneRedundantWorkflows(workflows: DetectedWorkflow[]): DetectedWorkflow[] {
        const sorted = [...workflows].sort((a, b) => {
            if (b.confidence !== a.confidence) return b.confidence - a.confidence;
            return (b.pageSequence?.length || 0) - (a.pageSequence?.length || 0);
        });

        const kept: DetectedWorkflow[] = [];
        for (const workflow of sorted) {
            const sequence = workflow.pageSequence || [];
            const isRedundant = kept.some((candidate) =>
                this.isStrictSubsequence(sequence, candidate.pageSequence || [])
            );
            if (!isRedundant) {
                kept.push(workflow);
            }
        }

        return kept;
    }

    private static isStrictSubsequence(sequence: string[], target: string[]): boolean {
        if (sequence.length === 0 || sequence.length >= target.length) return false;

        let index = 0;
        for (const url of target) {
            if (url === sequence[index]) {
                index++;
                if (index === sequence.length) return true;
            }
        }
        return false;
    }
}
