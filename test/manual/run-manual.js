#!/usr/bin/env node
/**
 * Runner for the manual exploration scripts in this directory.
 *
 * These scripts drive a real browser against live sites and print what they
 * find. They are investigation tools, not tests — they have no fixed expected
 * output, so they are deliberately outside the CI gate.
 *
 * What this runner adds is an honest exit code. Run directly, several of these
 * scripts swallow a ChromeDriver failure and still exit 0, which is how a
 * broken driver used to look identical to a successful crawl.
 *
 * Usage:
 *   node test/manual/run-manual.js test-bstackdemo.js
 *   node test/manual/run-manual.js            # list available scripts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Messages that mean "the browser never started", not "the site misbehaved". */
const DRIVER_FAILURE_PATTERNS = [
  /session not created/i,
  /cannot find chrome binary/i,
  /chromedriver/i,
  /unable to (connect to|discover) .*(renderer|driver)/i,
  /WebDriverError: unknown error/i,
];

function listScripts() {
  return fs
    .readdirSync(here)
    .filter((f) => f.endsWith(".js") && f !== "run-manual.js")
    .sort();
}

const target = process.argv[2];

if (!target) {
  console.log("Manual exploration scripts (not part of the CI gate):\n");
  for (const name of listScripts()) console.log(`  ${name}`);
  console.log("\nRun one with: node test/manual/run-manual.js <script.js>");
  process.exit(0);
}

const scriptPath = path.join(here, path.basename(target));
if (!fs.existsSync(scriptPath)) {
  console.error(`No such manual script: ${target}`);
  console.error(`Available: ${listScripts().join(", ")}`);
  process.exit(2);
}

// Scripts log their driver problems rather than throwing, so watch the stream.
let sawDriverFailure = null;
const realError = console.error;
const realLog = console.log;

function watch(stream) {
  return (...args) => {
    const line = args
      .map((a) => (a instanceof Error ? a.message : String(a)))
      .join(" ");
    if (!sawDriverFailure && DRIVER_FAILURE_PATTERNS.some((re) => re.test(line))) {
      sawDriverFailure = line.slice(0, 300);
    }
    stream(...args);
  };
}

console.error = watch(realError);
console.log = watch(realLog);

function finish(code) {
  console.error = realError;
  console.log = realLog;
  if (sawDriverFailure && code === 0) {
    realError(
      `\n✗ ${path.basename(scriptPath)} exited 0 but the browser never started.\n` +
        `  ${sawDriverFailure}\n` +
        `  Treating this as a failure — a broken driver is not a passing run.`
    );
    process.exit(1);
  }
  process.exit(code);
}

process.on("exit", (code) => {
  if (sawDriverFailure && code === 0) {
    realError(
      `\n✗ ${path.basename(scriptPath)} exited 0 but the browser never started.\n` +
        `  ${sawDriverFailure}`
    );
    process.exitCode = 1;
  }
});

try {
  await import(pathToFileURL(scriptPath).href);
} catch (err) {
  realError(`\n✗ ${path.basename(scriptPath)} threw:`, err?.stack ?? err);
  finish(1);
}
