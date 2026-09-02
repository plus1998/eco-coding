/**
 * Map Eco / Claude-SDK MCP entries onto ACP `session/new` / `session/load` `mcpServers`.
 * Wire shape follows ACP v1: stdio `{ type, name, command, args, env }` and
 * http/sse `{ type, name, url, headers }`. `env` / `headers` are `{ name, value }[]`.
 *
 * Incomplete enabled servers are not dropped — callers get an error listing names.
 */

export type AcpEnvVariable = {
  name: string;
  value: string;
};

export type AcpMcpStdioServer = {
  type: "stdio";
  name: string;
  command: string;
  args: string[];
  env: AcpEnvVariable[];
  cwd?: string;
};

export type AcpMcpHttpServer = {
  type: "http" | "sse";
  name: string;
  url: string;
  headers: AcpEnvVariable[];
};

export type AcpMcpServer = AcpMcpStdioServer | AcpMcpHttpServer;

export function toAcpMcpServers(mcpServers: Record<string, unknown> | undefined): AcpMcpServer[] {
  if (!mcpServers) {
    return [];
  }
  const mapped: AcpMcpServer[] = [];
  const skipped: string[] = [];
  for (const [rawName, entry] of Object.entries(mcpServers)) {
    const name = rawName.trim();
    if (!name) continue;
    const server = toAcpMcpServer(name, entry);
    if (server) {
      mapped.push(server);
    } else {
      skipped.push(name);
    }
  }
  if (skipped.length > 0) {
    throw new Error(
      `ACP 无法按协议传递这些 MCP server（缺少 command/url 或不支持的传输）: ${skipped.join(", ")}`,
    );
  }
  return mapped;
}

export function toAcpMcpServer(name: string, entry: unknown): AcpMcpServer | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command.trim() : "";
  if (command) {
    const args = stringArray(record.args);
    const env = toAcpEnvVariables(record.env);
    const cwd = typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : undefined;
    return {
      type: "stdio",
      name,
      command,
      args,
      env,
      ...(cwd ? { cwd } : {}),
    };
  }

  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) {
    return undefined;
  }
  const type = record.type === "sse" || record.httpTransport === "sse" ? "sse" : "http";
  return {
    type,
    name,
    url,
    headers: toAcpEnvVariables(record.headers),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Accept Eco `Record<string, string>` or ACP `{ name, value }[]`. */
function toAcpEnvVariables(value: unknown): AcpEnvVariable[] {
  if (Array.isArray(value)) {
    const out: AcpEnvVariable[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!name || typeof record.value !== "string") continue;
      out.push({ name, value: record.value });
    }
    return out;
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const out: AcpEnvVariable[] = [];
  for (const [name, entry] of Object.entries(value)) {
    if (!name || typeof entry !== "string") continue;
    out.push({ name, value: entry });
  }
  return out;
}
