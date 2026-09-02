import path from "node:path";
import { createMcpAdapter } from "../vendor/pi-mcp-adapter.js";
import { toPiMcpAdapterConfig } from "./pi-mcp.js";

/**
 * Build a pi-mcp-adapter ExtensionFactory from an isolated in-memory config.
 * Returns undefined when there are no servers (skip loading the extension).
 *
 * Kept separate from pi-mcp.ts so renderer bundles never pull the vendored adapter.
 *
 * When `agentDir` is set, point `PI_CODING_AGENT_DIR` at Eco's per-thread agent
 * dir so the adapter writes mcp-cache under Eco data instead of `~/.pi`.
 */
export async function createPiMcpExtensionFactory(
  mcpServers: Record<string, unknown> | undefined,
  options?: { agentDir?: string },
): Promise<((pi: unknown) => void | Promise<void>) | undefined> {
  const config = toPiMcpAdapterConfig(mcpServers);
  if (Object.keys(config.mcpServers).length === 0) {
    return undefined;
  }
  if (typeof createMcpAdapter !== "function") {
    throw new Error(
      "Vendored pi-mcp-adapter is missing createMcpAdapter. Run: bun run --cwd packages/runtime bundle:pi-mcp-adapter",
    );
  }
  const agentDir = options?.agentDir?.trim();
  if (agentDir) {
    process.env.PI_CODING_AGENT_DIR = path.resolve(agentDir);
  }
  return createMcpAdapter({
    config: {
      mcpServers: config.mcpServers,
      settings: {
        // Headless Eco sessions: no interactive OAuth panels / ambient file writes.
        hostConfigDiscovery: "off",
        scriptMode: true,
        samplingAutoApprove: true,
      },
    },
  });
}
