import { GeneratedTestCase } from "./types.js";

export type SeleniumBiDiLanguage = "java" | "python" | "typescript" | "ruby" | "csharp";
const DEFAULT_INPUT_VALUE = "test-value";

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
    const tests = testCases.map((tc) => this.generateTypeScriptTest(tc, url)).join("\n\n");
    return `import { Builder, By, WebDriver } from "selenium-webdriver";
import { expect } from "chai";

describe("Exported BiDi Tests", function () {
  this.timeout(60000);

  let driver: WebDriver;
  let bidi: any;

  before(async function () {
    driver = await new Builder().forBrowser("chrome").build();
    bidi = await driver.getBidi();
  });

  after(async function () {
    await bidi.session.end();
    await driver.quit();
  });

${this.indent(tests, 2)}
});`;
  }

  private static exportPython(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generatePythonTest(tc, url)).join("\n\n");
    return `import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By

@pytest.fixture(scope="module")
def browser():
    driver = webdriver.Chrome()
    bidi = driver.bidi_connection()
    yield driver, bidi
    bidi.close()
    driver.quit()

${tests}
`;
  }

  private static exportJava(testCases: GeneratedTestCase[], url: string): string {
    const tests = testCases.map((tc) => this.generateJavaTest(tc, url)).join("\n\n");
    return `import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

public class ExportedBiDiTests {
    private static WebDriver driver;
    private static org.openqa.selenium.bidi.BiDi bidi;

    @BeforeAll
    static void setup() {
        driver = new ChromeDriver();
        bidi = ((org.openqa.selenium.bidi.HasBiDi) driver).getBiDi();
    }

    @AfterAll
    static void teardown() {
        bidi.close();
        driver.quit();
    }

${this.indent(tests, 4)}
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
    const tests = testCases.map((tc) => this.generateCSharpTest(tc, url)).join("\n\n");
    return `using NUnit.Framework;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

[TestFixture]
public class ExportedBiDiTests
{
    private IWebDriver driver = null!;
    private dynamic bidi = null!;

    [OneTimeSetUp]
    public void Setup()
    {
        driver = new ChromeDriver();
        bidi = ((OpenQA.Selenium.BiDi.IBiDi)driver).AsBiDiAsync().Result;
    }

    [OneTimeTearDown]
    public void Teardown()
    {
        bidi.Dispose();
        driver.Quit();
    }

${this.indent(tests, 4)}
}
`;
  }

  private static generateTypeScriptTest(tc: GeneratedTestCase, url: string): string {
    const testName = this.escapeSingleQuotedText(tc.id || tc.name || "generated test");
    const locator = this.selectorLiteral(tc.locator);
    let action: string;

    switch (tc.actionType) {
      case "input":
        action = `const el = await driver.findElement(By.css(${locator}));
    await el.clear();
    await el.sendKeys(${JSON.stringify(DEFAULT_INPUT_VALUE)});
    expect(await el.getAttribute("value")).to.equal(${JSON.stringify(DEFAULT_INPUT_VALUE)});`;
        break;
      case "hover":
        action = `const el = await driver.findElement(By.css(${locator}));
    await driver.actions().move({ origin: el }).perform();
    expect(await el.isDisplayed()).to.equal(true);`;
        break;
      default:
        action = `const el = await driver.findElement(By.css(${locator}));
    await el.click();
    expect(await el.isDisplayed()).to.equal(true);`;
        break;
    }

    return `it('${testName}', async function () {
    await driver.get("${url}");
    ${action}
  });`;
  }

  private static generatePythonTest(tc: GeneratedTestCase, url: string): string {
    const testName = this.toPythonTestName(tc.id || tc.name || "generated_test");
    const locator = this.selectorLiteral(tc.locator);
    let action: string;

    switch (tc.actionType) {
      case "input":
        action = `el = driver.find_element(By.CSS_SELECTOR, ${locator})
    el.clear()
    el.send_keys(${JSON.stringify(DEFAULT_INPUT_VALUE)})
    assert el.get_attribute("value") == ${JSON.stringify(DEFAULT_INPUT_VALUE)}`;
        break;
      case "hover":
        action = `el = driver.find_element(By.CSS_SELECTOR, ${locator})
    webdriver.ActionChains(driver).move_to_element(el).perform()
    assert el.is_displayed()`;
        break;
      default:
        action = `el = driver.find_element(By.CSS_SELECTOR, ${locator})
    el.click()
    assert el.is_displayed()`;
        break;
    }

    return `def test_${testName}(browser):
    driver, _ = browser
    driver.get("${url}")
    ${action}
    assert True`;
  }

  private static generateJavaTest(tc: GeneratedTestCase, url: string): string {
    const methodName = this.toJavaMethodName(tc.id || tc.name || "generated_test");
    const locator = this.selectorLiteral(tc.locator);
    let action: string;

    switch (tc.actionType) {
      case "input":
        action = `var input = driver.findElement(By.cssSelector(${locator}));
        input.clear();
        input.sendKeys(${JSON.stringify(DEFAULT_INPUT_VALUE)});
        Assertions.assertEquals(${JSON.stringify(DEFAULT_INPUT_VALUE)}, input.getAttribute("value"));`;
        break;
      case "hover":
        action = `var hover = driver.findElement(By.cssSelector(${locator}));
        new org.openqa.selenium.interactions.Actions(driver).moveToElement(hover).perform();
        Assertions.assertTrue(hover.isDisplayed());`;
        break;
      default:
        action = `var clickable = driver.findElement(By.cssSelector(${locator}));
        clickable.click();
        Assertions.assertTrue(clickable.isDisplayed());`;
        break;
    }

    return `@Test
    void ${methodName}() {
        driver.get("${url}");
        ${action}
    }`;
  }

  private static generateRubyTest(tc: GeneratedTestCase): string {
    const locator = this.selectorLiteral(tc.locator);
    switch (tc.actionType) {
      case "input":
        return `el = driver.find_element(:css, ${locator})
el.clear
el.send_keys(${JSON.stringify(DEFAULT_INPUT_VALUE)})`;
      case "hover":
        return `el = driver.find_element(:css, ${locator})
driver.action.move_to(el).perform`;
      default:
        return `driver.find_element(:css, ${locator}).click`;
    }
  }

  private static generateCSharpTest(tc: GeneratedTestCase, url: string): string {
    const methodName = this.toCSharpMethodName(tc.id || tc.name || "GeneratedTest");
    const locator = this.selectorLiteral(tc.locator);
    let action: string;

    switch (tc.actionType) {
      case "input":
        action = `var input = driver.FindElement(By.CssSelector(${locator}));
        input.Clear();
        input.SendKeys(${JSON.stringify(DEFAULT_INPUT_VALUE)});
        Assert.That(input.GetAttribute("value"), Is.EqualTo(${JSON.stringify(DEFAULT_INPUT_VALUE)}));`;
        break;
      case "hover":
        action = `var hover = driver.FindElement(By.CssSelector(${locator}));
        new OpenQA.Selenium.Interactions.Actions(driver).MoveToElement(hover).Perform();
        Assert.That(hover.Displayed, Is.True);`;
        break;
      default:
        action = `var clickable = driver.FindElement(By.CssSelector(${locator}));
        clickable.Click();
        Assert.That(clickable.Displayed, Is.True);`;
        break;
    }

    return `[Test]
    public void ${methodName}()
    {
        driver.Navigate().GoToUrl("${url}");
        ${action}
    }`;
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

  private static toPythonTestName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "generated_test";
  }

  private static toJavaMethodName(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
    if (!cleaned) return "generatedTest";
    const [first, ...rest] = cleaned.split(/\s+/);
    return first.toLowerCase() + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
  }

  private static toCSharpMethodName(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
    if (!cleaned) return "GeneratedTest";
    return cleaned
      .split(/\s+/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join("");
  }

  private static escapeSingleQuotedText(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
}
