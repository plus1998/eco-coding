/**
 * Minimal gateway HTTP scenarios — one text turn per stream mode.
 * Full tool/MCP/subagent coverage uses `record-client-round.mts` (scenario id `full_round`).
 */
export const SCENARIOS = [
  { id: "text_non_stream", stream: false },
  { id: "text_stream", stream: true },
];

export function buildUpstreamBody(profile, scenario) {
  const prompt = `Gateway HTTP round smoke. Reply with exactly: GATEWAY_HTTP_OK:${profile.id}`;
  switch (profile.upstreamKind) {
    case "responses":
      return {
        model: profile.model,
        input: prompt,
        max_output_tokens: 128,
        stream: scenario.stream,
      };
    case "anthropic-messages":
      return {
        model: profile.model,
        max_tokens: 128,
        stream: scenario.stream,
        messages: [{ role: "user", content: prompt }],
      };
    case "openai-chat":
      return {
        model: profile.model,
        max_tokens: 128,
        stream: scenario.stream,
        messages: [{ role: "user", content: prompt }],
      };
    default:
      throw new Error(`Unsupported upstreamKind: ${profile.upstreamKind}`);
  }
}

export function buildGatewayClientBody(profile, scenario) {
  return buildUpstreamBody(profile, scenario);
}
