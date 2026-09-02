import { jsonMarshal } from "./json.js";
import type {
  ResponsesContentPart,
  ResponsesOutput,
  ResponsesStreamEvent,
  ResponsesSummary,
} from "./types.js";

/** Serialize a Responses stream event with required zero-value fields for strict clients. */
export function responsesStreamEventToJSON(evt: ResponsesStreamEvent): string {
  switch (evt.type) {
    case "response.output_text.delta":
    case "response.output_text.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      m.content_index = evt.content_index ?? 0;
      if (evt.type === "response.output_text.done") {
        m.text = evt.text ?? "";
      } else {
        m.delta = evt.delta ?? "";
      }
      return jsonMarshal(m);
    }

    case "response.content_part.added":
    case "response.content_part.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      m.content_index = evt.content_index ?? 0;
      m.part = outputTextPartWire(evt.part);
      return jsonMarshal(m);
    }

    case "response.reasoning_summary_text.delta":
    case "response.reasoning_summary_text.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      m.summary_index = evt.summary_index ?? 0;
      if (evt.type === "response.reasoning_summary_text.done") {
        m.text = evt.text ?? "";
      } else {
        m.delta = evt.delta ?? "";
      }
      return jsonMarshal(m);
    }

    case "response.reasoning_text.delta":
    case "response.reasoning_text.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      m.content_index = evt.content_index ?? 0;
      if (evt.type === "response.reasoning_text.done") {
        m.text = evt.text ?? "";
      } else {
        m.delta = evt.delta ?? "";
      }
      return jsonMarshal(m);
    }

    case "response.reasoning_summary_part.added":
    case "response.reasoning_summary_part.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      m.summary_index = evt.summary_index ?? 0;
      m.part = summaryTextPartWire(evt.part);
      return jsonMarshal(m);
    }

    case "response.output_item.added":
    case "response.output_item.done": {
      const m = wireBase(evt);
      m.output_index = evt.output_index ?? 0;
      m.item = responsesItemWire(evt.item);
      return jsonMarshal(m);
    }

    case "response.function_call_arguments.delta":
    case "response.function_call_arguments.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      if (evt.call_id !== undefined && evt.call_id !== "") {
        m.call_id = evt.call_id;
      }
      if (evt.name !== undefined && evt.name !== "") {
        m.name = evt.name;
      }
      if (evt.namespace !== undefined && evt.namespace !== "") {
        m.namespace = evt.namespace;
      }
      if (evt.type === "response.function_call_arguments.done") {
        m.arguments = evt.arguments ?? "";
      } else {
        m.delta = evt.delta ?? "";
      }
      return jsonMarshal(m);
    }

    case "response.custom_tool_call_input.delta":
    case "response.custom_tool_call_input.done": {
      const m = wireBase(evt);
      putItemID(m, evt);
      m.output_index = evt.output_index ?? 0;
      if (evt.call_id !== undefined && evt.call_id !== "") {
        m.call_id = evt.call_id;
      }
      if (evt.name !== undefined && evt.name !== "") {
        m.name = evt.name;
      }
      if (evt.type === "response.custom_tool_call_input.done") {
        m.input = evt.input ?? "";
      } else {
        m.delta = evt.delta ?? "";
      }
      return jsonMarshal(m);
    }

    default:
      return jsonMarshal(evt);
  }
}

function wireBase(evt: ResponsesStreamEvent): Record<string, unknown> {
  return {
    type: evt.type,
    sequence_number: evt.sequence_number ?? 0,
  };
}

function putItemID(m: Record<string, unknown>, evt: ResponsesStreamEvent): void {
  if (evt.item_id !== undefined && evt.item_id !== "") {
    m.item_id = evt.item_id;
  }
}

function outputTextPartWire(part: ResponsesContentPart | undefined): Record<string, unknown> {
  const text = part?.text ?? "";
  return {
    type: "output_text",
    text,
    annotations: [],
    logprobs: [],
  };
}

function summaryTextPartWire(part: ResponsesContentPart | undefined): Record<string, unknown> {
  return {
    type: "summary_text",
    text: part?.text ?? "",
  };
}

function responsesItemWire(item: ResponsesOutput | undefined): Record<string, unknown> {
  if (item === undefined) {
    return {};
  }
  const m: Record<string, unknown> = {
    type: item.type,
    id: item.id ?? "",
  };
  if (item.status !== undefined && item.status !== "") {
    m.status = item.status;
  }
  switch (item.type) {
    case "message": {
      let role = item.role;
      if (role === undefined || role === "") {
        role = "assistant";
      }
      m.role = role;
      m.content = messageContentWire(item.content ?? []);
      break;
    }
    case "reasoning":
      m.summary = reasoningSummaryWire(item.summary ?? []);
      if (item.content !== undefined) {
        m.content = reasoningContentWire(item.content);
      }
      if (item.encrypted_content !== undefined && item.encrypted_content !== "") {
        m.encrypted_content = item.encrypted_content;
      }
      break;
    case "function_call":
      m.call_id = item.call_id ?? "";
      m.name = item.name ?? "";
      if (item.namespace !== undefined && item.namespace !== "") {
        m.namespace = item.namespace;
      }
      m.arguments = item.arguments ?? "";
      break;
    case "custom_tool_call":
      m.call_id = item.call_id ?? "";
      m.name = item.name ?? "";
      m.input = item.input ?? "";
      break;
    case "tool_search_call":
      m.call_id = item.call_id ?? "";
      if (item.execution !== undefined && item.execution !== "") {
        m.execution = item.execution;
      }
      m.arguments = item.arguments ?? "";
      break;
  }
  return m;
}

function messageContentWire(parts: ResponsesContentPart[]): Record<string, unknown>[] {
  return parts.map((p) => {
    let typ = p.type;
    if (typ === "") {
      typ = "output_text";
    }
    return { type: typ, text: p.text ?? "" };
  });
}

function reasoningSummaryWire(summary: ResponsesSummary[]): Record<string, unknown>[] {
  return summary.map((s) => {
    let typ = s.type;
    if (typ === "") {
      typ = "summary_text";
    }
    return { type: typ, text: s.text ?? "" };
  });
}

function reasoningContentWire(parts: ResponsesContentPart[]): Record<string, unknown>[] {
  return parts
    .filter((part) => part.type === "reasoning_text" || part.type === "text")
    .map((part) => ({ type: part.type, text: part.text ?? "" }));
}
