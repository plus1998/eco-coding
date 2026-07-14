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
