import type { EventStore } from "../../persistence/src";
import type { ApprovalDecision, ApprovalRequest } from "../../shared/src";
import {
  type CommandRequest,
  evaluateCommand,
  evaluateFileWrite,
  evaluateShellCommandText,
  type FileWriteRequest,
  type ShellCommandRequest,
} from "../../workspace/src";

export interface ApprovalServiceOptions {
  store: Pick<EventStore, "saveApproval">;
  idFactory?: () => string;
  clock?: () => string;
}

export class ApprovalService {
  private readonly approvals = new Map<string, ApprovalRequest>();

  constructor(private readonly options: ApprovalServiceOptions) {}

  async requestForCommand(
    context: Pick<ApprovalRequest, "threadId" | "agentId">,
    request: CommandRequest,
  ): Promise<ApprovalRequest | undefined> {
    const decision = evaluateCommand(request);
    if (decision.action === "allow") {
      return undefined;
    }

    return this.create({
      ...context,
      operation: request.command.join(" "),
      riskLevel: decision.riskLevel,
      cwd: request.cwd,
      command: request.command,
      reason: decision.reason,
      decision: decision.action === "deny" ? "denied" : "pending",
    });
  }

  async requestForShellCommand(
    context: Pick<ApprovalRequest, "threadId" | "agentId">,
    request: ShellCommandRequest,
  ): Promise<ApprovalRequest | undefined> {
    const decision = evaluateShellCommandText(request);
    if (decision.action === "allow") {
      return undefined;
    }

    return this.create({
      ...context,
      operation: request.command,
      riskLevel: decision.riskLevel,
      cwd: request.cwd,
      command: ["sh", "-lc", request.command],
      reason: decision.reason,
      decision: decision.action === "deny" ? "denied" : "pending",
    });
  }

  async requestForFileWrite(
    context: Pick<ApprovalRequest, "threadId" | "agentId">,
    request: FileWriteRequest,
  ): Promise<ApprovalRequest | undefined> {
    const decision = evaluateFileWrite(request);
    if (decision.action === "allow") {
      return undefined;
    }

    return this.create({
      ...context,
      operation: "file.write",
      riskLevel: decision.riskLevel,
      cwd: request.workspacePath,
      filePath: request.filePath,
      reason: decision.reason,
      decision: decision.action === "deny" ? "denied" : "pending",
    });
  }

  async resolve(
    approvalId: string,
    decision: Exclude<ApprovalDecision, "pending">,
  ): Promise<ApprovalRequest> {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} was not found`);
    }

    const resolved: ApprovalRequest = {
      ...approval,
      decision,
      resolvedAt: this.now(),
    };
    this.approvals.set(approvalId, resolved);
    await this.options.store.saveApproval(resolved);
    return resolved;
  }

  private async create(
    input: Omit<ApprovalRequest, "id" | "createdAt" | "resolvedAt">,
  ): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = {
      ...input,
      id: this.options.idFactory?.() ?? crypto.randomUUID(),
      createdAt: this.now(),
    };
    this.approvals.set(approval.id, approval);
    await this.options.store.saveApproval(approval);
    return approval;
  }

  private now(): string {
    return this.options.clock?.() ?? new Date().toISOString();
  }
}
