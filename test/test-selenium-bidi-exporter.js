#!/usr/bin/env node

import assert from "node:assert/strict";
import { SeleniumBiDiExporter } from "../build/selenium-bidi-exporter.js";

const sampleTests = [
  {
    id: "TC_SAMPLE_1",
    name: "Click login",
    description: "Clicks login",
    priority: "critical",
    actionType: "click",
    locator: "button.login",
    preconditions: [],
    steps: [],
    expectedResults: [],
    intentScore: 80,
    tags: [],
    sourceElement: {
      path: "body > button.login",
      tag: "button",
      locator: "button.login",
      intentReasons: [],
      intentScore: 80,
    },
  },
];

const expectedByLanguage = {
  typescript: ["describe(", "it(", "before(", "after(", "getBidi", "session.end"],
  python: ["import pytest", "@pytest.fixture", "def test_", "bidi_connection", "bidi.close"],
  java: ["org.junit.jupiter.api", "@BeforeAll", "@AfterAll", "@Test", "HasBiDi"],
  ruby: ["driver.bidi", "bidi.close", "driver.quit"],
  csharp: ["using NUnit.Framework;", "[TestFixture]", "[OneTimeSetUp]", "[Test]", "AsBiDiAsync"],
};

for (const [language, expectedTokens] of Object.entries(expectedByLanguage)) {
  const exported = SeleniumBiDiExporter.export(sampleTests, language, "https://example.com");
  assert.ok(exported.includes("button.login"), `Expected locator for ${language}`);
  for (const token of expectedTokens) {
    assert.ok(exported.includes(token), `Expected "${token}" in ${language} export`);
  }
}

console.log("Selenium WebDriver BiDi exporter tests passed.");
