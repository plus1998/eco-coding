/** Matches desktop `DEFAULT_UPSTREAM_USER_AGENT` when no client UA / override is set. */
export const DEFAULT_UPSTREAM_USER_AGENT = "Eco-Coding/0.0.0";

/**
 * Apply upstream User-Agent: global override → client passthrough → Eco default.
 * Matches desktop `applyUserAgent` in upstream-request-headers.ts.
 */
export function applyUpstreamUserAgent(
  headers: Record<string, string>,
  clientHeaders: Headers,
  upstreamUserAgent?: string,
): void {
  const override = upstreamUserAgent?.trim();
  if (override) {
    headers["user-agent"] = override;
    return;
  }
  const clientUa = clientHeaders.get("user-agent")?.trim();
  if (clientUa) {
    headers["user-agent"] = clientUa;
    return;
  }
  headers["user-agent"] = DEFAULT_UPSTREAM_USER_AGENT;
}
