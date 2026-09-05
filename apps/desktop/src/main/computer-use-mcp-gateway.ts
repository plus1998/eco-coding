import { spawn } from "node:child_process";
import type { CodexMcpServerForConfigSync } from "@eco/runtime";
import {
  buildEcoComputerUsePromptAppend,
  ECO_COMPUTER_USE_ALLOWED_TOOL,
  ECO_COMPUTER_USE_MCP_SERVER,
  ECO_COMPUTER_USE_TOOLS,
  shouldAutoApproveEcoComputerUseTools,
  type ComputerUseSettingsSnapshot,
} from "../shared/computer-use";
import type { McpSdkConfig } from "../shared/mcp";
import {
  resolveOpenComputerUseBinary,
  type OpenComputerUseResolveResult,
} from "./open-computer-use-resolve";

export interface ComputerUseMcpInjection {
  enabled: boolean;
  serverName: typeof ECO_COMPUTER_USE_MCP_SERVER;
  sdkEntry?: Record<string, unknown>;
  codexServer?: CodexMcpServerForConfigSync;
  allowedToolPattern?: string;
  autoApproveTools?: boolean;
  promptAppend?: string;
  unavailableReason?: string;
}

export interface ComputerUseFeatureAvailability {
  available: boolean;
  reason?: string;
  /** Raw doctor stdout/stderr when probed (macOS). */
  doctorOutput?: string;
}

export type ComputerUseSettingsGetter = () => ComputerUseSettingsSnapshot;

const DOCTOR_TIMEOUT_MS = 12_000;

/**
 * Probe OS permissions via `open-computer-use doctor`.
 * On success exits 0. Non-zero / timeout / spawn failure → unavailable with reason.
 * Windows/Linux still run doctor when the binary supports it; failure surfaces as unavailable.
 */
export async function probeOpenComputerUseDoctor(
  binaryPath: string,
  timeoutMs: number = DOCTOR_TIMEOUT_MS,
): Promise<{ ok: boolean; output: string; reason?: string }> {
  return await new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const child = spawn(binaryPath, ["doctor"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (result: { ok: boolean; output: string; reason?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({
        ok: false,
        output: Buffer.concat(chunks).toString("utf8").trim(),
        reason: "open-computer-use doctor 超时；无法确认系统权限。",
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        output: "",
        reason: `无法启动 open-computer-use doctor：${error.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8").trim();
      if (code === 0) {
        finish({ ok: true, output });
        return;
      }
      finish({
        ok: false,
        output,
        reason:
          output ||
          `open-computer-use doctor 失败（退出码 ${code ?? "unknown"}）。请授予 Accessibility / Screen Recording（macOS）或确认桌面会话可用。`,
      });
    });
  });
}

export class ComputerUseMcpGateway {
  constructor(private readonly getSettings: ComputerUseSettingsGetter) {}

  resolveBinary(): OpenComputerUseResolveResult {
    return resolveOpenComputerUseBinary();
  }

  /**
   * Settings master switch must be on and binary present.
   * Does not run doctor (cheap UI poll). Use {@link checkFeatureAvailable} before enabling.
   */
  isFeatureAvailableQuick(): ComputerUseFeatureAvailability {
    const settings = this.getSettings();
    if (!settings.agentIntegrationEnabled) {
      return { available: false, reason: "电脑操控 Agent 能力未在设置中开启" };
    }
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return { available: false, reason: resolved.reason ?? "open-computer-use 不可用" };
    }
    return { available: true };
  }

  /** Full gate used when turning the master switch on (includes doctor). */
  async checkFeatureAvailable(): Promise<ComputerUseFeatureAvailability> {
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return { available: false, reason: resolved.reason ?? "open-computer-use 不可用" };
    }
    const doctor = await probeOpenComputerUseDoctor(resolved.binaryPath);
    if (!doctor.ok) {
      return {
        available: false,
        reason: doctor.reason ?? "系统权限未就绪",
        ...(doctor.output ? { doctorOutput: doctor.output } : {}),
      };
    }
    return {
      available: true,
      ...(doctor.output ? { doctorOutput: doctor.output } : {}),
    };
  }

  getAgentPromptAppend(sessionEnabled: boolean): string | undefined {
    if (!sessionEnabled || !this.getSettings().agentIntegrationEnabled) {
      return undefined;
    }
    return buildEcoComputerUsePromptAppend();
  }

  async resolveGlobalCodexServer(): Promise<CodexMcpServerForConfigSync | undefined> {
    if (!this.getSettings().agentIntegrationEnabled) {
      return undefined;
    }
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      throw new Error(resolved.reason ?? "open-computer-use unavailable");
    }
    return {
      name: ECO_COMPUTER_USE_MCP_SERVER,
      transport: "stdio",
      command: resolved.binaryPath,
      args: ["mcp"],
      enabledTools: [...ECO_COMPUTER_USE_TOOLS],
      startupTimeoutSec: 60,
    };
  }

  async resolveInjection(input: {
    threadId: string;
    sessionEnabled: boolean;
  }): Promise<ComputerUseMcpInjection> {
    const settings = this.getSettings();
    if (!settings.agentIntegrationEnabled) {
      return { enabled: false, serverName: ECO_COMPUTER_USE_MCP_SERVER };
    }
    if (!input.sessionEnabled) {
      return { enabled: false, serverName: ECO_COMPUTER_USE_MCP_SERVER };
    }
    const resolved = this.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return {
        enabled: false,
        serverName: ECO_COMPUTER_USE_MCP_SERVER,
        unavailableReason: resolved.reason ?? "open-computer-use 不可用",
      };
    }
    const autoApproveTools = shouldAutoApproveEcoComputerUseTools(settings.actionApprovalMode);
    const codexServer: CodexMcpServerForConfigSync = {
      name: ECO_COMPUTER_USE_MCP_SERVER,
      transport: "stdio",
      command: resolved.binaryPath,
      args: ["mcp"],
      enabledTools: [...ECO_COMPUTER_USE_TOOLS],
      startupTimeoutSec: 60,
    };
    return {
      enabled: true,
      serverName: ECO_COMPUTER_USE_MCP_SERVER,
      sdkEntry: {
        type: "stdio",
        command: resolved.binaryPath,
        args: ["mcp"],
        alwaysLoad: true,
      },
      codexServer,
      allowedToolPattern: ECO_COMPUTER_USE_ALLOWED_TOOL,
      autoApproveTools,
      promptAppend: buildEcoComputerUsePromptAppend(),
    };
  }

  mergeIntoSdkConfig(base: McpSdkConfig, injection: ComputerUseMcpInjection): McpSdkConfig {
    if (!injection.enabled || !injection.sdkEntry) {
      return base;
    }
    const allowedTools = [...base.allowedTools];
    if (injection.autoApproveTools && injection.allowedToolPattern) {
      allowedTools.push(injection.allowedToolPattern);
    } else if (injection.allowedToolPattern) {
      // Strip any prior auto-approve patterns for this server when always_ask.
      const filtered = allowedTools.filter((tool) => tool !== injection.allowedToolPattern);
      return {
        mcpServers: { ...base.mcpServers, [ECO_COMPUTER_USE_MCP_SERVER]: injection.sdkEntry },
        allowedTools: [...new Set(filtered)],
      };
    }
    return {
      mcpServers: { ...base.mcpServers, [ECO_COMPUTER_USE_MCP_SERVER]: injection.sdkEntry },
      allowedTools: [...new Set(allowedTools)],
    };
  }
}
