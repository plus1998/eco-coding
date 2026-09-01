/** Reserved port; avoid Chrome default remote debugging. */
export const FORBIDDEN_CDP_PORT = 9222;

/** Default dev Electron remote debugging port. */
export const DEFAULT_DEV_CDP_PORT = 9333;

export function isDevRuntime(): boolean {
  return process.env.VITE_DEV_SERVER_URL !== undefined;
}

/** Dev Electron CDP unless explicitly disabled with ECO_DEV_CDP=0. */
export function isDevCdpEnabled(): boolean {
  return isDevRuntime() && process.env.ECO_DEV_CDP !== "0";
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return undefined;
  }
  return port;
}

/**
 * `--remote-debugging-port` for Eco dev (main app UI). Undefined when disabled.
 */
export function resolveDevRemoteDebuggingPort(): number | undefined {
  if (!isDevCdpEnabled()) {
    return undefined;
  }
  const raw = process.env.ECO_DEV_CDP_PORT;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_DEV_CDP_PORT;
  }
  const parsed = parsePort(raw);
  if (parsed === undefined) {
    process.stderr.write(
      `[eco-dev-cdp] invalid ECO_DEV_CDP_PORT=${JSON.stringify(raw)}; using ${DEFAULT_DEV_CDP_PORT}\n`,
    );
    return DEFAULT_DEV_CDP_PORT;
  }
  if (parsed === FORBIDDEN_CDP_PORT) {
    process.stderr.write(
      `[eco-dev-cdp] ECO_DEV_CDP_PORT=${parsed} forbidden (Chrome default); using ${DEFAULT_DEV_CDP_PORT}\n`,
    );
    return DEFAULT_DEV_CDP_PORT;
  }
  return parsed;
}

/** @deprecated Use resolveDevRemoteDebuggingPort */
export const resolveDevCdpPort = resolveDevRemoteDebuggingPort;
