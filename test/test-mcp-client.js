#!/usr/bin/env node
/**
 * Simple MCP client to test crawl_and_analyze on www.bstackdemo.com
 */
import { spawn } from "child_process";

const server = spawn("node", ["build/index.js"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
let requestId = 1;

server.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const msg = JSON.parse(line);
            console.log("📨 Server response:", JSON.stringify(msg, null, 2));

            // Stop after we get the result
            if (msg.result) {
                process.exit(0);
            }
        } catch (e) {
            console.error("Failed to parse:", line);
        }
    }
});

// Send crawl_and_analyze request
const request = {
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
        name: "crawl_and_analyze",
        arguments: {
            url: "https://www.bstackdemo.com",
        },
    },
};

console.log("📤 Sending request:", JSON.stringify(request, null, 2));
server.stdin.write(JSON.stringify(request) + "\n");

// Timeout after 3 minutes
setTimeout(() => {
    console.error("⏱️ Timeout - analysis took too long");
    server.kill();
    process.exit(1);
}, 180000);
