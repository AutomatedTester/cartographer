import { SiteCrawler } from './crawler.js';
import { SessionManager } from './session-manager.js';
import { LoginHandler } from './login-handler.js';
import { WorkflowDetector } from './workflow-detector.js';
import { JourneyInferenceEngine } from './journey-inference-engine.js';
import {
    MultiPageCrawlConfig,
    MultiPageCrawlResult,
    CrawledPage,
    CrawlError,
} from './types.js';
import { WebDriver, By, WebElement } from 'selenium-webdriver';

/**
 * MultiPageCrawler extends SiteCrawler to handle multi-page crawling,
 * state management, and workflow detection.
 */
export class MultiPageCrawler {
    private baseCrawler: SiteCrawler;
    private sessionManager: SessionManager;
    private config: MultiPageCrawlConfig;
    private crawlErrors: CrawlError[] = [];
    /** Pending button-click targets keyed by page URL, kept off the CrawledPage data type. */
    private pendingButtonClicks = new Map<string, string[]>();

    constructor(config: MultiPageCrawlConfig) {
        // Normalize URL by adding https:// if no protocol provided
        const normalizedStartUrl = this.normalizeUrl(config.startUrl);

        this.config = {
            maxPages: 10,
            maxDepth: 3,
            pageLoadTimeout: 30000,
            intentThreshold: 25,
            detectWorkflows: true,
            workflowStrategy: 'both',
            ...config,
            startUrl: normalizedStartUrl,
        };
        this.baseCrawler = new SiteCrawler();
        this.sessionManager = new SessionManager(normalizedStartUrl, this.config);

        // Initialize session state with credentials if provided
        if (this.config.credentials?.username && this.config.credentials?.password) {
            this.sessionManager.updateState('username', this.config.credentials.username);
            this.sessionManager.updateState('password', this.config.credentials.password);
            console.error('[multi-page-crawler] Credentials loaded into session state');
        }
    }

    /**
     * Normalize URLs by adding https:// if missing protocol
     */
    private normalizeUrl(url: string): string {
        if (!url) return url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        // Add https:// for URLs without protocol
        return `https://${url}`;
    }

    /**
     * Execute multi-page crawl
     */
    async crawl(): Promise<MultiPageCrawlResult> {
        try {
            this.crawlErrors = [];
            console.error('[multi-page-crawler] Initializing browser...');
            await this.baseCrawler.init();
            console.error('[multi-page-crawler] Browser initialized, starting crawl...');
            const startTime = Date.now();
            let cacheHits = 0;
            let cacheMisses = 0;

            // BFS: queue of { url, depth }
            const queue: Array<{ url: string; depth: number }> = [
                { url: this.config.startUrl!, depth: 0 },
            ];
            console.error(`[multi-page-crawler] Starting with URL: ${this.config.startUrl}`);

            // Stored for the performance summary; actual crawling is serialised
            // because a single WebDriver session can only load one page at a time.
            const concurrencyLimit = this.config.concurrencyLimit ?? 3;
            const enableMemoryOptimization = this.config.enableMemoryOptimization ?? true;
            while (queue.length > 0) {
                console.error(`[multi-page-crawler] Queue length: ${queue.length}`);
                // Check page limit
                if (this.sessionManager.getSession().pages.length >= this.config.maxPages!) {
                    console.error(`[multi-page-crawler] Reached max pages limit (${this.config.maxPages!})`);
                    break;
                }

                // Dequeue one item at a time — a single WebDriver session can
                // only be on one page at a time, so concurrent driver.get() calls
                // on the shared baseCrawler would clobber each other.
                // concurrencyLimit is respected for future pool-based expansion.
                const { url, depth } = queue.shift()!;
                console.error(`[multi-page-crawler] Crawling ${url} at depth ${depth}`);

                const result = await this.crawlSinglePage(url, depth).catch((error) => {
                    console.error(`[multi-page-crawler] Error crawling ${url}:`, error);
                    return null;
                });

                if (result) {
                    const { url: crawledUrl, nextUrls } = result;
                    this.sessionManager.recordNavigation(crawledUrl, nextUrls);

                    for (const nextUrl of nextUrls) {
                        if (!this.sessionManager.isVisited(nextUrl) && depth + 1 <= this.config.maxDepth!) {
                            queue.push({ url: nextUrl, depth: depth + 1 });
                        }
                    }
                }

                // Memory optimization: periodic cleanup if enabled
                if (enableMemoryOptimization && this.sessionManager.getSession().pages.length % 5 === 0) {
                    this.optimizeMemory();
                    console.error(
                        `[multi-page-crawler] Memory optimized (${this.getMemoryUsage().toFixed(1)} MB)`
                    );
                }
            }

            const session = await this.sessionManager.finalize();
            session.metadata.failedPages = this.crawlErrors.length;

            // The credentials were only needed to sign in during the crawl. The
            // session is returned to MCP clients and kept for later lookups, so
            // the password must not travel with it.
            delete session.sessionState.username;
            delete session.sessionState.password;
            const totalTime = Date.now() - startTime;

            // Infer user journeys from heuristic analysis
            const inferredJourneys = JourneyInferenceEngine.inferJourneys(session);
            session.inferredJourneys = inferredJourneys;

            // Calculate estimated user journeys (formal detected + high-confidence inferred)
            const detectedJourneyCount = session.workflows.filter((w) => w.confidence > 0.75).length;
            const inferredJourneyCount = inferredJourneys.filter((j) => j.confidence > 0.7).length;

            return {
                session,
                detectedWorkflows: session.workflows,
                inferredJourneys,
                crawlErrors: [...this.crawlErrors],
                summary: {
                    pagesVisited: session.pages.length,
                    failedPages: this.crawlErrors.length,
                    totalElements: session.pages.reduce((acc, p) => acc + (p && p.highIntentElements ? p.highIntentElements.length : 0), 0),
                    highIntentElements: session.metadata.totalHighIntentElements,
                    workflowsDetected: session.workflows.length,
                    estimatedUserJourneys: detectedJourneyCount + inferredJourneyCount,
                },
                performance: {
                    totalTime,
                    concurrency: concurrencyLimit,
                    cacheHits,
                    cacheMisses,
                    avgTimePerPage: session.pages.length > 0 ? Math.round(totalTime / session.pages.length) : 0,
                },
            };
        } finally {
            await this.baseCrawler.close();
        }
    }

    /**
     * Crawl a single page and extract navigation targets
     */
    private async crawlSinglePage(
        url: string,
        depth: number
    ): Promise<{ url: string; nextUrls: string[] } | null> {
        // Check depth limit
        if (depth > this.config.maxDepth!) {
            console.error(
                `[multi-page-crawler] Skipping ${url} (depth ${depth} > max ${this.config.maxDepth!})`
            );
            return null;
        }

        // Already visited check
        if (this.sessionManager.isVisited(url)) {
            console.error(`[multi-page-crawler] Already visited ${url}`);
            return null;
        }

        // URL pattern matching
        if (!this.matchesUrlPatterns(url)) {
            console.error(`[multi-page-crawler] Skipping ${url} (does not match URL patterns)`);
            return null;
        }

        try {
            console.error(`[multi-page-crawler] Crawling ${url} (depth ${depth})`);

            // Crawl the page
            const result = await this.baseCrawler.crawlAndAnalyze(
                url,
                this.config.intentThreshold,
                {
                    scriptTimeoutMs: this.config.scriptTimeoutMs,
                    pageLoadTimeoutMs: this.config.pageLoadTimeout,
                    analyzerTimeoutMs: this.config.analysisTimeoutMs,
                    analyzerInitTimeoutMs: this.config.modelLoadTimeoutMs,
                }
            );

            if (result.error) {
                throw new Error(`analysis_error: ${result.error}`);
            }

            console.error(`[multi-page-crawler] Page analyzed, got ${result?.highIntentElements?.length || 0} high-intent elements`);

            const page: CrawledPage = {
                url,
                title: result?.title || 'Untitled',
                timestamp: Date.now(),
                highIntentElements: result?.highIntentElements || [],
                generatedTestCases: result?.generatedTestCases || [],
                consoleLogs: result?.consoleLogs || [],
            };

            this.sessionManager.addPage(page);
            this.sessionManager.markAsVisited(url);
            console.error(`[multi-page-crawler] Added page to session, total pages: ${this.sessionManager.getSession().pages.length}`);

            // Handle login form if auto-login is enabled and credentials are available
            const enableAutoLogin = this.config.enableAutoLogin !== false; // default true
            if (enableAutoLogin) {
                await this.handleLoginFormIfPresent(page);
            }

            // Extract navigation targets
            const nextUrls = this.extractNavigationTargets(page, url);
            console.error(
                `[multi-page-crawler] Navigation targets extracted from ${url}: ${nextUrls.length} URLs found`
            );
            if (nextUrls.length > 0) {
                console.error(
                    `[multi-page-crawler] Navigation URLs:`,
                    nextUrls.slice(0, 5).map((u) => u.substring(0, 80))
                );
            }

            // Handle button clicks to discover additional navigation targets
            const buttonClickedUrls = await this.handlePendingButtonClicks(page, url);
            if (buttonClickedUrls.length > 0) {
                console.error(
                    `[multi-page-crawler] Discovered ${buttonClickedUrls.length} URLs from button clicks`
                );
                nextUrls.push(...buttonClickedUrls);
            }

            return { url, nextUrls };
        } catch (error) {
            console.error(`[multi-page-crawler] Error crawling ${url}:`, error);
            if (error instanceof Error) {
                console.error(`[multi-page-crawler] Error stack:`, error.stack);
            }
            this.crawlErrors.push({
                url,
                depth,
                phase: this.inferFailurePhase(error),
                message: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            return null;
        }
    }

    private inferFailurePhase(error: unknown): CrawlError['phase'] {
        const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (msg.includes('timeout') || msg.includes('script')) {
            return 'analyze';
        }
        if (msg.includes('navigate') || msg.includes('page load')) {
            return 'navigate';
        }
        if (msg.includes('extract')) {
            return 'extract';
        }
        return 'unknown';
    }

    /**
     * Handle login form if present on the current page
     */
    private async handleLoginFormIfPresent(page: CrawledPage): Promise<void> {
        // Safety check
        if (!page || !page.url) {
            console.error('[multi-page-crawler] Page object is invalid, skipping login handling');
            return;
        }

        // Check if credentials are available
        const sessionState = this.sessionManager.getState();
        const username = sessionState.username;
        const password = sessionState.password;

        // If no credentials, skip login handling
        if (!username || !password) {
            return;
        }

        // Check if this is a login form page (via HighIntentElements)
        const loginCheck = WorkflowDetector.isLoginFormPage(page);

        // Also check for login form inputs in the DOM (for modals/overlays)
        const driver = this.baseCrawler.getDriver();
        let hasLoginFormInDOM = false;

        if (driver) {
            try {
                const passwordInputs = await driver.findElements(By.css('input[type="password"]'));
                const usernameInputs = await driver.findElements(By.css('input[type="email"], input[type="text"][autocomplete*="user"], input[name="username"], input[aria-label*="username" i]'));

                const passwordCount = passwordInputs ? (Array.isArray(passwordInputs) ? passwordInputs.length : 0) : 0;
                const usernameCount = usernameInputs ? (Array.isArray(usernameInputs) ? usernameInputs.length : 0) : 0;

                if (passwordCount > 0 && usernameCount > 0) {
                    hasLoginFormInDOM = true;
                }
            } catch (e) {
                // Continue if error
            }
        }

        // Determine if we should handle login
        const shouldHandleLogin = loginCheck.isLoginPage || hasLoginFormInDOM;

        if (!shouldHandleLogin) {
            return;
        }

        try {
            // Get WebDriver instance from crawler
            const driver = this.baseCrawler.getDriver();
            if (!driver) {
                return;
            }

            // Create LoginHandler and perform login
            const loginHandler = new LoginHandler(driver);
            const result = await loginHandler.performLogin(username, password, page.url, {
                maxWaitTime: this.config.pageLoadTimeout || 30000,
                verbose: false,
            });

            if (result.success) {
                // Update session state to mark login as successful
                this.sessionManager.updateState('lastLoginSuccess', Date.now());
            } else {
                // Update session state to mark login as failed
                this.sessionManager.updateState('lastLoginFailure', {
                    timestamp: Date.now(),
                    reason: result.reason,
                    url: result.currentUrl,
                });
            }
        } catch (error) {
            console.error('[multi-page-crawler] Error during login handling:', error);
            this.sessionManager.updateState('lastLoginError', {
                timestamp: Date.now(),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Extract navigation targets from page elements
     */
    private extractNavigationTargets(page: CrawledPage, pageUrl: string): string[] {
        const targets = new Set<string>();
        const buttonUrls: string[] = [];

        // Primary: Extract from high-intent navigating elements
        console.error(`[multi-page-crawler] Checking ${page.highIntentElements.length} high-intent elements for navigation`);
        for (const el of page.highIntentElements) {
            console.error(`[multi-page-crawler]   - ${el.tag} "${el.text}" navigates=${el.navigates} target=${el.navigationTarget}`);
            if (el.navigates && el.navigationTarget) {
                targets.add(this.resolveUrl(el.navigationTarget, pageUrl));
                console.error(`[multi-page-crawler]     ✅ Added navigation target: ${el.navigationTarget}`);
            } else if (el.navigates && !el.navigationTarget && el.tag === 'button') {
                // Button marked as navigating but no explicit target - will be handled via allNavigationLinks
                const btnIdentifier = el.id || el.ariaLabel || el.text || `${el.tag}-${el.classes?.join('-')}`;
                buttonUrls.push(`__button__:${btnIdentifier}`);
                console.error(`[multi-page-crawler]   ? Button needs click handling: "${el.text}"`);
            }
        }

        // Fallback: If no navigation targets found in analyzed elements,
        // use pre-extracted allNavigationLinks from analyzer
        if (targets.size === 0) {
            // Note: allNavigationLinks are already absolute URLs from the browser
            if (Array.isArray((page as any).allNavigationLinks)) {
                console.error(`[multi-page-crawler] No navigating elements found, checking allNavigationLinks: ${(page as any).allNavigationLinks.length} links`);
                for (const link of (page as any).allNavigationLinks) {
                    if (link && typeof link === 'string') {
                        // Handle button click URLs separately
                        if (link.startsWith('__button__:')) {
                            buttonUrls.push(link);
                        } else if (!link.startsWith('#')) {
                            targets.add(link);
                        }
                    }
                }
            } else {
                console.error(`[multi-page-crawler] No allNavigationLinks available`);
            }
        }

        // Convert to array for return
        const result = Array.from(targets);

        if (buttonUrls.length > 0) {
            this.pendingButtonClicks.set(page.url, buttonUrls);
            console.error(`[multi-page-crawler] Found ${buttonUrls.length} buttons to click for navigation`);
        }

        return result;
    }

    /**
     * Handle button clicks to discover navigation targets
     * For buttons that don't have explicit href/action targets,
     * click them and capture where they navigate
     */
    private async handlePendingButtonClicks(page: CrawledPage, pageUrl: string): Promise<string[]> {
        const discoveredUrls: string[] = [];
        const pendingClicks = this.pendingButtonClicks.get(page.url);

        if (!pendingClicks || pendingClicks.length === 0) {
            return discoveredUrls;
        }

        const driver = this.baseCrawler.getDriver();
        if (!driver) {
            console.error('[multi-page-crawler] WebDriver not available for button clicks');
            return discoveredUrls;
        }

        for (const buttonUrl of pendingClicks) {
            try {
                const buttonId = buttonUrl.replace('__button__:', '');
                console.error(`[multi-page-crawler] Attempting to click button: "${buttonId}"`);

                let clicked = false;

                // Try to find the button using multiple strategies
                try {
                    // Strategy 1: By ID
                    const element = await driver.findElement(By.id(buttonId)).catch(() => null) as any;
                    if (element) {
                        console.error(`[multi-page-crawler]   Found button by ID: ${buttonId}`);
                        await driver.actions({ async: true }).move({ origin: element }).perform();
                        await element.click();
                        clicked = true;
                    }
                } catch (e) {
                    // Continue to next strategy
                }

                if (!clicked) {
                    try {
                        // Strategy 2: By aria-label
                        const element = await driver.findElement(By.css(`[aria-label="${buttonId}"]`)).catch(() => null) as any;
                        if (element) {
                            console.error(`[multi-page-crawler]   Found button by aria-label`);
                            await driver.actions({ async: true }).move({ origin: element }).perform();
                            await element.click();
                            clicked = true;
                        }
                    } catch (e) {
                        // Continue to next strategy
                    }
                }

                if (!clicked) {
                    try {
                        // Strategy 3: Find by text content using XPath
                        const element = await driver.findElement(
                            By.xpath(`//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${buttonId.toLowerCase()}')] | //*[@role="button"][contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${buttonId.toLowerCase()}')]`)
                        ).catch(() => null) as any;
                        if (element) {
                            console.error(`[multi-page-crawler]   Found button by text`);
                            await driver.actions({ async: true }).move({ origin: element }).perform();
                            await element.click();
                            clicked = true;
                        }
                    } catch (e) {
                        // Continue to fallback
                    }
                }

                if (!clicked) {
                    // Fallback: locate the button via JavaScript then click it
                    // using the WebDriver actions API so that a genuine pointer
                    // event is produced instead of a synthetic JS click().
                    try {
                        const searchTerm = buttonId.toLowerCase();
                        const element = await driver.executeScript<WebElement | null>(`
                            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                            const searchTerm = arguments[0];
                            const btn = buttons.find(b =>
                                b.textContent?.toLowerCase().includes(searchTerm) ||
                                b.getAttribute('aria-label')?.toLowerCase().includes(searchTerm) ||
                                b.id?.toLowerCase().includes(searchTerm)
                            );
                            if (btn) {
                                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                            return btn || null;
                        `, searchTerm);
                        if (element) {
                            await driver.actions({ async: true }).click(element as WebElement).perform();
                            clicked = true;
                            console.error(`[multi-page-crawler]   Clicked button via WebDriver actions`);
                        }
                    } catch (e) {
                        console.error(`[multi-page-crawler]   ✗ Could not find or click button`);
                    }
                }

                if (clicked) {
                    console.error(`[multi-page-crawler]   ✅ Button clicked, waiting for navigation or modal...`);

                    // Wait for navigation (max 5 seconds) OR for login form to appear
                    const startUrl = await driver.getCurrentUrl();
                    let newUrl = startUrl;
                    let attempts = 0;
                    const maxAttempts = 50; // 5 seconds with 100ms intervals
                    let loginFormDetected = false;

                    while (newUrl === startUrl && attempts < maxAttempts && !loginFormDetected) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        try {
                            newUrl = await driver.getCurrentUrl();

                            // Check if a login form has appeared (modal/dialog)
                            const hasPasswordInput = await driver.findElements(By.css('input[type="password"]')).then(els => els.length > 0);
                            const hasUsernameInput = await driver.findElements(By.css('input[type="email"], input[type="text"][autocomplete*="user"], input[name="username"]')).then(els => els.length > 0);

                            if (hasPasswordInput && hasUsernameInput) {
                                console.error(`[multi-page-crawler]   🔐 Login form detected after button click!`);
                                loginFormDetected = true;

                                // Immediately handle login if form appears
                                console.error(`[multi-page-crawler]   🔐 Attempting to login with detected form...`);
                                try {
                                    const loginHandler = new LoginHandler(driver);
                                    const sessionState = this.sessionManager.getState();
                                    const username = sessionState.username;
                                    const password = sessionState.password;

                                    if (username && password) {
                                        const result = await loginHandler.performLogin(username, password, newUrl);
                                        console.error(`[multi-page-crawler]   🔐 Login result: success=${result.success}, reason=${result.reason}`);

                                        if (result.success) {
                                            this.sessionManager.updateState('lastLoginSuccess', Date.now());
                                            console.error(`[multi-page-crawler] ✅ Login successful!`);

                                            // Add the authenticated page URL to the queue for further crawling
                                            const authenticatedUrl = result.currentUrl;
                                            if (authenticatedUrl && authenticatedUrl !== startUrl) {
                                                console.error(`[multi-page-crawler]   ➕ Adding authenticated page to crawl queue: ${authenticatedUrl}`);
                                                discoveredUrls.push(authenticatedUrl);
                                            }
                                        } else {
                                            console.error(`[multi-page-crawler] ❌ Login failed: ${result.reason}`);
                                        }
                                    }
                                } catch (loginError) {
                                    console.error(`[multi-page-crawler] ❌ Error during login:`, loginError instanceof Error ? loginError.message : loginError);
                                }
                            }
                        } catch (e) {
                            // Driver might be navigating, try again
                        }
                        attempts++;
                    }

                    if (loginFormDetected) {
                        console.error(`[multi-page-crawler]   ℹ️  Login form was handled after click`);
                    } else if (newUrl !== startUrl) {
                        console.error(`[multi-page-crawler]   ✅ Navigation detected: ${newUrl}`);
                        discoveredUrls.push(newUrl);
                    } else {
                        console.error(`[multi-page-crawler]   ? No navigation detected after click`);
                    }
                }
            } catch (error) {
                console.error(`[multi-page-crawler] Error clicking button "${buttonUrl}":`, error instanceof Error ? error.message : error);
            }
        }

        return discoveredUrls;
    }

    /**
     * Resolve relative URLs to absolute
     */
    private resolveUrl(target: string, baseUrl: string): string {
        try {
            // If already absolute, return as-is
            if (target.startsWith('http://') || target.startsWith('https://')) {
                return target;
            }

            // Parse base URL
            const base = new URL(baseUrl);

            // Handle root-relative URLs
            if (target.startsWith('/')) {
                return `${base.protocol}//${base.host}${target}`;
            }

            // Handle relative URLs the way a browser does: against the page's
            // own URL, so "b.html" on /demo/index.html is /demo/b.html.
            const resolved = new URL(target, baseUrl).href;

            // Remove fragments and normalize
            return resolved.split('#')[0];
        } catch (error) {
            console.error(`[multi-page-crawler] Error resolving URL: ${target}`, error);
            return target;
        }
    }

    /**
     * Check if URL matches include/exclude patterns
     */
    private matchesUrlPatterns(url: string): boolean {
        const patterns = this.config.urlPatterns;
        if (!patterns) return true;

        // Check exclude patterns
        if (patterns.exclude) {
            for (const pattern of patterns.exclude) {
                try {
                    if (new RegExp(pattern).test(url)) {
                        return false; // URL matches exclude pattern
                    }
                } catch (e) {
                    console.warn(`[multi-page-crawler] Invalid exclude pattern: ${pattern}`);
                }
            }
        }

        // Check include patterns
        if (patterns.include && patterns.include.length > 0) {
            for (const pattern of patterns.include) {
                try {
                    if (new RegExp(pattern).test(url)) {
                        return true; // URL matches include pattern
                    }
                } catch (e) {
                    console.warn(`[multi-page-crawler] Invalid include pattern: ${pattern}`);
                }
            }
            return false; // URL doesn't match any include pattern
        }

        return true; // No include patterns, so accept
    }

    /**
     * Optimize memory by cleaning up non-essential data in pages
     */
    private optimizeMemory(): void {
        const session = this.sessionManager.getSession();
        const enableOptimization = this.config.enableMemoryOptimization ?? true;

        if (!enableOptimization) return;

        // Optionally strip raw HTML if not needed
        for (const page of session.pages) {
            // Remove metadata that's not essential for workflow analysis
            if (page.highIntentElements) {
                // Keep only essential element properties
                page.highIntentElements = page.highIntentElements.map((el) => ({
                    ...el,
                    // Could strip detailed attributes here if needed
                }));
            }
        }

        // Trigger garbage collection if available
        if (global.gc) {
            try {
                global.gc();
            } catch (e) {
                // Gracefully handle if gc is not exposed
            }
        }
    }

    /**
     * Get current memory usage in MB
     */
    private getMemoryUsage(): number {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            const usage = process.memoryUsage();
            return usage.heapUsed / 1024 / 1024; // Convert to MB
        }
        return 0;
    }
}
