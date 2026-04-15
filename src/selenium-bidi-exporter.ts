import { GeneratedTestCase } from "./types.js";

export type SeleniumBiDiLanguage = "java" | "python" | "typescript" | "ruby" | "csharp";

/**
 * Exports generated test cases as Selenium WebDriver BiDi code snippets.
 * Uses existing locally generated test metadata to avoid additional model/token usage.
 */
export class SeleniumBiDiExporter {
  static export(
    testCases: GeneratedTestCase[],
    language: SeleniumBiDiLanguage,
    url: string
  ): string {
    switch (language) {
      case "java":
        return this.exportJava(testCases, url);
      case "python":
        return this.exportPython(testCases, url);
      case "ruby":
        return this.exportRuby(testCases, url);
      case "csharp":
        return this.exportCSharp(testCases, url);
      case "typescript":
      default:
        return this.exportTypeScript(testCases, url);
    }
  }

  private static exportTypeScript(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generateTypeScriptTest(tc)).join("\n\n");
    return `import { Builder, By } from "selenium-webdriver";

(async function run() {
  const driver = await new Builder().forBrowser("chrome").build();
  const browsingContext = await driver.createBrowserContext();
  const bidi = await driver.getBidi();

  try {
    await driver.get("${url}");

${this.indent(tests, 4)}
  } finally {
    await bidi.session.end();
    await driver.quit();
  }
})();`;
  }

  private static exportPython(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generatePythonTest(tc)).join("\n\n");
    return `from selenium import webdriver
from selenium.webdriver.common.by import By

driver = webdriver.Chrome()
bidi = driver.bidi_connection()

try:
    driver.get("${url}")

${this.indent(tests, 4)}
finally:
    bidi.close()
    driver.quit()
`;
  }

  private static exportJava(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generateJavaTest(tc)).join("\n\n");
    return `import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;

public class ExportedBiDiTests {
    public static void main(String[] args) {
        WebDriver driver = new ChromeDriver();
        var bidi = ((org.openqa.selenium.bidi.HasBiDi) driver).getBiDi();
        try {
            driver.get("${url}");

${this.indent(tests, 12)}
        } finally {
            bidi.close();
            driver.quit();
        }
    }
}`;
  }

  private static exportRuby(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generateRubyTest(tc)).join("\n\n");
    return `require "selenium-webdriver"

driver = Selenium::WebDriver.for(:chrome)
bidi = driver.bidi

begin
  driver.navigate.to("${url}")

${this.indent(tests, 2)}
ensure
  bidi.close
  driver.quit
end
`;
  }

  private static exportCSharp(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generateCSharpTest(tc)).join("\n\n");
    return `using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

var driver = new ChromeDriver();
var bidi = ((OpenQA.Selenium.BiDi.IBiDi)driver).AsBiDiAsync().Result;

try
{
    driver.Navigate().GoToUrl("${url}");

${this.indent(tests, 4)}
}
finally
{
    bidi.Dispose();
    driver.Quit();
}
`;
  }

  private static generateTypeScriptTest(tc: GeneratedTestCase): string {
    const locator = this.selectorLiteral(tc.locator);
    switch (tc.actionType) {
      case "input":
        return `{
  const el = await driver.findElement(By.css(${locator}));
  await el.clear();
  await el.sendKeys("test-value");
}`;
      case "hover":
        return `{
  const el = await driver.findElement(By.css(${locator}));
  await driver.actions().move({ origin: el }).perform();
}`;
      default:
        return `await driver.findElement(By.css(${locator})).click();`;
    }
  }

  private static generatePythonTest(tc: GeneratedTestCase): string {
    const locator = this.selectorLiteral(tc.locator);
    switch (tc.actionType) {
      case "input":
        return `el = driver.find_element(By.CSS_SELECTOR, ${locator})
el.clear()
el.send_keys("test-value")`;
      case "hover":
        return `el = driver.find_element(By.CSS_SELECTOR, ${locator})
webdriver.ActionChains(driver).move_to_element(el).perform()`;
      default:
        return `driver.find_element(By.CSS_SELECTOR, ${locator}).click()`;
    }
  }

  private static generateJavaTest(tc: GeneratedTestCase): string {
    const locator = this.selectorLiteral(tc.locator);
    switch (tc.actionType) {
      case "input":
        return `var input = driver.findElement(By.cssSelector(${locator}));
            input.clear();
            input.sendKeys("test-value");`;
      case "hover":
        return `var hover = driver.findElement(By.cssSelector(${locator}));
            new org.openqa.selenium.interactions.Actions(driver).moveToElement(hover).perform();`;
      default:
        return `driver.findElement(By.cssSelector(${locator})).click();`;
    }
  }

  private static generateRubyTest(tc: GeneratedTestCase): string {
    const locator = this.selectorLiteral(tc.locator);
    switch (tc.actionType) {
      case "input":
        return `el = driver.find_element(:css, ${locator})
el.clear
el.send_keys("test-value")`;
      case "hover":
        return `el = driver.find_element(:css, ${locator})
driver.action.move_to(el).perform`;
      default:
        return `driver.find_element(:css, ${locator}).click`;
    }
  }

  private static generateCSharpTest(tc: GeneratedTestCase): string {
    const locator = this.selectorLiteral(tc.locator);
    switch (tc.actionType) {
      case "input":
        return `var input = driver.FindElement(By.CssSelector(${locator}));
input.Clear();
input.SendKeys("test-value");`;
      case "hover":
        return `var hover = driver.FindElement(By.CssSelector(${locator}));
new OpenQA.Selenium.Interactions.Actions(driver).MoveToElement(hover).Perform();`;
      default:
        return `driver.FindElement(By.CssSelector(${locator})).Click();`;
    }
  }

  private static selectorLiteral(selector: string): string {
    return JSON.stringify(selector);
  }

  private static indent(text: string, spaces: number): string {
    const pad = " ".repeat(spaces);
    return text
      .split("\n")
      .map((line) => (line.length > 0 ? `${pad}${line}` : line))
      .join("\n");
  }
}
