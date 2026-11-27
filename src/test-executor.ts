import { WebDriver } from "selenium-webdriver";
import { GeneratedTestCase, TestExecutionResult, TestExecutionSummary, SemanticToolSchema } from "./types.js";

/**
 * TestExecutor orchestrates the execution of generated tests in the browser.
 * Tests call semantic webmcp tools and report results back to the MCP layer.
 */
export class TestExecutor {
  private driver: WebDriver;

  constructor(driver: WebDriver) {
    this.driver = driver;
  }

  /**
   * Execute all critical tests in the browser
   * @param tests Array of generated test cases (critical only)
   * @param semanticTools Array of semantic tool schemas
   * @param retryCount How many more times to run a test that fails
   * @returns Aggregated test execution results
   */
  async executeTests(
    tests: GeneratedTestCase[],
    semanticTools: SemanticToolSchema[],
    url: string,
    retryCount = 0
  ): Promise<TestExecutionSummary> {
    const startTime = Date.now();
    const results: TestExecutionResult[] = [];

    // Filter to only critical tests that have a semantic tool assigned
    const criticalTests = tests.filter((t) => t.priority === "critical" && t.semanticTool);

    for (const test of criticalTests) {
      let result = await this.executeTest(test);
      for (let retry = 0; !result.success && retry < retryCount; retry++) {
        result = await this.executeTest(test);
      }
      results.push(result);
    }

    const totalDuration = Date.now() - startTime;
    const passedTests = results.filter((r) => r.success).length;
    const failedTests = results.filter((r) => !r.success).length;

    return {
      url,
      totalTests: results.length,
      passedTests,
      failedTests,
      results,
      totalDuration,
      semanticTools,
    };
  }

  /**
   * Execute a single test by calling its semantic tool
   */
  private async executeTest(test: GeneratedTestCase): Promise<TestExecutionResult> {
    const toolName = test.semanticTool;
    if (!toolName) {
      return {
        testId: test.id,
        toolName: "unknown",
        success: false,
        message: "Test does not have an assigned semantic tool",
        duration: 0,
        error: "Missing semanticTool property",
      };
    }

    try {
      const startTime = performance.now();

      // Call the semantic tool in the browser context
      const result = await this.driver.executeScript<{
        success: boolean;
        message: string;
        duration: number;
        error?: string;
      }>(
        `
        return new Promise(async (resolve) => {
          try {
            const toolName = arguments[0];
            if (!navigator.webmcp || !navigator.webmcp.tools || !navigator.webmcp.tools[toolName]) {
              resolve({
                success: false,
                message: "Tool not found: " + toolName,
                duration: 0,
                error: "Tool not registered"
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

      const duration = Math.round(performance.now() - startTime);

      return {
        testId: test.id,
        toolName,
        success: result.success,
        message: result.message,
        duration,
        error: result.error,
      };
    } catch (error) {
      return {
        testId: test.id,
        toolName,
        success: false,
        message: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
        duration: 0,
        error: error instanceof Error ? error.stack : String(error),
      };
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
