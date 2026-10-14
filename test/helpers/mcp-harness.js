/**
 * Starts build/index.js as a real MCP server and connects the official SDK
 * client to it over stdio.
 *
 * The previous ad-hoc client skipped the `initialize` handshake and sent
 * `tools/call` straight away, so it never exercised the protocol the server
 * actually speaks. Using the SDK client means version negotiation, the
 * initialized notification, and response validation are all covered.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Connect to a freshly spawned server.
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.env] extra environment variables
 * @returns {Promise<{ client: Client, close: () => Promise<void> }>}
 */
export async function startServer(options = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "build", "index.js")],
    cwd: repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stderr: "pipe",
  });

  const client = new Client(
    { name: "webmcp-selenium-tests", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  return {
    client,
    async close() {
      await client.close().catch(() => {});
    },
  };
}

/**
 * Connect a client to the server running inside this process.
 *
 * The spawned variant above proves the real stdio entry point boots, but a
 * child process is invisible to coverage: index.ts's request handlers — URL
 * coercion, session lookup, error shaping, roughly 840 lines — were exercised
 * on every integration run and reported as 0%. Driving the same server over an
 * in-memory transport makes those handlers measurable, and makes assertions
 * about them debuggable with an ordinary stack trace.
 *
 * The server is a module-level singleton, so one connection per process: call
 * this once and share the client.
 *
 * @returns {Promise<{ client: Client, close: () => Promise<void> }>}
 */
export async function startInProcessServer() {
  const { server } = await import("../../build/index.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "webmcp-selenium-tests-inprocess", version: "1.0.0" },
    { capabilities: {} }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

/** Extract the concatenated text content from a tools/call result. */
export function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
