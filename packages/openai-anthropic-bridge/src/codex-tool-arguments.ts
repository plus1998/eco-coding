import type {
  ResponsesOutput,
  ResponsesRequest,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesTool,
} from "./types.js";

const INTEGER_ARGUMENTS_BY_TOOL: Readonly<Record<string, ReadonlySet<string>>> = {
  exec_command: new Set(["yield_time_ms", "max_output_tokens"]),
  write_stdin: new Set(["session_id", "yield_time_ms", "max_output_tokens"]),
  wait: new Set(["yield_time_ms", "max_tokens"]),
  wait_agent: new Set(["timeout_ms"]),
  request_user_input: new Set(["autoResolutionMs"]),
  create_goal: new Set(["token_budget"]),
};

export interface ResponsesToolArgumentStreamState {
  toolNameByOutputIndex: Map<number, string>;
  toolNameByItemId: Map<string, string>;
  toolNameByCallId: Map<string, string>;
}

export function newResponsesToolArgumentStreamState(): ResponsesToolArgumentStreamState {
  return {
    toolNameByOutputIndex: new Map(),
    toolNameByItemId: new Map(),
    toolNameByCallId: new Map(),
  };
}

export function hasCodexIntegerToolArguments(name: string): boolean {
  return integerArgumentFields(name) !== undefined;
}

/**
 * Codex currently publishes some integer-backed tool fields as JSON Schema
 * `number`, while its Rust handlers deserialize them as i32/u64. Providers may
 * therefore legally emit `85031.0`, which serde rejects. Canonicalize only the
 * known integer-backed fields and only when their values are safe integers.
 */
export function normalizeCodexToolArguments(name: string, raw: string): string {
  const integerFields = integerArgumentFields(name);
  if (!integerFields || raw === "") {
    return raw;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!isRecord(parsed)) {
    return raw;
  }

  let hasCanonicalizableInteger = false;
  for (const field of integerFields) {
    const value = parsed[field];
    if (typeof value !== "number") {
      continue;
    }
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      return raw;
    }
    hasCanonicalizableInteger = true;
  }
  return hasCanonicalizableInteger ? JSON.stringify(parsed) : raw;
}

/** Make the model-facing schema agree with Codex's integer deserializers. */
export function normalizeCodexIntegerToolSchemas(request: ResponsesRequest): ResponsesRequest {
  if (!request.tools?.length) {
    return request;
  }
  const tools = normalizeToolSchemaList(request.tools);
  return tools === request.tools ? request : { ...request, tools };
}

export function normalizeResponsesToolArguments(response: ResponsesResponse): ResponsesResponse {
  const output = normalizeResponsesOutputList(response.output);
  return output === response.output ? response : { ...response, output };
}

export function normalizeResponsesStreamToolArguments(
  event: ResponsesStreamEvent,
  state: ResponsesToolArgumentStreamState,
): ResponsesStreamEvent {
  rememberToolName(event, state);

  let next = event;
  if (event.item) {
    const item = normalizeResponsesOutput(event.item);
    if (item !== event.item) {
      next = { ...next, item };
    }
  }
  if (event.response) {
    const response = normalizeResponsesToolArguments(event.response);
    if (response !== event.response) {
      next = { ...next, response };
    }
  }

  const toolName = resolveStreamToolName(event, state);
  if (toolName && typeof event.arguments === "string") {
    const args = normalizeCodexToolArguments(toolName, event.arguments);
    if (args !== event.arguments) {
      next = { ...next, arguments: args };
    }
  }
  // Some compatible providers send one complete JSON object as a single delta.
  if (toolName && typeof event.delta === "string") {
    const delta = normalizeCodexToolArguments(toolName, event.delta);
    if (delta !== event.delta) {
      next = { ...next, delta };
    }
  }
  return next;
}

function normalizeResponsesOutputList(output: ResponsesOutput[] | undefined): ResponsesOutput[] | undefined {
  if (!output?.length) {
    return output;
  }
  let changed = false;
  const normalized = output.map((item) => {
    const next = normalizeResponsesOutput(item);
    changed ||= next !== item;
    return next;
  });
  return changed ? normalized : output;
}

function normalizeResponsesOutput(item: ResponsesOutput): ResponsesOutput {
  if (item.type !== "function_call" || !item.name || typeof item.arguments !== "string") {
    return item;
  }
  const args = normalizeCodexToolArguments(item.name, item.arguments);
  return args === item.arguments ? item : { ...item, arguments: args };
}

function normalizeToolSchemaList(tools: ResponsesTool[]): ResponsesTool[] {
  let changed = false;
  const normalized = tools.map((tool) => {
    const nestedTools = tool.tools ? normalizeToolSchemaList(tool.tools) : tool.tools;
    const integerFields = tool.name ? integerArgumentFields(tool.name) : undefined;
    const parameters = integerFields
      ? normalizeToolParameters(tool.parameters, integerFields)
      : tool.parameters;
    if (nestedTools === tool.tools && parameters === tool.parameters) {
      return tool;
    }
    changed = true;
    return {
      ...tool,
      ...(nestedTools !== undefined ? { tools: nestedTools } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
    };
  });
  return changed ? normalized : tools;
}

function normalizeToolParameters(parameters: unknown, integerFields: ReadonlySet<string>): unknown {
  if (!isRecord(parameters) || !isRecord(parameters.properties)) {
    return parameters;
  }
  let changed = false;
  const properties = { ...parameters.properties };
  for (const field of integerFields) {
    const property = properties[field];
    if (!isRecord(property) || property.type !== "number") {
      continue;
    }
    properties[field] = { ...property, type: "integer" };
    changed = true;
  }
  return changed ? { ...parameters, properties } : parameters;
}

function rememberToolName(event: ResponsesStreamEvent, state: ResponsesToolArgumentStreamState): void {
  const name = event.item?.type === "function_call" ? event.item.name?.trim() : event.name?.trim();
  if (!name) {
    return;
  }
  if (event.output_index !== undefined) {
    state.toolNameByOutputIndex.set(event.output_index, name);
  }
  const itemId = event.item?.id?.trim() || event.item_id?.trim();
  if (itemId) {
    state.toolNameByItemId.set(itemId, name);
  }
  const callId = event.item?.call_id?.trim() || event.call_id?.trim();
  if (callId) {
    state.toolNameByCallId.set(callId, name);
  }
}

function resolveStreamToolName(
  event: ResponsesStreamEvent,
  state: ResponsesToolArgumentStreamState,
): string | undefined {
  return (
    event.name?.trim() ||
    event.item?.name?.trim() ||
    (event.output_index !== undefined ? state.toolNameByOutputIndex.get(event.output_index) : undefined) ||
    (event.item_id ? state.toolNameByItemId.get(event.item_id) : undefined) ||
    (event.call_id ? state.toolNameByCallId.get(event.call_id) : undefined)
  );
}

function integerArgumentFields(name: string): ReadonlySet<string> | undefined {
  const leaf = name.trim().split(/[.:/]/).at(-1)?.toLowerCase() ?? "";
  return INTEGER_ARGUMENTS_BY_TOOL[leaf];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
