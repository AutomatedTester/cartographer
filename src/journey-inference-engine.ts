import { CrawlSession, CrawledPage, HighIntentElement } from './types.js';

/**
 * InferredJourney represents a probable user journey through the site
 * inferred from element analysis and URL patterns.
 */
export interface InferredJourney {
    id: string;
    name: string;
    description: string;
    pageSequence: string[];
    elementPatterns: string[];
    signals: {
        semanticSignals: string[];
        urlPatterns: string[];
        elementPresence: Record<string, boolean>;
    };
    confidence: number;
    tags: string[];
}

/**
 * JourneyInferenceEngine infers likely user journeys from element analysis
 * and URL patterns without requiring formal workflow detection.
 *
 * This complements WorkflowDetector which looks for formal patterns.
 * JourneyInferenceEngine handles implicit journeys on sites like e-commerce
 * product listings that don't have explicit multi-step workflows.
 */
export class JourneyInferenceEngine {
    /**
     * Infer user journeys from a crawl session
     */
    static inferJourneys(session: CrawlSession): InferredJourney[] {
        try {
            // Safety check
            if (!session || !session.pages || !Array.isArray(session.pages)) {
                return [];
            }

            if (session.pages.length === 0) {
                return [];
            }

            // Analyze semantic signals across all pages
            const signals = this.analyzeSemanticSignals(session);

            // Extract URL patterns and page classification
            const pageClassification = this.classifyPagesByURL(session);

            // Build journey inferences
            const journeys: InferredJourney[] = [];

            // Journey 1: Product Discovery & Browse
            if (this.shouldInferProductDiscovery(signals, pageClassification)) {
                journeys.push(this.buildProductDiscoveryJourney(session, signals, pageClassification));
            }

            // Journey 2: Shopping & Checkout
            if (this.shouldInferCheckoutFlow(signals, pageClassification)) {
                journeys.push(this.buildCheckoutJourney(session, signals, pageClassification));
            }

            // Journey 3: Account Management
            if (this.shouldInferAccountFlow(signals, pageClassification)) {
                journeys.push(this.buildAccountJourney(session, signals, pageClassification));
            }

            // Journey 4: Deal & Offer Exploration
            if (this.shouldInferDealFlow(signals, pageClassification)) {
                journeys.push(this.buildDealJourney(session, signals, pageClassification));
            }

            return journeys;
        } catch (error) {
            console.error('[journey-inference] Error inferring journeys:', error);
            return [];
        }
    }

    /**
     * Analyze semantic signals across the entire crawl session
     */
    private static analyzeSemanticSignals(session: CrawlSession): {
        hasProductElements: boolean;
        hasCheckoutElements: boolean;
        hasAuthElements: boolean;
        hasSearchElements: boolean;
        hasNavigationElements: boolean;
        hasAccountElements: boolean;
        hasOfferElements: boolean;
        totalElements: number;
        elementTypes: Record<string, number>;
    } {
        const signals = {
            hasProductElements: false,
            hasCheckoutElements: false,
            hasAuthElements: false,
            hasSearchElements: false,
            hasNavigationElements: false,
            hasAccountElements: false,
            hasOfferElements: false,
            totalElements: 0,
            elementTypes: {} as Record<string, number>,
        };

        for (const page of session.pages) {
            if (!page || !page.highIntentElements || !Array.isArray(page.highIntentElements)) {
                continue;
            }

            for (const element of page.highIntentElements) {
                if (!element) continue;

                signals.totalElements++;

                // Count element types
                signals.elementTypes[element.tag] = (signals.elementTypes[element.tag] || 0) + 1;

                const text = (element.text || element.ariaLabel || '').toLowerCase();
                const className = (element.attributes?.class || '').toLowerCase();
                const datAttrs = JSON.stringify(element.attributes || {}).toLowerCase();

                // Product discovery signals
                if (this.isProductIndicator(element, text, className)) {
                    signals.hasProductElements = true;
                }

                // Checkout signals
                if (this.isCheckoutIndicator(element, text)) {
                    signals.hasCheckoutElements = true;
                }

                // Auth signals
                if (this.isAuthIndicator(element, text)) {
                    signals.hasAuthElements = true;
                }

                // Search signals
                if (this.isSearchIndicator(element, text, className)) {
                    signals.hasSearchElements = true;
                }

                // Navigation signals
                if (this.isNavigationIndicator(element, text)) {
                    signals.hasNavigationElements = true;
                }

                // Account signals
                if (this.isAccountIndicator(element, text)) {
                    signals.hasAccountElements = true;
                }

                // Deal/offer signals
                if (this.isDealIndicator(element, text)) {
                    signals.hasOfferElements = true;
                }
            }
        }

        return signals;
    }

    /**
     * Classify discovered pages by URL patterns
     */
    private static classifyPagesByURL(session: CrawlSession): {
        homepageFound: boolean;
        productPages: string[];
        cartPage: string | null;
        checkoutPage: string | null;
        accountPage: string | null;
        ordersPage: string | null;
        offersPage: string | null;
        searchPages: string[];
    } {
        const classification = {
            homepageFound: false,
            productPages: [] as string[],
            cartPage: null as string | null,
            checkoutPage: null as string | null,
            accountPage: null as string | null,
            ordersPage: null as string | null,
            offersPage: null as string | null,
            searchPages: [] as string[],
        };

        for (const page of session.pages) {
            if (!page || !page.url) continue;

            const url = page.url.toLowerCase();
            const path = new URL(page.url).pathname.toLowerCase();

            // Homepage detection
            if (url.endsWith('/') || path === '' || path === '/') {
                classification.homepageFound = true;
            }

            // Product pages
            if (path.includes('product') || path.includes('item')) {
                classification.productPages.push(page.url);
            }

            // Cart/shopping bag
            if (path.includes('cart') || path.includes('shopping-bag') || path.includes('basket')) {
                classification.cartPage = page.url;
            }

            // Checkout
            if (path.includes('checkout') || path.includes('payment') || path.includes('payments')) {
                classification.checkoutPage = page.url;
            }

            // Account/profile. Authentication entry points and the landing page
            // that follows a successful sign-in count too: /login -> /dashboard
            // is the most common account journey there is, and matching only on
            // 'account'/'profile' missed it entirely.
            if (
                path.includes('account') ||
                path.includes('profile') ||
                path.includes('user') ||
                path.includes('settings') ||
                path.includes('login') ||
                path.includes('signin') ||
                path.includes('sign-in') ||
                path.includes('register') ||
                path.includes('signup') ||
                path.includes('sign-up') ||
                path.includes('dashboard')
            ) {
                classification.accountPage = page.url;
            }

            // Orders
            if (
                path.includes('orders') ||
                path.includes('order-history') ||
                path.includes('my-orders')
            ) {
                classification.ordersPage = page.url;
            }

            // Offers/deals
            if (
                path.includes('offers') ||
                path.includes('deals') ||
                path.includes('promotions') ||
                path.includes('coupons')
            ) {
                classification.offersPage = page.url;
            }

            // Search results
            if (path.includes('search') || path.includes('results')) {
                classification.searchPages.push(page.url);
            }
        }

        return classification;
    }

    /**
     * Determine if we should infer a Product Discovery journey
     */
    private static shouldInferProductDiscovery(
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): boolean {
        // Need product elements + either search or navigation
        return (
            signals.hasProductElements &&
            (signals.hasSearchElements || signals.hasNavigationElements) &&
            (pageClassification.homepageFound || pageClassification.searchPages.length > 0)
        );
    }

    /**
     * Determine if we should infer a Checkout flow
     */
    private static shouldInferCheckoutFlow(
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): boolean {
        // Need products + checkout signals
        // Can infer with just checkout elements on product pages, even without dedicated cart/checkout page
        return (
            signals.hasProductElements &&
            signals.hasCheckoutElements
        );
    }

    /**
     * Determine if we should infer an Account flow
     */
    private static shouldInferAccountFlow(
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): boolean {
        // Need account signals and account page discovered
        return (
            signals.hasAccountElements &&
            !!(pageClassification.accountPage || pageClassification.ordersPage)
        );
    }

    /**
     * Determine if we should infer a Deal/Offer flow
     */
    private static shouldInferDealFlow(
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): boolean {
        // Need deal signals and offers page discovered
        return signals.hasOfferElements && !!pageClassification.offersPage;
    }

    /**
     * Build Product Discovery journey
     */
    private static buildProductDiscoveryJourney(
        session: CrawlSession,
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): InferredJourney {
        const homePages = session.pages.filter(p => {
            if (!p || !p.url) return false;
            const path = new URL(p.url).pathname.toLowerCase();
            return path === '' || path === '/';
        });

        const pageSequence = [
            ...(homePages.length > 0 ? [homePages[0].url] : []),
            ...pageClassification.searchPages.slice(0, 2),
            ...pageClassification.productPages.slice(0, 2),
        ];

        return {
            id: `journey_product_discovery_${Date.now()}`,
            name: 'Product Discovery & Browse',
            description:
                'Users visit the homepage, use search functionality, filter/navigate products, and view product details',
            pageSequence: [...new Set(pageSequence)],
            elementPatterns: ['search-form', 'product-cards', 'filter-buttons', 'navigation-links'],
            signals: {
                semanticSignals: [
                    'hasProductElements',
                    'hasSearchElements',
                    'hasNavigationElements',
                ],
                urlPatterns: ['homepage', 'search', 'products'],
                elementPresence: {},
            },
            confidence: 85,
            tags: ['product', 'discovery', 'navigation', 'search'],
        };
    }

    /**
     * Build Checkout journey
     */
    private static buildCheckoutJourney(
        session: CrawlSession,
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): InferredJourney {
        const pageSequence: string[] = [
            ...pageClassification.productPages.slice(0, 1),
            ...(pageClassification.cartPage ? [pageClassification.cartPage] : []),
            ...(pageClassification.checkoutPage ? [pageClassification.checkoutPage] : []),
        ];

        return {
            id: `journey_checkout_${Date.now()}`,
            name: 'Shopping & Checkout',
            description:
                'Users browse products, add items to cart, navigate to cart page, and complete checkout process',
            pageSequence: pageSequence.filter((v, i) => pageSequence.indexOf(v) === i),
            elementPatterns: [
                'add-to-cart-buttons',
                'cart-page',
                'checkout-form',
                'payment-options',
            ],
            signals: {
                semanticSignals: ['hasProductElements', 'hasCheckoutElements'],
                urlPatterns: pageClassification.cartPage
                    ? ['products', 'cart']
                    : ['products', 'checkout'],
                elementPresence: {},
            },
            confidence: 80,
            tags: ['ecommerce', 'checkout', 'payment', 'cart'],
        };
    }

    /**
     * Build Account Management journey
     */
    private static buildAccountJourney(
        session: CrawlSession,
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): InferredJourney {
        const pageSequence: string[] = [
            ...(pageClassification.accountPage ? [pageClassification.accountPage] : []),
            ...(pageClassification.ordersPage ? [pageClassification.ordersPage] : []),
        ];

        return {
            id: `journey_account_${Date.now()}`,
            name: 'Account Management',
            description:
                'Users navigate to orders section, view order history, and manage account preferences',
            pageSequence: pageSequence.filter((v, i) => pageSequence.indexOf(v) === i),
            elementPatterns: ['account-links', 'order-history', 'settings-panels'],
            signals: {
                semanticSignals: ['hasAccountElements'],
                urlPatterns: pageClassification.ordersPage
                    ? ['account', 'orders']
                    : ['account', 'profile'],
                elementPresence: {},
            },
            confidence: 75,
            tags: ['account', 'user', 'orders', 'management'],
        };
    }

    /**
     * Build Deal & Offer Exploration journey
     */
    private static buildDealJourney(
        session: CrawlSession,
        signals: ReturnType<typeof this.analyzeSemanticSignals>,
        pageClassification: ReturnType<typeof this.classifyPagesByURL>
    ): InferredJourney {
        const homePages = session.pages.filter(p => {
            if (!p || !p.url) return false;
            const path = new URL(p.url).pathname.toLowerCase();
            return path === '' || path === '/';
        });

        const pageSequence = [
            ...(homePages.length > 0 ? [homePages[0].url] : []),
            ...(pageClassification.offersPage ? [pageClassification.offersPage] : []),
        ];

        return {
            id: `journey_deals_${Date.now()}`,
            name: 'Deal & Offer Exploration',
            description:
                'Users access offers section, view promotions, and apply coupons/deals',
            pageSequence: pageSequence.filter((v, i) => pageSequence.indexOf(v) === i),
            elementPatterns: ['offer-links', 'coupon-buttons', 'promotion-cards'],
            signals: {
                semanticSignals: ['hasOfferElements'],
                urlPatterns: ['homepage', 'offers'],
                elementPresence: {},
            },
            confidence: 75,
            tags: ['offers', 'deals', 'promotions', 'coupons'],
        };
    }

    // ===== Element Indicator Methods =====

    private static isProductIndicator(
        element: HighIntentElement,
        text: string,
        className: string
    ): boolean {
        // Product card containers
        if (className.includes('product') || className.includes('item-card')) {
            return true;
        }

        // Product-related text
        if (text.includes('add to cart') || text.includes('product') || text.includes('item')) {
            return true;
        }

        // Product price indicators
        if (element.tag === 'span' && /\$\d+/.test(element.text || '')) {
            return true;
        }

        // Product links
        if (element.tag === 'a' && (text.includes('product') || text.includes('view'))) {
            return true;
        }

        return false;
    }

    private static isCheckoutIndicator(element: HighIntentElement, text: string): boolean {
        const checkoutKeywords = [
            'add to cart',
            'cart',
            'checkout',
            'payment',
            'pay now',
            'proceed',
            'purchase',
            'buy',
        ];
        return checkoutKeywords.some(kw => text.includes(kw));
    }

    private static isAuthIndicator(element: HighIntentElement, text: string): boolean {
        const authKeywords = ['login', 'signin', 'signup', 'register', 'password', 'email'];
        return authKeywords.some(kw => text.includes(kw));
    }

    private static isSearchIndicator(
        element: HighIntentElement,
        text: string,
        className: string
    ): boolean {
        if (className.includes('search')) {
            return true;
        }

        const searchKeywords = ['search', 'filter', 'find', 'query'];
        if (searchKeywords.some(kw => text.includes(kw))) {
            return true;
        }

        if (
            element.tag === 'input' &&
            (element.attributes?.type === 'search' || element.attributes?.placeholder?.includes('search'))
        ) {
            return true;
        }

        return false;
    }

    private static isNavigationIndicator(element: HighIntentElement, text: string): boolean {
        const navKeywords = [
            'home',
            'category',
            'categories',
            'menu',
            'nav',
            'browse',
            'shop',
        ];
        return navKeywords.some(kw => text.includes(kw));
    }

    private static isAccountIndicator(element: HighIntentElement, text: string): boolean {
        const accountKeywords = [
            'account',
            'profile',
            'my account',
            'orders',
            'order',
            'settings',
            'preferences',
            'dashboard',
            // Credential entry and auth actions are the clearest account
            // signal a page can carry, and were previously ignored.
            'sign in',
            'signin',
            'sign up',
            'signup',
            'log in',
            'login',
            'log out',
            'logout',
            'register',
            'username',
            'password',
            'email address',
        ];
        return accountKeywords.some(kw => text.includes(kw));
    }

    private static isDealIndicator(element: HighIntentElement, text: string): boolean {
        const dealKeywords = [
            'offer',
            'deal',
            'promotion',
            'coupon',
            'discount',
            'sale',
            'special',
        ];
        return dealKeywords.some(kw => text.includes(kw));
    }
}
