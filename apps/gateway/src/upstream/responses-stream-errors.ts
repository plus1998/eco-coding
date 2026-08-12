/** Emit a Responses-shaped `response.failed` SSE event for mid-stream conversion failures. */
export function responsesFailedSse(message: string, code = "upstream_error"): string {
  const payload = {
    type: "response.failed",
    response: {
      error: {
        code,
        message,
      },
    },
  };
  return `event: response.failed\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** Terminal `response.completed` when upstream stalls after usable streamed items. */
export function responsesCompletedSse(input: {
  responseId: string;
  modelId: string;
  output?: unknown[];
}): string {
  const payload = {
    type: "response.completed",
    response: {
      id: input.responseId,
      object: "response",
      status: "completed",
      model: input.modelId,
      output: input.output ?? [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    },
  };
  return `event: response.completed\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function isResponsesToolOutputItem(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const type = (item as { type?: unknown }).type;
  return (
    type === "custom_tool_call" ||
    type === "function_call" ||
    type === "tool_call" ||
    type === "computer_call" ||
    type === "file_search_call" ||
    type === "web_search_call" ||
    type === "code_interpreter_call"
  );
}

export function isIncompleteResponsesCompletedRemainder(remainder: string): boolean {
  const head = remainder.trimStart().slice(0, 120);
  if (head.startsWith("event: response.completed")) {
    return true;
  }
  if (head.startsWith('data: {"type":"response.completed"')) {
    return true;
  }
  return head.startsWith('data: {"sequence_number"') && head.includes("response.completed");
}
