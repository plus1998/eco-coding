import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * ACP client-side `fs/*` request handlers.
 *
 * Cursor `agent acp` (and other ACP agents) may issue `fs/read_text_file` and
 * `fs/write_text_file` requests to the host for file access. Without these
 * handlers the peer answers `-32601 Method not found`, which makes subagent file
 * operations fail and can cause the agent to end the turn early.
 *
 * All paths are scoped to the workspace root — requests that escape it are
 * rejected with a JSON-RPC error instead of being silently served.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `candidatePath` resolves to a location inside `parentPath`. */
function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export type AcpFsReadRequest = {
  path: string;
  line?: number;
  limit?: number;
};

export type AcpFsWriteRequest = {
  path: string;
  content: string;
};

export function parseAcpFsReadRequest(params: unknown): AcpFsReadRequest | undefined {
  if (!isRecord(params)) return undefined;
  const filePath = params.path;
  if (typeof filePath !== "string" || !filePath.trim()) return undefined;
  const line = typeof params.line === "number" ? params.line : undefined;
  const limit = typeof params.limit === "number" ? params.limit : undefined;
  return { path: filePath.trim(), ...(line ? { line } : {}), ...(limit ? { limit } : {}) };
}

export function parseAcpFsWriteRequest(params: unknown): AcpFsWriteRequest | undefined {
  if (!isRecord(params)) return undefined;
  const filePath = params.path;
  const content = params.content;
  if (typeof filePath !== "string" || !filePath.trim()) return undefined;
  if (typeof content !== "string") return undefined;
  return { path: filePath.trim(), content };
}

export class PathEscapesWorkspaceError extends Error {
  constructor(
    readonly requestedPath: string,
    readonly workspacePath: string,
  ) {
    super(`ACP fs request path escapes workspace: ${requestedPath}`);
    this.name = "PathEscapesWorkspaceError";
  }
}

export class AcpFsHandler {
  constructor(private readonly workspacePath: string) {}

  async read(request: AcpFsReadRequest): Promise<Record<string, unknown>> {
    if (!isInsidePath(request.path, this.workspacePath)) {
      throw new PathEscapesWorkspaceError(request.path, this.workspacePath);
    }
    const text = await fs.readFile(request.path, "utf8");
    if (request.line === undefined) {
      return { content: text };
    }
    const lines = text.split("\n");
    const start = Math.max(0, request.line - 1);
    const end = request.limit === undefined ? lines.length : start + request.limit;
    return { content: lines.slice(start, end).join("\n"), start_line: request.line, end_line: start + (end - start) };
  }

  async write(request: AcpFsWriteRequest): Promise<Record<string, unknown>> {
    if (!isInsidePath(request.path, this.workspacePath)) {
      throw new PathEscapesWorkspaceError(request.path, this.workspacePath);
    }
    await fs.mkdir(path.dirname(request.path), { recursive: true });
    await fs.writeFile(request.path, request.content, "utf8");
    return { path: request.path };
  }
}
