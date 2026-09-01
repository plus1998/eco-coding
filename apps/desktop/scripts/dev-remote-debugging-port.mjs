/** @typedef {NodeJS.ProcessEnv} Env */

export const FORBIDDEN_CDP_PORT = 9222;
export const DEFAULT_DEV_CDP_PORT = 9333;

/**
 * Dev Electron `--remote-debugging-port` (main window UI). Off when ECO_DEV_CDP=0.
 * @param {Env} [env]
 * @returns {number | undefined}
 */
export function resolveDevRemoteDebuggingPort(env = process.env) {
  if (env.ECO_DEV_CDP === "0") {
    return undefined;
  }
  const raw = env.ECO_DEV_CDP_PORT;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_DEV_CDP_PORT;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    console.error(
      `[eco-dev-cdp] invalid ECO_DEV_CDP_PORT=${JSON.stringify(raw)}; using ${DEFAULT_DEV_CDP_PORT}`,
    );
    return DEFAULT_DEV_CDP_PORT;
  }
  if (port === FORBIDDEN_CDP_PORT) {
    console.error(
      `[eco-dev-cdp] ECO_DEV_CDP_PORT=${port} forbidden (Chrome default); using ${DEFAULT_DEV_CDP_PORT}`,
    );
    return DEFAULT_DEV_CDP_PORT;
  }
  return port;
}

/**
 * @param {number | undefined} port
 * @returns {string[]}
 */
export function devRemoteDebuggingElectronArgs(port) {
  if (port === undefined) {
    return [];
  }
  return [`--remote-debugging-port=${port}`];
}
