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

/** Extract the concatenated text content from a tools/call result. */
export function textOf(result) {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
