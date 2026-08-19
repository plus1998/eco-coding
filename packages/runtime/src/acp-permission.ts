import type {
  AcpPermissionOption,
  AcpPermissionOutcome,
  AcpPermissionRequest,
  AcpPermissionToolCall,
} from "./acp-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Eco 完全访问：宿主对 request_permission 自动放行。always/auto 由 Eco 审批卡/辅助模型接管。 */
export function shouldHostAutoAllowAcpPermission(input: {
  bashReviewMode: string | undefined;
  request: AcpPermissionRequest;
}): boolean {
  if (isAcpSwitchModePermission(input.request)) {
    return true;
  }
  return input.bashReviewMode === "allow_all";
}

export function parseAcpPermissionRequest(params: unknown): AcpPermissionRequest | undefined {
  if (!isRecord(params) || !isRecord(params.toolCall)) {
    return undefined;
  }
  const toolCallId =
    typeof params.toolCall.toolCallId === "string" ? params.toolCall.toolCallId.trim() : "";
  if (!toolCallId) {
    return undefined;
  }
  const rawOptions = Array.isArray(params.options) ? params.options : [];
  const options: AcpPermissionOption[] = [];
  for (const entry of rawOptions) {
    if (!isRecord(entry) || typeof entry.optionId !== "string" || !entry.optionId.trim()) {
      continue;
    }
    options.push({
      optionId: entry.optionId.trim(),
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.kind === "string" ? { kind: entry.kind } : {}),
    });
  }
  if (options.length === 0) {
    return undefined;
  }
  const toolCall: AcpPermissionToolCall = {
    ...params.toolCall,
    toolCallId,
    ...(typeof params.toolCall.title === "string" ? { title: params.toolCall.title } : {}),
    ...(typeof params.toolCall.kind === "string" ? { kind: params.toolCall.kind } : {}),
    ...(isRecord(params.toolCall.rawInput) ? { rawInput: params.toolCall.rawInput } : {}),
    ...("locations" in params.toolCall ? { locations: params.toolCall.locations } : {}),
  };
  return {
    toolCall,
    options,
    ...(typeof params.sessionId === "string" ? { sessionId: params.sessionId } : {}),
  };
}

export function isAcpSwitchModePermission(request: AcpPermissionRequest): boolean {
  const kind = request.toolCall.kind?.trim().toLowerCase() ?? "";
  return kind === "switch_mode";
}

export function selectAcpPermissionOption(
  options: readonly AcpPermissionOption[],
  preference: "allow" | "reject",
  remember = false,
): AcpPermissionOption | undefined {
  if (preference === "allow") {
    if (remember) {
      const always = options.find((option) => option.kind === "allow_always");
      if (always) return always;
    }
    return (
      options.find((option) => option.kind === "allow_once") ??
      options.find((option) => option.kind === "allow_always")
    );
  }
  return (
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => option.kind === "reject_always")
  );
}

export function acpPermissionSelected(optionId: string): AcpPermissionOutcome {
  return { outcome: { outcome: "selected", optionId } };
}

export function acpPermissionCancelled(): AcpPermissionOutcome {
  return { outcome: { outcome: "cancelled" } };
}

export function resolveAcpPermissionSelection(
  options: readonly AcpPermissionOption[],
  preference: "allow" | "reject",
  remember = false,
): AcpPermissionOutcome | undefined {
  const option = selectAcpPermissionOption(options, preference, remember);
  return option ? acpPermissionSelected(option.optionId) : undefined;
}

/** Handshake / no-handler fallback: pick allow_once (then allow_always) so the turn is not stalled. */
export function resolveAcpPermissionAutoAllow(params: unknown): AcpPermissionOutcome {
  const parsed = parseAcpPermissionRequest(params);
  if (parsed) {
    const selected = resolveAcpPermissionSelection(parsed.options, "allow");
    if (selected) return selected;
  }
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
  const allow = options.find(
    (option) =>
      isRecord(option) &&
      typeof option.optionId === "string" &&
      (option.kind === "allow_once" || option.kind === "allow_always"),
  );
  if (allow && isRecord(allow) && typeof allow.optionId === "string") {
    return acpPermissionSelected(allow.optionId);
  }
  const first = options.find((option) => isRecord(option) && typeof option.optionId === "string");
  if (first && isRecord(first) && typeof first.optionId === "string") {
    return acpPermissionSelected(first.optionId);
  }
  throw new Error("ACP session/request_permission had no selectable option");
}

export function resolveAcpPermissionReject(params: unknown): AcpPermissionOutcome | undefined {
  const parsed = parseAcpPermissionRequest(params);
  if (parsed) {
    return resolveAcpPermissionSelection(parsed.options, "reject");
  }
  return undefined;
}

export function acpPermissionCommandPreview(toolCall: AcpPermissionToolCall): string {
  const raw = toolCall.rawInput;
  if (raw) {
    for (const key of ["command", "cmd", "query", "url"] as const) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  const path = acpPermissionFilesystemPath(toolCall);
  if (path) {
    const tool = acpPermissionToolName(toolCall);
    return `${tool} ${path}`;
  }
  if (typeof toolCall.title === "string" && toolCall.title.trim()) {
    return toolCall.title.trim();
  }
  return toolCall.toolCallId;
}

export function acpPermissionFilesystemPath(toolCall: AcpPermissionToolCall): string | undefined {
  const raw = toolCall.rawInput;
  if (raw) {
    for (const key of ["path", "file_path", "filePath"] as const) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  if (!Array.isArray(toolCall.locations)) {
    return undefined;
  }
  for (const entry of toolCall.locations) {
    if (!isRecord(entry)) continue;
    if (typeof entry.path === "string" && entry.path.trim()) return entry.path.trim();
    if (typeof entry.file_path === "string" && entry.file_path.trim()) return entry.file_path.trim();
  }
  return undefined;
}

export function acpPermissionToolName(toolCall: AcpPermissionToolCall): string {
  const kind = toolCall.kind?.trim().toLowerCase() ?? "";
  const title = toolCall.title?.trim() ?? "";
  const titleKey = title.toLowerCase();
  if (kind === "execute") return "Bash";
  if (kind === "read" || titleKey === "read file" || titleKey === "read") return "Read";
  if (kind === "edit") return "Edit";
  if (kind === "delete") return "Delete";
  if (kind === "fetch") return "Fetch";
  if (kind === "search") {
    const id = toolCall.toolCallId.toLowerCase();
    if (id.includes("web_search") || titleKey.includes("web")) return "WebSearch";
    if (titleKey === "grep") return "Grep";
    return "Search";
  }
  if (title && !title.startsWith("`") && title.length <= 80) return title;
  return kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Tool";
}

export function acpPermissionIsExecute(toolCall: AcpPermissionToolCall): boolean {
  return toolCall.kind?.trim().toLowerCase() === "execute";
}
