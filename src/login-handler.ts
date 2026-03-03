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
            // Look for password input first (most likely to exist)
            try {
                const passwordInputs = await this.driver.findElements(
                    By.css('input[type="password"]')
                );

                if (passwordInputs && passwordInputs.length > 0) {
                    fields.push({
                        type: 'password',
                        selector: 'input[type="password"]',
                        element: passwordInputs[0],
                    });
                }
            } catch (e) {
                // Continue to next selector
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

            for (const selector of usernameSelectors) {
                try {
                    const elements = await this.driver.findElements(By.css(selector));
                    if (elements && elements.length > 0) {
                        if (!fields.some((f) => f.type === 'username')) {
                            fields.unshift({
                                type: 'username',
                                selector,
                                element: elements[0],
                            });
                            break;
                        }
                    }
                } catch (selectorError) {
                    // Continue to next selector
                }
            }

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
            if (buttons && buttons.length > 0) {
                for (const button of buttons) {
                    const text = await button.getAttribute('value');
                    if (text && text.toLowerCase().includes('login')) {
                        return button;
                    }
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
            const fields = await this.findLoginFields();

            if (fields.length === 0) {
                throw new Error('No login form fields found');
            }

            // Fill username field
            const usernameField = fields.find((f) => f.type === 'username');
            if (usernameField && usernameField.element) {
                try {
                    await usernameField.element.clear();
                    await usernameField.element.sendKeys(username);
                } catch (fillError) {
                    console.error('[login-handler] Error filling username field:', fillError);
                    throw fillError;
                }
            } else {
                // If no specific username field, fill first text input before password
                const allInputs = await this.driver.findElements(By.css('input[type="text"], input[type="email"], input:not([type="password"])'));
                if (allInputs && allInputs.length > 0) {
                    try {
                        await allInputs[0].clear();
                        await allInputs[0].sendKeys(username);
                    } catch (fallbackError) {
                        console.error('[login-handler] Error filling fallback input:', fallbackError);
                        throw fallbackError;
                    }
                } else {
                    throw new Error('No username input field found');
                }
            }

            // Fill password field
            const passwordField = fields.find((f) => f.type === 'password');
            if (passwordField && passwordField.element) {
                try {
                    await passwordField.element.clear();
                    await passwordField.element.sendKeys(password);
                } catch (fillError) {
                    console.error('[login-handler] Error filling password field:', fillError);
                    throw fillError;
                }
            } else {
                throw new Error('Password field not found');
            }
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
            const submitButton = await this.findSubmitButton();

            if (!submitButton) {
                // Try submitting the form directly
                const forms = await this.driver.findElements(By.css('form'));
                if (forms && forms.length > 0) {
                    await this.driver.executeScript('arguments[0].submit();', forms[0]);
                    return;
                }
                throw new Error('No submit button or form found');
            }

            await submitButton.click();
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
            // Wait for document ready state
            await this.driver.wait(
                async () => {
                    const readyState = await this.driver.executeScript(
                        'return document.readyState'
                    );
                    return readyState === 'complete';
                },
                timeoutMs
            );

            // Additional wait for network to be idle (simple heuristic)
            await this.driver.sleep(1000);
        } catch (error) {
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
            // Wait for redirect
            await this.driver.wait(
                async () => {
                    const currentUrl = await this.driver.getCurrentUrl();
                    return currentUrl !== originalUrl;
                },
                maxWaitTime
            ).catch(() => {
                // Timeout is OK - page might have changed without URL changing
            });

            const currentUrl = await this.driver.getCurrentUrl();

            // Check for logout button/link
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
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }

            // Check for profile/user elements
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
                        break;
                    }
                } catch (e) {
                    // Continue
                }
            }

            // Check if login form is still visible
            const loginFormFields = await this.findLoginFields();
            const loginFormStillVisible = loginFormFields.length > 0;

            // Determine success based on multiple indicators
            const urlChanged = currentUrl !== originalUrl;
            const isNotOnLoginPage = !currentUrl.includes('/login') && !currentUrl.includes('/signin');

            const success = (hasLogoutButton || hasProfileElement || urlChanged) && !loginFormStillVisible;

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

            // Find fields first to verify they exist
            console.error('[login-handler] Step 1: Finding login form fields...');
            const fields = await this.findLoginFields();
            console.error('[login-handler] Found ' + fields.length + ' fields: ' + fields.map(f => f.type).join(', '));

            if (fields.length === 0) {
                console.error('[login-handler] ❌ ERROR: No login form fields found! Cannot proceed with login.');
                return {
                    success: false,
                    reason: 'No login form fields found on page',
                    currentUrl: await this.driver.getCurrentUrl(),
                };
            }

            // Fill and submit
            console.error('[login-handler] Step 2: Filling login form with credentials...');
            await this.fillLoginForm(username, password);

            console.error('[login-handler] Step 3: Submitting login form...');
            await this.submitForm();

            console.error('[login-handler] Step 4: Waiting for page load...');
            await this.waitForPageLoad();

            // Validate
            console.error('[login-handler] Step 5: Validating login success...');
            const result = await this.validateLoginSuccess(url, options);
            console.error('[login-handler] ============================================');
            console.error('[login-handler] 📊 LOGIN VALIDATION RESULT');
            console.error('[login-handler] Success:', result.success);
            console.error('[login-handler] Reason:', result.reason);
            console.error('[login-handler] New URL:', result.currentUrl);
            console.error('[login-handler] ============================================');

            return result;
        } catch (error) {
            console.error('[login-handler] Error in login flow:', error instanceof Error ? error.message : String(error));
            return {
                success: false,
                reason: `Login flow failed: ${error instanceof Error ? error.message : String(error)}`,
                currentUrl: await this.driver.getCurrentUrl().catch(() => 'unknown'),
            };
        }
    }
}
