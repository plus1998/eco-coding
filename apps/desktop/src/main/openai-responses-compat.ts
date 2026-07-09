import { logUpstream, parseJsonForLog } from "./upstream-log";

const MAX_UNSUPPORTED_PARAMETER_RETRIES = 8;

const DROPPABLE_RESPONSES_PARAMETERS = new Set([
  "cache_control",
  "context_management",
  "include",
  "max_output_tokens",
  "parallel_tool_calls",
  "previous_response_id",
  "prompt_cache_key",
  "prompt_cache_retention",
  "reasoning",
  "service_tier",
  "session_id",
  "store",
  "stream",
  "temperature",
  "text",
  "tool_choice",
  "top_p",
]);

const learnedUnsupportedParametersByEndpoint = new Map<string, Set<string>>();

function compatibilityCacheKey(input: {
  url: string;
  logContext?: Record<string, unknown>;
}): string {
  const providerId =
    typeof input.logContext?.providerId === "string" ? input.logContext.providerId : "";
  try {
    const url = new URL(input.url);
    return [providerId, url.origin, url.pathname].filter(Boolean).join("|");
  } catch {
    return [providerId, input.url].filter(Boolean).join("|");
  }
}

function learnUnsupportedParameter(cacheKey: string, param: string): void {
  const key = topLevelParameterName(param);
  if (!DROPPABLE_RESPONSES_PARAMETERS.has(key)) {
    return;
  }
  const existing = learnedUnsupportedParametersByEndpoint.get(cacheKey);
  if (existing) {
    existing.add(key);
    return;
  }
  learnedUnsupportedParametersByEndpoint.set(cacheKey, new Set([key]));
}

function dropLearnedUnsupportedParameters(
  body: Record<string, unknown>,
  cacheKey: string,
): string[] {
  const known = learnedUnsupportedParametersByEndpoint.get(cacheKey);
  if (!known || known.size === 0) {
    return [];
  }
  const dropped: string[] = [];
  for (const key of [...known].sort()) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) {
      continue;
    }
    delete body[key];
    dropped.push(key);
  }
  return dropped;
}

export function clearOpenAIResponsesUnsupportedParameterMemory(): void {
  learnedUnsupportedParametersByEndpoint.clear();
}

export function extractUnsupportedOpenAIResponsesParameter(raw: string): string | undefined {
  const candidates: string[] = [raw];
  const parsed = parseJsonForLog(raw);
  collectStrings(parsed, candidates);

  for (const candidate of candidates) {
    const patterns = [
      /Unsupported parameter:\s*["'`]?([A-Za-z0-9_.-]+)["'`]?/i,
      /Unknown parameter:\s*["'`]?([A-Za-z0-9_.-]+)["'`]?/i,
      /Unrecognized request argument supplied:\s*["'`]?([A-Za-z0-9_.-]+)["'`]?/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(candidate);
      const param = match?.[1]?.trim();
      if (param) {
        return param;
      }
    }
  }

  return undefined;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      collectStrings(item, out);
    }
  }
}

function topLevelParameterName(param: string): string {
  return param.split(/[.[\]]/, 1)[0] ?? param;
}

export function dropUnsupportedOpenAIResponsesParameter(
  body: Record<string, unknown>,
  param: string,
): { dropped: true; key: string } | { dropped: false; key: string; reason: string } {
  const key = topLevelParameterName(param);
  if (!DROPPABLE_RESPONSES_PARAMETERS.has(key)) {
    return { dropped: false, key, reason: "not_droppable" };
  }
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { dropped: false, key, reason: "missing" };
  }
  delete body[key];
  return { dropped: true, key };
}

export async function postJsonWithOpenAIResponsesUnsupportedParameterRetry(input: {
  fetcher: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  logContext?: Record<string, unknown>;
}): Promise<{
  response: Response;
  requestBody: Record<string, unknown>;
  requestPayload: string;
  responseText?: string;
  droppedParams: string[];
}> {
  const requestBody = { ...input.body };
  const droppedParams = dropLearnedUnsupportedParameters(
    requestBody,
    compatibilityCacheKey(input),
  );
  if (droppedParams.length > 0) {
    logUpstream("openai-responses-drop-learned-unsupported-params", {
      ...input.logContext,
      url: input.url,
      droppedParams,
      nextTopLevelKeys: Object.keys(requestBody).sort(),
    });
  }
  const retryDroppedParams: string[] = [];

  for (let attempt = 0; ; attempt += 1) {
    const requestPayload = JSON.stringify(requestBody);
    const response = await input.fetcher(input.url, {
      method: "POST",
      headers: input.headers,
      body: requestPayload,
      ...(input.signal && { signal: input.signal }),
    });

    if (response.ok) {
      return { response, requestBody, requestPayload, droppedParams };
    }

    const responseText = await response.text();
    const unsupportedParam = extractUnsupportedOpenAIResponsesParameter(responseText);
    if (
      response.status >= 400 &&
      response.status < 500 &&
      unsupportedParam &&
      retryDroppedParams.length < MAX_UNSUPPORTED_PARAMETER_RETRIES
    ) {
      const drop = dropUnsupportedOpenAIResponsesParameter(requestBody, unsupportedParam);
      if (drop.dropped) {
        droppedParams.push(drop.key);
        retryDroppedParams.push(drop.key);
        learnUnsupportedParameter(compatibilityCacheKey(input), drop.key);
        logUpstream("openai-responses-drop-unsupported-param", {
          ...input.logContext,
          url: input.url,
          status: response.status,
          attempt,
          unsupportedParam,
          droppedKey: drop.key,
          droppedParams,
          response: parseJsonForLog(responseText),
          nextTopLevelKeys: Object.keys(requestBody).sort(),
        });
        continue;
      }

      logUpstream("openai-responses-unsupported-param-not-dropped", {
        ...input.logContext,
        url: input.url,
        status: response.status,
        attempt,
        unsupportedParam,
        key: drop.key,
        reason: drop.reason,
        response: parseJsonForLog(responseText),
      });
    }

    return { response, requestBody, requestPayload, responseText, droppedParams };
  }
}
