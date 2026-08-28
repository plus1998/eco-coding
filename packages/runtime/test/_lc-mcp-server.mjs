/**
 * Minimal MCP server for LongCat smoke tests. Implements the MCP protocol
 * over stdio using newline-delimited JSON (the format the MCP SDK's
 * StdioClientTransport expects). Exposes a single `echo` tool that returns
 * its input, so the test can verify MCP result content surfaces through PI's
 * mcp proxy.
 *
 * Invoked by the smoke test as a stdio MCP server:
 *   { command: "node", args: ["packages/runtime/test/_lc-mcp-server.mjs"] }
 */
import { stdin, stdout } from "node:process";

const tools = [
  {
    name: "echo",
    description: "Echo back the supplied text.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to echo." },
      },
      required: ["text"],
    },
  },
];

function write(res) {
  stdout.write(JSON.stringify(res) + "\n");
}

function handle(req) {
  switch (req.method) {
    case "initialize":
      write({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "lc-smoke-mcp", version: "0.0.1" },
        },
      });
      break;
    case "initialized":
      // No-op notification after initialize.
      break;
    case "tools/list":
      write({ jsonrpc: "2.0", id: req.id, result: { tools } });
      break;
    case "tools/call": {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};
      if (name === "echo") {
        const text = typeof args.text === "string" ? args.text : "";
        write({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: `MCP-ECHO: ${text}` }],
          },
        });
      } else {
        write({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
      }
      break;
    }
    default:
      write({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not supported: ${req.method}` },
      });
  }
}

let buf = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      // ignore malformed JSON
    }
  }
});
stdin.resume();
