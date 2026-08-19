import {
  acpPermissionCancelled,
  acpPermissionCommandPreview,
  acpPermissionFilesystemPath,
  acpPermissionIsExecute,
  acpPermissionToolName,
  resolveAcpPermissionAutoAllow,
  resolveAcpPermissionSelection,
  shouldHostAutoAllowAcpPermission,
  type AcpPermissionHandler,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
} from "@eco/runtime";
import type { BashApprovalRequest, BashApprovalDecision } from "../shared/ipc";
import type { EcoApprovalReviewResult } from "./eco-approval-reviewer";
import type { BashApprovalResolution } from "./bash-approval-bridge";
import type { ThreadToolConfirmationInput, ToolConfirmationDecision } from "./thread-bash-permission";

export type AcpPermissionBridgeEmitType =
  | "bash_approval.requested"
  | "bash_approval.approved"
  | "bash_approval.rejected"
  | "bash_approval.denied";

export interface AcpPermissionBridgeDeps {
  getBashReviewMode: () => string | undefined;
  getCwd: () => string;
  getWorkspacePath: () => string;
  getPlannerAgentId: () => string | undefined;
  getRememberPrefixes: () => readonly string[];
  evaluateConfirmation: (input: ThreadToolConfirmationInput) => ToolConfirmationDecision;
  reviewApproval?: (
    request: BashApprovalRequest,
    tool: { toolName: string; toolInput: Record<string, unknown> },
  ) => Promise<EcoApprovalReviewResult>;
  registerPending: (threadId: string, request: BashApprovalRequest) => Promise<BashApprovalResolution>;
  rememberPrefix: (threadId: string, command: string) => void;
  emit: (type: AcpPermissionBridgeEmitType, message: string, request: BashApprovalRequest) => void;
}

export function mapAcpPermissionToBashApprovalRequest(input: {
  threadId: string;
  request: AcpPermissionRequest;
  cwd: string;
  agentId: string;
  reason: string;
  riskScore?: number;
  riskLevel?: BashApprovalRequest["riskLevel"];
  description?: string;
}): BashApprovalRequest {
  const command = acpPermissionCommandPreview(input.request.toolCall);
  const filesystemPath = acpPermissionFilesystemPath(input.request.toolCall);
  const toolName = acpPermissionToolName(input.request.toolCall);
  const kind = acpPermissionBashKind(input.request);
  return {
    toolUseId: input.request.toolCall.toolCallId,
    threadId: input.threadId,
    command,
    cwd: input.cwd,
    reason: input.reason,
    riskScore: input.riskScore ?? 50,
    riskLevel: input.riskLevel ?? "medium",
    agentId: input.agentId,
    description: input.description ?? input.request.toolCall.title ?? toolName,
    kind,
    ...(filesystemPath && kind === "file_change"
      ? { filesystemTool: toolName, filesystemPath }
      : {}),
  };
}

export function acpPermissionBashKind(
  request: AcpPermissionRequest,
): NonNullable<BashApprovalRequest["kind"]> {
  const kind = request.toolCall.kind?.trim().toLowerCase() ?? "";
  const id = request.toolCall.toolCallId.toLowerCase();
  if (kind === "edit" || kind === "delete" || kind === "move") return "file_change";
  if (kind === "fetch" || id.includes("web_search") || (kind === "search" && id.includes("web"))) {
    return "network";
  }
  return "command";
}

export function mapBashResolutionToAcpPermission(
  request: AcpPermissionRequest,
  resolution: BashApprovalResolution,
): AcpPermissionOutcome {
  const granted =
    resolution.decision === "approved" ||
    resolution.decision === "approved_remember_prefix" ||
    resolution.decision === "approved_for_session";
  if (!granted) {
    return (
      resolveAcpPermissionSelection(request.options, "reject") ?? acpPermissionCancelled()
    );
  }
  return (
    resolveAcpPermissionSelection(
      request.options,
      "allow",
      resolution.decision === "approved_remember_prefix" ||
        resolution.decision === "approved_for_session",
    ) ?? resolveAcpPermissionAutoAllow({ options: request.options, toolCall: request.toolCall })
  );
}

export function createAcpPermissionHandler(
  threadId: string,
  deps: AcpPermissionBridgeDeps,
): AcpPermissionHandler {
  return async (request) => {
    const bashReviewMode = deps.getBashReviewMode() ?? "always";
    if (shouldHostAutoAllowAcpPermission({ bashReviewMode, request })) {
      return resolveAcpPermissionAutoAllow({
        options: request.options,
        toolCall: request.toolCall,
      });
    }

    const agentId = deps.getPlannerAgentId()?.trim();
    if (!agentId) {
      const rejected = resolveAcpPermissionSelection(request.options, "reject");
      if (rejected) return rejected;
      throw new Error("Eco could not attribute this ACP approval to a planner agent instance.");
    }

    const cwd = deps.getCwd();
    const workspacePath = deps.getWorkspacePath();
    const toolName = acpPermissionToolName(request.toolCall);
    const command = acpPermissionCommandPreview(request.toolCall);

    if (acpPermissionIsExecute(request.toolCall)) {
      const confirmation = deps.evaluateConfirmation({
        command,
        cwd,
        workspacePath,
        confirmationMode: bashReviewMode as ThreadToolConfirmationInput["confirmationMode"],
        sessionBashRememberPrefixes: deps.getRememberPrefixes(),
      });
      if (confirmation.action === "deny") {
        const denied = mapAcpPermissionToBashApprovalRequest({
          threadId,
          request,
          cwd,
          agentId,
          reason: confirmation.reason,
          riskScore: confirmation.riskScore,
          riskLevel: confirmation.riskLevel,
          description: confirmation.userMessage,
        });
        deps.emit("bash_approval.denied", `已拒绝：${confirmation.userMessage}`, denied);
        return (
          resolveAcpPermissionSelection(request.options, "reject") ?? acpPermissionCancelled()
        );
      }
      if (confirmation.action === "allow") {
        return resolveAcpPermissionAutoAllow({
          options: request.options,
          toolCall: request.toolCall,
        });
      }

      let approvalRequest = mapAcpPermissionToBashApprovalRequest({
        threadId,
        request,
        cwd,
        agentId,
        reason: confirmation.reason,
        riskScore: confirmation.riskScore,
        riskLevel: confirmation.riskLevel,
        description: confirmation.userMessage,
      });

      if (bashReviewMode === "auto" && deps.reviewApproval) {
        const review = await deps.reviewApproval(approvalRequest, {
          toolName: "Bash",
          toolInput: request.toolCall.rawInput ?? { command },
        });
        if (review.action === "allow") {
          approvalRequest = { ...approvalRequest, reviewRationale: review.rationale };
          deps.emit("bash_approval.approved", `辅助模型已允许 Bash：${command}`, approvalRequest);
          return resolveAcpPermissionAutoAllow({
            options: request.options,
            toolCall: request.toolCall,
          });
        }
        if (review.action === "deny") {
          approvalRequest = { ...approvalRequest, reviewRationale: review.rationale };
          deps.emit("bash_approval.denied", `已拒绝 Bash：${review.rationale}`, approvalRequest);
          return (
            resolveAcpPermissionSelection(request.options, "reject") ?? acpPermissionCancelled()
          );
        }
        approvalRequest = { ...approvalRequest, reviewRationale: review.rationale };
      }

      return parkAcpBashApproval(threadId, request, approvalRequest, command, deps);
    }

    const approvalRequest = mapAcpPermissionToBashApprovalRequest({
      threadId,
      request,
      cwd,
      agentId,
      reason: `Cursor ACP 请求确认 ${toolName}`,
    });
    return parkAcpBashApproval(threadId, request, approvalRequest, command, deps);
  };
}

async function parkAcpBashApproval(
  threadId: string,
  request: AcpPermissionRequest,
  approvalRequest: BashApprovalRequest,
  command: string,
  deps: AcpPermissionBridgeDeps,
): Promise<AcpPermissionOutcome> {
  deps.emit("bash_approval.requested", `等待确认 ${approvalRequest.description ?? command}`, approvalRequest);
  try {
    const resolution = await deps.registerPending(threadId, approvalRequest);
    if (resolution.decision === "approved_remember_prefix") {
      deps.rememberPrefix(threadId, command);
    }
    const granted = isGrantedDecision(resolution.decision);
    deps.emit(
      granted ? "bash_approval.approved" : "bash_approval.rejected",
      granted ? `已允许：${command}` : `已拒绝：${command}`,
      approvalRequest,
    );
    return mapBashResolutionToAcpPermission(request, resolution);
  } catch {
    return acpPermissionCancelled();
  }
}

function isGrantedDecision(decision: BashApprovalDecision): boolean {
  return (
    decision === "approved" ||
    decision === "approved_remember_prefix" ||
    decision === "approved_for_session"
  );
}
