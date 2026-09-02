import {
  CUSTOM_TOOL_INPUT_FIELD,
  canonicalJsonString,
  flattenNamespaceToolName,
  TOOL_SEARCH_PROXY_NAME,
} from "./codex-chat-common.js";
import type { ChatFunction, ChatTool, ResponsesRequest, ResponsesTool } from "./types.js";

export type CodexToolKind = "function" | "namespace" | "custom" | "tool_search";

export interface CodexToolSpec {
  kind: CodexToolKind;
  name: string;
  namespace?: string;
}

export interface CodexToolContext {
  chatTools: ChatTool[];
  chatNameToSpec: Map<string, CodexToolSpec>;
  namespaceNameToChatName: Map<string, string>;
}

function namespaceKey(namespace: string, name: string): string {
  return `${namespace}\0${name}`;
}

export function emptyCodexToolContext(): CodexToolContext {
  return {
    chatTools: [],
    chatNameToSpec: new Map(),
    namespaceNameToChatName: new Map(),
  };
}

export function codexToolContextFromRequestToolNames(requestToolNames: readonly string[]): CodexToolContext {
  const context = emptyCodexToolContext();
  for (const chatName of requestToolNames) {
    if (!chatName) {
      continue;
    }
    const split = splitChatToolName(chatName);
    addChatTool(
      context,
      chatName,
      split.namespace
        ? { kind: "namespace", name: split.name, namespace: split.namespace }
        : { kind: "function", name: chatName },
      { type: "function", function: { name: chatName } },
    );
  }
  return context;
}

/** Split a flattened chat tool name for allowlist-only contexts (no Responses request). */
function splitChatToolName(fullName: string): { name: string; namespace?: string } {
  if (fullName.startsWith("mcp__")) {
    const rest = fullName.slice("mcp__".length);
    const separatorIndex = rest.indexOf("__");
    if (separatorIndex > 0) {
      const server = rest.slice(0, separatorIndex);
      const tool = rest.slice(separatorIndex + 2);
      if (server && tool) {
        return { namespace: `mcp__${server}`, name: tool };
      }
    }
    return { name: fullName };
  }
  const separatorIndex = fullName.indexOf("__");
  if (separatorIndex > 0) {
    const namespace = fullName.slice(0, separatorIndex);
    const name = fullName.slice(separatorIndex + 2);
    if (namespace && name) {
      return { namespace, name };
    }
  }
  return { name: fullName };
}

export function buildCodexToolContextFromRequest(req: ResponsesRequest | null | undefined): CodexToolContext {
  const context = emptyCodexToolContext();
  if (req === null || req === undefined) {
    return context;
  }
  for (const tool of req.tools ?? []) {
    addResponseTool(context, tool);
  }
  collectToolSearchOutputTools(req.input, context);
  return context;
}

export function isCustomToolChatName(context: CodexToolContext, chatName: string): boolean {
  return context.chatNameToSpec.get(chatName)?.kind === "custom";
}

export function lookupChatName(context: CodexToolContext, chatName: string): CodexToolSpec | undefined {
  return context.chatNameToSpec.get(chatName);
}

export function chatNameForResponseFunction(
  context: CodexToolContext,
  name: string,
  namespace?: string,
): string {
  if (namespace) {
    const mapped = context.namespaceNameToChatName.get(namespaceKey(namespace, name));
    if (mapped) {
      return mapped;
    }
    return flattenNamespaceToolName(namespace, name);
  }
  return name;
}

export function requestToolNamesFromContext(context: CodexToolContext): string[] {
  return context.chatTools.map((tool) => tool.function?.name ?? "").filter((name) => name !== "");
}

function addChatTool(
  context: CodexToolContext,
  chatName: string,
  spec: CodexToolSpec,
  chatTool: ChatTool,
): void {
  if (chatName.trim() === "" || context.chatNameToSpec.has(chatName)) {
    return;
  }
  if (spec.namespace) {
    context.namespaceNameToChatName.set(namespaceKey(spec.namespace, spec.name), chatName);
  }
  context.chatNameToSpec.set(chatName, spec);
  context.chatTools.push(chatTool);
}

function addFunctionTool(context: CodexToolContext, tool: ResponsesTool, namespace?: string): void {
  const originalName = responsesToolName(tool);
  if (!originalName) {
    return;
  }
  const chatName = namespace ? flattenNamespaceToolName(namespace, originalName) : originalName;
  const chatTool = responsesFunctionToolToChatTool(tool, chatName);
  if (!chatTool) {
    return;
  }
  addChatTool(
    context,
    chatName,
    {
      kind: namespace ? "namespace" : "function",
      name: originalName,
      ...(namespace ? { namespace } : {}),
    },
    chatTool,
  );
}

function addCustomTool(context: CodexToolContext, tool: ResponsesTool): void {
  const name = responsesToolName(tool);
  if (!name) {
    return;
  }
  const description = responsesCustomToolDescription(tool);
  const chatTool: ChatTool = {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: {
          [CUSTOM_TOOL_INPUT_FIELD]: {
            type: "string",
            description:
              "Raw string input for the original custom tool. Preserve formatting exactly and follow the original tool definition embedded in the description.",
          },
        },
        required: [CUSTOM_TOOL_INPUT_FIELD],
      },
    },
  };
  addChatTool(context, name, { kind: "custom", name }, chatTool);
}

function addToolSearchTool(context: CodexToolContext): void {
  const chatTool: ChatTool = {
    type: "function",
    function: {
      name: TOOL_SEARCH_PROXY_NAME,
      description:
        "Search and load Codex tools, plugins, connectors, and MCP namespaces for the current task.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for tools or connectors to load.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of tool groups to return.",
          },
        },
        required: ["query"],
      },
    },
  };
  addChatTool(
    context,
    TOOL_SEARCH_PROXY_NAME,
    { kind: "tool_search", name: TOOL_SEARCH_PROXY_NAME },
    chatTool,
  );
}

function addNamespaceTool(context: CodexToolContext, namespaceTool: ResponsesTool): void {
  const namespace = (namespaceTool.name ?? "").replace(/_+$/g, "");
  if (!namespace) {
    return;
  }
  for (const child of namespaceTool.tools ?? []) {
    if (child.type === "function") {
      addFunctionTool(context, child, namespace);
    }
  }
}

function addResponseTool(context: CodexToolContext, tool: ResponsesTool | string): void {
  if (typeof tool === "string") {
    addCustomTool(context, { type: "custom", name: tool });
    return;
  }
  switch (tool.type) {
    case "function":
      addFunctionTool(context, tool);
      break;
    case "custom":
      addCustomTool(context, tool);
      break;
    case "tool_search":
      addToolSearchTool(context);
      break;
    case "namespace":
      addNamespaceTool(context, tool);
      break;
    default:
      break;
  }
}

function collectToolSearchOutputTools(value: unknown, context: CodexToolContext): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectToolSearchOutputTools(item, context);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  const obj = value as Record<string, unknown>;
  if (obj.type === "tool_search_output" && Array.isArray(obj.tools)) {
    for (const tool of obj.tools) {
      addResponseTool(context, tool as ResponsesTool);
    }
  }
  for (const nested of Object.values(obj)) {
    collectToolSearchOutputTools(nested, context);
  }
}

function responsesToolName(tool: ResponsesTool): string | undefined {
  const name = tool.name?.trim();
  return name ? name : undefined;
}

function responsesCustomToolDescription(tool: ResponsesTool): string {
  return `Original tool definition:\n\`\`\`json\n${canonicalJsonString(tool)}\n\`\`\``;
}

function responsesFunctionToolToChatTool(tool: ResponsesTool, chatName: string): ChatTool | undefined {
  if (tool.type !== "function") {
    return undefined;
  }
  const fn: ChatFunction = { name: chatName };
  if (tool.description !== undefined) {
    fn.description = tool.description;
  }
  if (tool.parameters !== undefined) {
    fn.parameters = tool.parameters;
  }
  if (tool.strict !== undefined) {
    fn.strict = tool.strict;
  }
  return { type: "function", function: fn };
}
