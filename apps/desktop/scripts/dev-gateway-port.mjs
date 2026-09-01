/** @typedef {NodeJS.ProcessEnv} Env */

export const DEFAULT_DEV_GATEWAY_PORT = 18_766;

/**
 * Port logged at dev startup. Electron main resolves the live port via
 * `resolveEcoGatewayPort()` (honors ECO_GATEWAY_PORT, else dev default when VITE is set).
 * @param {Env} [env]
 * @returns {number}
 */
export function resolveDevEcoGatewayPortForLog(env = process.env) {
  const raw = env.ECO_GATEWAY_PORT?.trim();
  if (raw) {
    const port = Number.parseInt(raw, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) {
      return port;
    }
  }
  return DEFAULT_DEV_GATEWAY_PORT;
}
