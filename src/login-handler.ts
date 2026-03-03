import { WebDriver, until, By, logging } from 'selenium-webdriver';

/**
 * Options for login validation
 */
export interface LoginValidationOptions {
    /** Maximum time to wait for page transition after login (ms) */
    maxWaitTime?: number;
    /** Log errors and warnings */
    verbose?: boolean;
}

/**
 * Result of login validation
 */
export interface LoginValidationResult {
    /** Whether login was successful */
    success: boolean;
    /** Reason for success or failure */
    reason: string;
    /** Current URL after login */
    currentUrl: string;
    /** Whether page has logout indicator */
    hasLogoutButton?: boolean;
    /** Whether page has user profile indicator */
    hasProfileElement?: boolean;
    /** Whether login form is still visible */
    loginFormStillVisible?: boolean;
}

/**
 * LoginHandler manages form filling, submission, and validation
 * of login flows during multi-page crawling.
 */
export class LoginHandler {
    private driver: WebDriver;

    constructor(driver: WebDriver) {
        this.driver = driver;
    }

    /**
     * Find login form fields (username and password inputs)
     * @returns Array of field info with selectors
     */
    async findLoginFields(): Promise<
        Array<{ type: 'username' | 'password'; selector: string; element: any }>
    > {
        const fields: Array<{ type: 'username' | 'password'; selector: string; element: any }> = [];

        try {
            console.error('[login-handler] 🔍 Searching for login form fields...');
            
            // Look for password input first (most likely to exist)
            const passwordInputs = await this.driver.findElements(
                By.css('input[type="password"]')
            );

            if (passwordInputs.length > 0) {
                console.error('[login-handler] ✅ Found ' + passwordInputs.length + ' password input(s)');
                fields.push({
                    type: 'password',
                    selector: 'input[type="password"]',
                    element: passwordInputs[0],
                });
            } else {
                console.error('[login-handler] ❌ No password input found');
            }

            // Look for username/email input
            // Check for common IDs and names
            const usernameSelectors = [
                'input[type="email"]',
                'input[name="username"]',
                'input[name="user"]',
                'input[name="email"]',
                'input[id*="username"]',
                'input[id*="email"]',
                'input[placeholder*="username" i]',
                'input[placeholder*="email" i]',
                'input[autocomplete="username"]',
            ];

            console.error('[login-handler] Trying username selectors...');
            for (const selector of usernameSelectors) {
                const elements = await this.driver.findElements(By.css(selector));
                if (elements.length > 0) {
                    console.error('[login-handler] ✅ Found ' + elements.length + ' element(s) with selector: ' + selector);
                    if (!fields.some((f) => f.type === 'username')) {
                        fields.unshift({
                            type: 'username',
                            selector,
                            element: elements[0],
                        });
                        break;
                    }
                }
            }

            if (!fields.some(f => f.type === 'username')) {
                console.error('[login-handler] ❌ No username input found');
            }

            console.error('[login-handler] Found ' + fields.length + ' total login fields');
            return fields;
        } catch (error) {
            console.error('[login-handler] Error finding login fields:', error);
            return fields;
        }
    }

    /**
     * Find submit button (form submit or login button)
     */
    async findSubmitButton(): Promise<any> {
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:contains("Login")',
            'button:contains("Sign In")',
            'button:contains("Log In")',
            'button[class*="submit" i]',
            'button[class*="login" i]',
            'button[class*="signin" i]',
            'button:has-text("Login")',
            'button:has-text("Sign In")',
        ];

        for (const selector of submitSelectors) {
            try {
                const elements = await this.driver.findElements(By.css(selector));
                if (elements.length > 0) {
                    return elements[0];
                }
            } catch (e) {
                // Continue to next selector
            }
        }

        // Fallback: find any button in a form with login in its text
        try {
            const buttons = await this.driver.findElements(By.css('form button, form input[type="submit"]'));
            for (const button of buttons) {
                const text = await button.getAttribute('value');
                if (text && text.toLowerCase().includes('login')) {
                    return button;
                }
            }
        } catch (e) {
            // Continue
        }

        return null;
    }

    /**
     * Fill login form with provided credentials
     */
    async fillLoginForm(username: string, password: string): Promise<void> {
        try {
            console.error('[login-handler] 📝 Starting to fill login form...');
            console.error('[login-handler] Username: ' + username.substring(0, 3) + '***');
            console.error('[login-handler] Password: ' + '*'.repeat(password.length));

            const fields = await this.findLoginFields();

            if (fields.length === 0) {
                throw new Error('No login form fields found');
            }

            // Fill username field
            const usernameField = fields.find((f) => f.type === 'username');
            if (usernameField) {
                console.error('[login-handler] 🔤 Filling username field...');
                await usernameField.element.clear();
                console.error('[login-handler]   Cleared field');
                await usernameField.element.sendKeys(username);
                console.error('[login-handler]   ✅ Sent username to field');
            } else {
                // If no specific username field, fill first text input before password
                console.error('[login-handler] ⚠️  No specific username field, searching for fallback...');
                const allInputs = await this.driver.findElements(By.css('input[type="text"], input[type="email"], input:not([type="password"])'));
                if (allInputs.length > 0) {
                    console.error('[login-handler] Found ' + allInputs.length + ' fallback inputs, using first...');
                    await allInputs[0].clear();
                    await allInputs[0].sendKeys(username);
                    console.error('[login-handler] ✅ Filled fallback input with username');
                } else {
                    console.error('[login-handler] ❌ No username or fallback input found!');
                }
            }

            // Fill password field
            const passwordField = fields.find((f) => f.type === 'password');
            if (passwordField) {
                console.error('[login-handler] 🔐 Filling password field...');
                await passwordField.element.clear();
                console.error('[login-handler]   Cleared field');
                await passwordField.element.sendKeys(password);
                console.error('[login-handler]   ✅ Sent password to field');
            } else {
                throw new Error('Password field not found');
            }

            console.error('[login-handler] ✅ Form filled with credentials');
        } catch (error) {
            console.error('[login-handler] ❌ Error filling login form:', error);
            throw error;
        }
    }

    /**
     * Submit the login form
     */
    async submitForm(): Promise<void> {
        try {
            console.error('[login-handler] 🔘 Looking for submit button...');
            const submitButton = await this.findSubmitButton();

            if (!submitButton) {
                console.error('[login-handler] ⚠️  No submit button found, trying to submit form via JavaScript...');
                // Try submitting the form directly
                const forms = await this.driver.findElements(By.css('form'));
                if (forms.length > 0) {
                    console.error('[login-handler] Found ' + forms.length + ' form(s), submitting first...');
                    await this.driver.executeScript('arguments[0].submit();', forms[0]);
                    console.error('[login-handler] ✅ Submitted form via JavaScript');
                    return;
                }
                throw new Error('No submit button or form found');
            }

            console.error('[login-handler] ✅ Found submit button, clicking it...');
            await submitButton.click();
            console.error('[login-handler] ✅ Clicked submit button');
        } catch (error) {
            console.error('[login-handler] Error submitting form:', error);
            throw error;
        }
    }

    /**
     * Wait for page to load and stabilize after form submission
     */
    async waitForPageLoad(timeoutMs: number = 30000): Promise<void> {
        try {
            console.error('[login-handler] ⏳ Waiting for document.readyState === "complete" (timeout: ' + timeoutMs + 'ms)...');
            // Wait for document ready state
            await this.driver.wait(
                async () => {
                    const readyState = await this.driver.executeScript(
                        'return document.readyState'
                    );
                    console.error('[login-handler]   readyState:', readyState);
                    return readyState === 'complete';
                },
                timeoutMs
            );

            console.error('[login-handler] ✅ Document ready, waiting 1s for network to stabilize...');
            // Additional wait for network to be idle (simple heuristic)
            await this.driver.sleep(1000);
            console.error('[login-handler] ✅ Page loaded successfully');
        } catch (error) {
            console.error('[login-handler] ⚠️  Timeout waiting for page load:', error);
            // Don't throw - page might be loaded even if this times out
        }
    }

    /**
     * Validate whether login was successful
     */
    async validateLoginSuccess(
        originalUrl: string,
        options?: LoginValidationOptions
    ): Promise<LoginValidationResult> {
        const maxWaitTime = options?.maxWaitTime ?? 10000;
        const verbose = options?.verbose ?? false;

        try {
            console.error('[login-handler] 🔍 Validating login success...');
            
            // Wait for redirect
            console.error('[login-handler]   Checking for URL change (timeout: ' + maxWaitTime + 'ms)...');
            await this.driver.wait(
                async () => {
                    const currentUrl = await this.driver.getCurrentUrl();
                    return currentUrl !== originalUrl;
                },
                maxWaitTime
            ).catch(() => {
                // Timeout is OK - page might have changed without URL changing
                if (verbose) console.error('[login-handler]   ⚠️  No URL change detected');
            });

            const currentUrl = await this.driver.getCurrentUrl();
            console.error('[login-handler]   Current URL: ' + currentUrl);

            // Check for logout button/link
            console.error('[login-handler]   Checking for logout indicators...');
            const logoutIndicators = [
                'a:contains("Logout")',
                'a:contains("Log out")',
                'button:contains("Logout")',
                'button:contains("Log out")',
                'a[href*="logout"]',
                'a[href*="signout"]',
                'button[class*="logout" i]',
                'button[class*="signout" i]',
            ];

            let hasLogoutButton = false;
            for (const selector of logoutIndicators) {
                try {
                    const elements = await this.driver.findElements(By.css(selector));
                    if (elements.length > 0) {
                        hasLogoutButton = true;
                        console.error('[login-handler]   ✅ Found logout button with selector: ' + selector);
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }
            if (!hasLogoutButton) console.error('[login-handler]   ❌ No logout button found');

            // Check for profile/user elements
            console.error('[login-handler]   Checking for profile indicators...');
            const profileIndicators = [
                '[class*="profile" i]',
                '[class*="user-menu" i]',
                '[class*="account" i]',
                '[data-testid*="profile" i]',
                'span:contains("Welcome")',
            ];

            let hasProfileElement = false;
            for (const selector of profileIndicators) {
                try {
                    const elements = await this.driver.findElements(By.css(selector));
                    if (elements.length > 0) {
                        hasProfileElement = true;
                        console.error('[login-handler]   ✅ Found profile element with selector: ' + selector);
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }
            if (!hasProfileElement) console.error('[login-handler]   ❌ No profile element found');

            // Check if login form is still visible
            console.error('[login-handler]   Checking if login form is still visible...');
            const loginFormFields = await this.findLoginFields();
            const loginFormStillVisible = loginFormFields.length > 0;
            if (loginFormStillVisible) {
                console.error('[login-handler]   ❌ Login form still visible (' + loginFormFields.length + ' fields)');
            } else {
                console.error('[login-handler]   ✅ Login form is gone');
            }

            // Determine success based on multiple indicators
            const urlChanged = currentUrl !== originalUrl;
            const isNotOnLoginPage = !currentUrl.includes('/login') && !currentUrl.includes('/signin');
            
            console.error('[login-handler]   Summary: urlChanged=' + urlChanged + ', logoutBtn=' + hasLogoutButton + ', profile=' + hasProfileElement + ', formVisible=' + loginFormStillVisible);

            const success = (hasLogoutButton || hasProfileElement || urlChanged) && !loginFormStillVisible;
            
            if (success) {
                console.error('[login-handler] ✅ Login SUCCESSFUL');
            } else {
                console.error('[login-handler] ❌ Login FAILED or INCONCLUSIVE');
            }

            return {
                success,
                reason: success
                    ? 'Login successful: URL changed and/or logged-in indicators found'
                    : `Login validation inconclusive: URL changed=${urlChanged}, logout button=${hasLogoutButton}, profile element=${hasProfileElement}, login form still visible=${loginFormStillVisible}`,
                currentUrl,
                hasLogoutButton,
                hasProfileElement,
                loginFormStillVisible,
            };
        } catch (error) {
            console.error('[login-handler] Error validating login success:', error);
            return {
                success: false,
                reason: `Error validating login: ${error instanceof Error ? error.message : String(error)}`,
                currentUrl: await this.driver.getCurrentUrl(),
            };
        }
    }

    /**
     * Complete login flow: fill form, submit, and validate
     */
    async performLogin(
        username: string,
        password: string,
        originalUrl?: string,
        options?: LoginValidationOptions
    ): Promise<LoginValidationResult> {
        const url = originalUrl ?? (await this.driver.getCurrentUrl());

        try {
            console.error('[login-handler] ============================================');
            console.error('[login-handler] 🔐 STARTING LOGIN FLOW');
            console.error('[login-handler] Original URL:', url);
            console.error('[login-handler] Username: ' + username.substring(0, 3) + '***');
            console.error('[login-handler] ============================================');

            // Fill and submit
            await this.fillLoginForm(username, password);
            await this.submitForm();
            await this.waitForPageLoad();

            // Validate
            const result = await this.validateLoginSuccess(url, options);
            console.error('[login-handler] ============================================');
            console.error('[login-handler] 📊 LOGIN VALIDATION RESULT');
            console.error('[login-handler] Success:', result.success);
            console.error('[login-handler] Reason:', result.reason);
            console.error('[login-handler] New URL:', result.currentUrl);
            console.error('[login-handler] ============================================');

            return result;
        } catch (error) {
            console.error('[login-handler] ============================================');
            console.error('[login-handler] ❌ ERROR IN LOGIN FLOW');
            console.error('[login-handler] Error:', error instanceof Error ? error.message : error);
            console.error('[login-handler] ============================================');
            return {
                success: false,
                reason: `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
                currentUrl: await this.driver.getCurrentUrl(),
            };
        }
    }
}
