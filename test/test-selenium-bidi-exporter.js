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

const languages = ["java", "python", "typescript", "ruby", "csharp"];

for (const language of languages) {
  const exported = SeleniumBiDiExporter.export(sampleTests, language, "https://example.com");
  assert.ok(exported.includes("button.login"), `Expected locator for ${language}`);
}

assert.ok(
  SeleniumBiDiExporter.export(sampleTests, "typescript", "https://example.com").includes("getBidi"),
  "TypeScript export should include BiDi session usage"
);
assert.ok(
  SeleniumBiDiExporter.export(sampleTests, "python", "https://example.com").includes("bidi_connection"),
  "Python export should include BiDi connection usage"
);
assert.ok(
  SeleniumBiDiExporter.export(sampleTests, "java", "https://example.com").includes("HasBiDi"),
  "Java export should include HasBiDi usage"
);
assert.ok(
  SeleniumBiDiExporter.export(sampleTests, "ruby", "https://example.com").includes("driver.bidi"),
  "Ruby export should include BiDi usage"
);
assert.ok(
  SeleniumBiDiExporter.export(sampleTests, "csharp", "https://example.com").includes("AsBiDiAsync"),
  "C# export should include BiDi usage"
);

console.log("Selenium WebDriver BiDi exporter tests passed.");
