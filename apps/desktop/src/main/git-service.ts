import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { mergeAgentRegistrySettings } from "./agent-registry-settings";
import {
  lookupRoutePricingHints,
  resolveRuntimeRoutesFromSettings,
  type RuntimeRoute,
} from "./billing-resolver";
import { summarizeCommitMessage } from "./git-commit-message";
import {
  checkoutGitBranch,
  createGitBranch,
  collectCommitDiffContext,
  createCommit,
  defaultGitRunner,
  getGitWorkingTreeStatus,
  getWorkspaceDiff,
  listGitCommits,
  pullChanges,
  pushChanges,
  stageChanges,
  type GitRunner,
} from "./git-operations";
import type { GitSettingsStore } from "./git-settings-store";
import type { ProviderStore } from "./provider-store";
import type { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import type { AgentOrchestrationStore } from "./agent-orchestration-store";
import {
  deriveSubagentEnabledFromProfile,
  getAgentProfileById,
  runtimeRoleRoutesFromAgentProfile,
} from "../shared/thread-runtime-config";
import {
  resolveCommitMessageRoute,
  type CommitMessageRolePreference,
} from "../shared/resolve-commit-message-route";
import type {
  GitCommitRequest,
  GitCommitResult,
  GitGenerateCommitMessageRequest,
  GitGenerateCommitMessageResult,
  GitPullRequest,
  GitPullResult,
  GitPushRequest,
  GitPushResult,
  RuntimeAgentRole,
  SubagentRole,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";

function runtimeRouteToProxyRoute(route: RuntimeRoute): AnthropicProxyRoute {
  return {
    role: route.role,
    provider: route.provider,
    modelId: route.modelId,
    ...(route.apiCompat && { apiCompat: route.apiCompat }),
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  };
}

async function resolveCommitProxyRoute(input: {
  profileId: string;
  rolePreference?: CommitMessageRolePreference;
  providerStore: ProviderStore;
  agentOrchestrationStore: AgentOrchestrationStore;
  gitSettingsStore: GitSettingsStore;
  pricingCache: ModelsDevPricingCache;
}): Promise<{ route: AnthropicProxyRoute; role: RuntimeAgentRole }> {
  const settings = mergeAgentRegistrySettings(
    input.providerStore.getSettings(),
    input.agentOrchestrationStore,
  );
  const profile = getAgentProfileById(settings, input.profileId);
  if (!profile) {
    throw new Error("未找到 Agent Profile，无法生成提交信息。");
  }
  const roleRoutes = runtimeRoleRoutesFromAgentProfile(profile);
  const providers = input.providerStore.listProvidersWithSecrets();
  const runtimeRoutes = resolveRuntimeRoutesFromSettings(settings, providers, roleRoutes);
  const hints = await lookupRoutePricingHints(input.pricingCache, settings, providers, roleRoutes);
  const enabledRoles = new Set<SubagentRole>(
    SUBAGENT_ROLES.filter((role) => deriveSubagentEnabledFromProfile(profile)[role]),
  );
  const savedRole =
    input.rolePreference ??
    input.gitSettingsStore.getCommitMessageRoleForProfile(input.profileId);
  const selected = resolveCommitMessageRoute(roleRoutes, hints, enabledRoles, savedRole);
  if (!selected) {
    throw new Error("当前 Agent Profile 没有可用的子代理路由，无法生成提交信息。");
  }
  const runtimeRoute = runtimeRoutes.find((route) => route.role === selected.role);
  if (!runtimeRoute) {
    throw new Error(`子代理 ${selected.role} 的 Provider 未配置或已禁用。`);
  }
  return { route: runtimeRouteToProxyRoute(runtimeRoute), role: selected.role };
}

export async function handleGitGenerateCommitMessage(
  request: GitGenerateCommitMessageRequest,
  deps: {
    providerStore: ProviderStore;
    agentOrchestrationStore: AgentOrchestrationStore;
    gitSettingsStore: GitSettingsStore;
    pricingCache: ModelsDevPricingCache;
    run?: GitRunner;
  },
): Promise<GitGenerateCommitMessageResult> {
  const run = deps.run ?? defaultGitRunner;
  await stageChanges(request.workspacePath, { includeUnstaged: request.includeUnstaged }, run);
  const context = await collectCommitDiffContext(request.workspacePath, request.includeUnstaged, run);
  if (!context.stagedNameStatus.trim() && !context.unstagedNameStatus?.trim()) {
    throw new Error("没有可提交的变更。");
  }
  const { route, role } = await resolveCommitProxyRoute({
    profileId: request.profileId,
    ...(request.role !== undefined && { rolePreference: request.role }),
    providerStore: deps.providerStore,
    agentOrchestrationStore: deps.agentOrchestrationStore,
    gitSettingsStore: deps.gitSettingsStore,
    pricingCache: deps.pricingCache,
  });
  const message = await summarizeCommitMessage(route, context);
  if (!message?.trim()) {
    throw new Error("模型未能生成有效的提交信息，请手动填写。");
  }
  return {
    message,
    role,
    modelId: route.modelId,
    providerName: route.provider.name,
  };
}

export async function handleGitCommit(
  request: GitCommitRequest,
  deps: {
    providerStore: ProviderStore;
    agentOrchestrationStore: AgentOrchestrationStore;
    gitSettingsStore: GitSettingsStore;
    pricingCache: ModelsDevPricingCache;
    run?: GitRunner;
  },
): Promise<GitCommitResult> {
  const run = deps.run ?? defaultGitRunner;
  await stageChanges(request.workspacePath, { includeUnstaged: request.includeUnstaged }, run);

  let message = request.message?.trim() ?? "";
  let generated = false;
  let role: RuntimeAgentRole | undefined;
  let modelId: string | undefined;

  if (!message) {
    const generatedResult = await handleGitGenerateCommitMessage(request, deps);
    message = generatedResult.message;
    generated = true;
    role = generatedResult.role;
    modelId = generatedResult.modelId;
  }

  const commitSha = await createCommit(request.workspacePath, message, run);
  return {
    commitSha,
    message,
    generated,
    ...(role && { role }),
    ...(modelId && { modelId }),
  };
}

export async function handleGitPush(
  request: GitPushRequest,
  run: GitRunner = defaultGitRunner,
): Promise<GitPushResult> {
  return pushChanges(
    request.workspacePath,
    request.branch ? { branch: request.branch } : {},
    run,
  );
}

export async function handleGitPull(
  request: GitPullRequest,
  run: GitRunner = defaultGitRunner,
): Promise<GitPullResult> {
  return pullChanges(
    request.workspacePath,
    request.branch ? { branch: request.branch } : {},
    run,
  );
}

export {
  checkoutGitBranch,
  createGitBranch,
  getGitWorkingTreeStatus,
  getWorkspaceDiff,
  listGitCommits,
};
