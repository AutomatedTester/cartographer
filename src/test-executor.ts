import { WebDriver } from "selenium-webdriver";
import { GeneratedTestCase, TestExecutionResult, TestExecutionSummary, SemanticToolSchema } from "./types.js";
import { SemanticHandlerGenerator } from "./webmcp-semantic-handlers.js";

/**
 * How a single test ended.
 * - passed / failed: the tool ran and the site behaved (or did not).
 * - skipped: deliberately not run (e.g. destructive actions).
 * - handler-error: Cartographer could not attach a handler for the element,
 *   so the site was never exercised. This is a Cartographer limitation, not
 *   a site failure, and is reported apart from failures.
 */
export type TestOutcome = "passed" | "failed" | "skipped" | "handler-error";

export interface ExecutedTestResult extends TestExecutionResult {
  status: TestOutcome;
}

export interface ExecutedTestSummary extends TestExecutionSummary {
  results: ExecutedTestResult[];
  /** Tests not run on purpose; they are not counted as passed or failed. */
  skippedTests: number;
  /** Tests that could not run because no handler was attached. */
  handlerErrors: number;
}

export interface TestExecutorOptions {
  /**
   * Reload the start URL and re-register the semantic tool handlers before
   * every test (default true). Handlers live in page JavaScript, so any test
   * that navigates or submits a form wipes them for every later test.
   * Reloading also stops one test's side effects leaking into the next.
   */
  resetBetweenTests?: boolean;
  /** Run tests tagged destructive (delete actions). Default false. */
  includeDestructive?: boolean;
}

export const HANDLER_NOT_ATTACHED = "HANDLER_NOT_ATTACHED";

/**
 * TestExecutor orchestrates the execution of generated tests in the browser.
 * Tests call semantic webmcp tools and report results back to the MCP layer.
 */
export class TestExecutor {
  private driver: WebDriver;
  private options: Required<TestExecutorOptions>;

  constructor(driver: WebDriver, options: TestExecutorOptions = {}) {
    this.driver = driver;
    this.options = {
      resetBetweenTests: options.resetBetweenTests ?? true,
      includeDestructive: options.includeDestructive ?? false,
    };
  }

  /** True for tests whose action would destroy data on the site. */
  static isDestructive(test: GeneratedTestCase): boolean {
    return test.actionType === "delete" || (test.tags || []).includes("destructive");
  }

  /**
   * Execute all critical tests in the browser
   * @param tests Array of generated test cases (critical only)
   * @param semanticTools Array of semantic tool schemas
   * @param url The page every test starts from
   * @param retryCount How many more times to run a test that fails
   * @returns Aggregated test execution results
   */
  async executeTests(
    tests: GeneratedTestCase[],
    semanticTools: SemanticToolSchema[],
    url: string,
    retryCount = 0
  ): Promise<ExecutedTestSummary> {
    const startTime = Date.now();
    const results: ExecutedTestResult[] = [];

    // Filter to only critical tests that have a semantic tool assigned
    const criticalTests = tests.filter((t) => t.priority === "critical" && t.semanticTool);
    const runnable = criticalTests.filter(
      (t) => this.options.includeDestructive || !TestExecutor.isDestructive(t)
    );

    // Register handlers under exactly the names the test cases reference,
    // built from the elements the tests were generated from. This avoids any
    // dependence on a second crawl naming tools the same way.
    const handlerCode = SemanticHandlerGenerator.generateHandlerCodeForTools(
      runnable
        .filter((t) => t.sourceElement)
        .map((t) => ({ element: t.sourceElement, toolName: t.semanticTool as string }))
    );

    for (const test of criticalTests) {
      if (!runnable.includes(test)) {
        results.push({
          testId: test.id,
          toolName: test.semanticTool as string,
          success: false,
          status: "skipped",
          message:
            "Skipped: destructive action (delete). Not run by default so the site's data is left untouched.",
          duration: 0,
        });
        continue;
      }

      let result = await this.runOnce(test, url, handlerCode);
      for (let retry = 0; result.status === "failed" && retry < retryCount; retry++) {
        result = await this.runOnce(test, url, handlerCode);
      }
      results.push(result);
    }

    const totalDuration = Date.now() - startTime;
    const count = (status: TestOutcome) => results.filter((r) => r.status === status).length;

    return {
      url,
      totalTests: results.length,
      passedTests: count("passed"),
      failedTests: count("failed"),
      skippedTests: count("skipped"),
      handlerErrors: count("handler-error"),
      results,
      totalDuration,
      semanticTools,
    };
  }

  /** Reset the page (if enabled) and run one test. */
  private async runOnce(
    test: GeneratedTestCase,
    url: string,
    handlerCode: string
  ): Promise<ExecutedTestResult> {
    if (this.options.resetBetweenTests) {
      try {
        await this.driver.get(url);
        await this.driver.executeScript(handlerCode);
      } catch (error) {
        return {
          testId: test.id,
          toolName: test.semanticTool as string,
          success: false,
          status: "handler-error",
          message: `Cartographer could not prepare the page for this test (reloading ${url} and attaching handlers failed). This is not a failure in the site.`,
          duration: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return this.executeTest(test);
  }

  /**
   * Execute a single test by calling its semantic tool
   */
  private async executeTest(test: GeneratedTestCase): Promise<ExecutedTestResult> {
    const toolName = test.semanticTool;
    if (!toolName) {
      return {
        testId: test.id,
        toolName: "unknown",
        success: false,
        status: "handler-error",
        message: "Test does not have an assigned semantic tool",
        duration: 0,
        error: "Missing semanticTool property",
      };
    }

    const startTime = performance.now();
    // Tag the current document so we can tell afterwards whether the tool's
    // action replaced it (a link click or form submit). When that happens the
    // in-flight script is torn down and Selenium either rejects the call or
    // re-evaluates it on the new page, where the handler no longer exists and
    // it reports "Tool not found". Neither is a site failure.
    const docToken = `cartographer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await this.markDocument(docToken);

    let result: ToolResult | undefined;
    let thrown: unknown;
    try {
      // Call the semantic tool in the browser context
      result = await this.driver.executeScript<ToolResult>(
        `
        return new Promise(async (resolve) => {
          try {
            const toolName = arguments[0];
            if (!navigator.webmcp || !navigator.webmcp.tools || !navigator.webmcp.tools[toolName]) {
              resolve({
                success: false,
                message: "Tool not found: " + toolName,
                duration: 0,
                error: ${JSON.stringify(HANDLER_NOT_ATTACHED)}
              });
              return;
            }

            const result = await navigator.webmcp.tools[toolName]();
            resolve(result);
          } catch (error) {
            resolve({
              success: false,
              message: error instanceof Error ? error.message : String(error),
              duration: 0,
              error: String(error)
            });
          }
        });
      `,
        toolName
      );
    } catch (error) {
      thrown = error;
    }

    const duration = Math.round(performance.now() - startTime);
    const base = { testId: test.id, toolName, duration };

    if (result?.success) {
      return { ...base, success: true, status: "passed", message: result.message, error: result.error };
    }

    // The action replaced the page: the site responded, so it passed.
    if (!(await this.isSameDocument(docToken))) {
      const landedOn = await this.currentUrl();
      return {
        ...base,
        success: true,
        status: "passed",
        message: landedOn ? `Page navigated to ${landedOn}` : "Page navigated",
      };
    }

    if (thrown !== undefined) {
      return {
        ...base,
        success: false,
        status: "failed",
        message: `Test execution failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        error: thrown instanceof Error ? thrown.stack : String(thrown),
      };
    }

    if (!result || result.error === HANDLER_NOT_ATTACHED) {
      return {
        ...base,
        success: false,
        status: "handler-error",
        message: `Cartographer could not attach a handler for this element (tool "${toolName}", locator ${test.locator}). The element was not exercised; this is not a failure in the site.`,
        error: HANDLER_NOT_ATTACHED,
      };
    }

    return { ...base, success: false, status: "failed", message: result.message, error: result.error };
  }

  private async markDocument(token: string): Promise<void> {
    try {
      await this.driver.executeScript("window.__cartographerDocToken = arguments[0];", token);
    } catch {
      // Best effort: if tagging fails, isSameDocument() cannot prove a
      // navigation and the tool's own result decides the outcome.
    }
  }

  /** False only when we can see the tagged document was replaced. */
  private async isSameDocument(token: string): Promise<boolean> {
    try {
      const current = await this.driver.executeScript<unknown>(
        "return typeof window.__cartographerDocToken === 'string' ? window.__cartographerDocToken : null;"
      );
      // null means the tag is gone: a new document. A string that is not our
      // token would mean another run re-tagged it; anything else (a test
      // double returning undefined) is treated as unknown, i.e. the same page.
      return current === null ? false : typeof current !== "string" || current === token;
    } catch {
      return true;
    }
  }

  private async currentUrl(): Promise<string | undefined> {
    try {
      return await this.driver.getCurrentUrl();
    } catch {
      return undefined;
    }
  }

  /**
   * Verify that semantic tools are registered in the browser
   */
  async verifyToolsRegistered(): Promise<string[]> {
    try {
      const registeredTools = await this.driver.executeScript<string[]>(
        `return navigator.webmcp?.registeredTools || [];`
      );
      return registeredTools || [];
    } catch {
      return [];
    }
  }
}

type ToolResult = { success: boolean; message: string; duration: number; error?: string };
