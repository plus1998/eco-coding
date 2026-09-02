import { captureHttpExchange, logExchange } from "./http-capture.mjs";

/**
 * @typedef {{
 *   client: string,
 *   profileId: string,
 *   scenarioId: string,
 * }} UpstreamLogCell
 */

/**
 * @param {{
 *   logPath: string,
 *   artifactDir: string,
 *   getCell: () => UpstreamLogCell,
 *   getSecrets: () => string[],
 *   seqRef: { value: number },
 * }} options
 */
export function createUpstreamLoggingFetch(options) {
  const { logPath, artifactDir, getCell, getSecrets, seqRef } = options;

  return async (input, init) => {
    const cell = getCell();
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : undefined;

    const result = await captureHttpExchange({
      fetchImpl: fetch,
      method,
      url,
      headers,
      body,
      secrets: getSecrets(),
      scenarioId: cell.scenarioId,
      layer: "upstream-via-gateway",
      profileId: cell.profileId,
      artifactDir,
      seq: ++seqRef.value,
    });

    const exchange = {
      ...result.exchange,
      client: cell.client,
    };
    logExchange(logPath, exchange);
    return result.response;
  };
}
