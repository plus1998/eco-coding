import { anthropicToResponses } from './anthropic-to-responses.js';
import type { AnthropicRequest } from './types.js';

/** Body for `POST /v1/responses/input_tokens` (same input surface as `responses.create`). */
export function anthropicToResponsesInputTokensBody(
  req: AnthropicRequest,
): Record<string, unknown> {
  const responsesReq = anthropicToResponses(req);
  const body: Record<string, unknown> = {
    model: responsesReq.model,
    input: responsesReq.input,
  };
  if (responsesReq.tools !== undefined && responsesReq.tools.length > 0) {
    body.tools = responsesReq.tools;
  }
  if (responsesReq.tool_choice !== undefined) {
    body.tool_choice = responsesReq.tool_choice;
  }
  if (responsesReq.reasoning !== undefined) {
    body.reasoning = responsesReq.reasoning;
  }
  return body;
}

/** Map OpenAI `response.input_tokens` payload to Anthropic `count_tokens` shape. */
export function responsesInputTokensToAnthropicCount(
  raw: unknown,
): { input_tokens: number } {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new Error('responses input_tokens response is not an object');
  }
  const record = raw as Record<string, unknown>;

  const direct = record.input_tokens;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) {
    return { input_tokens: Math.trunc(direct) };
  }

  const usage = record.usage;
  if (usage !== null && usage !== undefined && typeof usage === 'object') {
    const usageTokens = (usage as Record<string, unknown>).input_tokens;
    if (typeof usageTokens === 'number' && Number.isFinite(usageTokens) && usageTokens >= 0) {
      return { input_tokens: Math.trunc(usageTokens) };
    }
  }

  throw new Error('responses input_tokens response missing input_tokens');
}
