/**
 * Lifecycle helpers for the in-repo BenchmarkShop fixture
 * (benchmark/app/server.js).
 *
 * Using this instead of a third-party site makes crawl tests hermetic: no
 * network, deterministic data, and a ground-truth file to assert against.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appDir = path.join(repoRoot, "benchmark", "app");

/** Ground-truth journey definitions shipped with the fixture. */
export function loadGroundTruth() {
  const file = path.join(repoRoot, "benchmark", "ground-truth", "journeys.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** True when `npm install` has been run in benchmark/app. */
export function benchmarkDepsInstalled() {
  try {
    createRequire(path.join(appDir, "server.js")).resolve("express");
    return true;
  } catch {
    return false;
  }
}

/** Reserve a free TCP port by binding and immediately releasing it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `BenchmarkShop did not become ready at ${url} within ${timeoutMs}ms: ${lastError}`
  );
}

/**
 * Boot BenchmarkShop on an ephemeral port.
 *
 * @returns {Promise<{ baseUrl: string, port: number, stop: () => Promise<void> }>}
 */
export async function startBenchmarkApp({ readyTimeoutMs = 20000 } = {}) {
  if (!benchmarkDepsInstalled()) {
    throw new Error(
      "benchmark/app dependencies are missing — run `npm --prefix benchmark/app install`"
    );
  }

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(appDir, "server.js")], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = [];
  child.stdout.on("data", (d) => output.push(d.toString()));
  child.stderr.on("data", (d) => output.push(d.toString()));

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHttp(`${baseUrl}/`, readyTimeoutMs);
  } catch (err) {
    child.kill("SIGKILL");
    const detail = exited ? ` (process exited: ${JSON.stringify(exited)})` : "";
    throw new Error(`${err.message}${detail}\n${output.join("")}`);
  }

  return {
    baseUrl,
    port,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000).unref?.();
      });
    },
  };
}
