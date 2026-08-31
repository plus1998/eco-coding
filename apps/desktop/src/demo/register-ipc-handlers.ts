import { ipcMain, type WebContents } from "electron";
import type { BrowserViewState } from "../shared/browser";
import { defaultBrowserSettings } from "../shared/browser";
import type { DesktopUpdateState } from "../shared/desktop-update";
import type { IntegrationAvailabilitySnapshot } from "../shared/integrations";
import { IPC_CHANNELS } from "../shared/ipc";
import { DEMO_THREAD_ID, DEMO_WORKSPACE_PATH } from "./constants";
import {
  buildDemoSessionBootstrap,
  demoBillingSnapshot,
  demoCandidateModels,
  demoCenterServerSettings,
  demoContextSnapshot,
  demoCoreAvailability,
  demoGitSettings,
  demoGitStatus,
  demoMcpSettings,
  demoModelSettings,
  demoPersonalizationSettings,
  demoProvider,
  demoProxyBridgeSettings,
  demoRunProjection,
  demoSubagentMetrics,
  demoSubagentSessions,
  demoThreads,
  demoUsageLedgerEvents,
  demoWorkflowSettings,
  demoWorkspace,
  demoWorkspaceInspect,
  resolveDemoThreadId,
} from "./fixtures";

export interface DemoRuntimeState {
  pendingThreadOpenId?: string;
}

export const demoRuntimeState: DemoRuntimeState = {
  pendingThreadOpenId: DEMO_THREAD_ID,
};

const demoUpdateState: DesktopUpdateState = {
  phase: "disabled",
  capability: "disabled",
  currentVersion: "0.1.0-beta.2",
  reason: "development",
};

const demoIntegrationAvailability: IntegrationAvailabilitySnapshot = {
  integrations: [
    {
      id: "browser",
      enabled: false,
      available: true,
    },
    {
      id: "imageGeneration",
      enabled: false,
      available: false,
      reason: "演示模式未配置图片创建 Profile",
    },
  ],
};

const demoBrowserState: BrowserViewState = {
  uiScopeId: "personal",
  instances: [],
  guestInstances: [],
  allGuestInstances: [],
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  visible: false,
  agentIntegrationEnabled: false,
  agentBrowserAvailable: true,
};

type DemoHandler = (payload?: unknown, event?: Electron.IpcMainInvokeEvent) => unknown | Promise<unknown>;

export interface RegisterDemoIpcHandlersOptions {
  onRendererReady?: (webContents: WebContents) => void;
}

const EVENT_CHANNELS = new Set<string>([
  IPC_CHANNELS.appMenuCommand,
  IPC_CHANNELS.appUpdateStateChanged,
  IPC_CHANNELS.appThreadOpenRequested,
  IPC_CHANNELS.centerServerStatusChanged,
  IPC_CHANNELS.threadEventsSubscribe,
  IPC_CHANNELS.terminalEvent,
  IPC_CHANNELS.workspacePackageJsonChanged,
  IPC_CHANNELS.browserStateChanged,
  IPC_CHANNELS.gitGenerateCommitMessageDelta,
  IPC_CHANNELS.gitRemoteFetched,
]);

const handlers: Partial<Record<string, DemoHandler>> = {
  [IPC_CHANNELS.appRendererReady]: (_payload, event) => {
    if (event?.sender) {
      demoRendererReadyHook?.(event.sender);
    }
    return { ok: true as const };
  },
  [IPC_CHANNELS.appSetThemeSource]: (payload) => ({ themeSource: payload ?? "dark" }),
  [IPC_CHANNELS.appSetWindowTitlebarMode]: (payload) => ({
    mode: payload === "landing" ? "landing" : "conversation",
  }),
  [IPC_CHANNELS.appSetLocale]: (payload) => ({ localePreference: payload ?? "system" }),
  [IPC_CHANNELS.appUpdateGetState]: () => demoUpdateState,
  [IPC_CHANNELS.appUpdateCheck]: () => demoUpdateState,
  [IPC_CHANNELS.appUpdateDownload]: () => demoUpdateState,
  [IPC_CHANNELS.appUpdateInstall]: () => demoUpdateState,
  [IPC_CHANNELS.appUpdateOpenRelease]: () => ({ ok: true as const }),
  [IPC_CHANNELS.appConsumePendingThreadOpen]: () => DEMO_THREAD_ID,
  [IPC_CHANNELS.appShowThreadCompletionNotification]: () => ({ shown: false, reason: "preference_disabled" }),
  [IPC_CHANNELS.appShowThreadApprovalNotification]: () => ({ shown: false, reason: "preference_disabled" }),
  [IPC_CHANNELS.appShowThreadClarificationNotification]: () => ({ shown: false, reason: "preference_disabled" }),
  [IPC_CHANNELS.coreAvailabilityGet]: () => demoCoreAvailability,
  [IPC_CHANNELS.cursorModelsList]: () => [],
  [IPC_CHANNELS.workspaceGetCurrent]: () => demoWorkspace,
  [IPC_CHANNELS.workspaceGetHomePath]: () => demoWorkspace.path,
  [IPC_CHANNELS.workspaceGetUserHomePath]: () => "/Users/demo",
  [IPC_CHANNELS.workspaceInspect]: () => demoWorkspaceInspect,
  [IPC_CHANNELS.workspaceListEntries]: () => [
    { name: "apps", path: `${demoWorkspace.path}/apps`, kind: "directory" as const },
    { name: "packages", path: `${demoWorkspace.path}/packages`, kind: "directory" as const },
    { name: "supabase", path: `${demoWorkspace.path}/supabase`, kind: "directory" as const },
    { name: "README.md", path: `${demoWorkspace.path}/README.md`, kind: "file" as const },
  ],
  [IPC_CHANNELS.workspaceListPackageScripts]: () => ({ scripts: [] }),
  [IPC_CHANNELS.workspaceWatchPackageJson]: () => ({ ok: true as const }),
  [IPC_CHANNELS.workspaceOpen]: () => ({ canceled: true }),
  [IPC_CHANNELS.workspaceOpenPath]: () => demoWorkspace,
  [IPC_CHANNELS.modelSettingsGet]: () => demoModelSettings,
  [IPC_CHANNELS.settingsDigest]: () => ({ digest: "demo-mode", updatedAt: demoThreads[0]?.updatedAt ?? "" }),
  [IPC_CHANNELS.mcpSettingsGet]: () => demoMcpSettings,
  [IPC_CHANNELS.workflowSettingsGet]: () => demoWorkflowSettings,
  [IPC_CHANNELS.workflowSettingsSave]: (payload) => payload,
  [IPC_CHANNELS.proxyBridgeSettingsGet]: () => demoProxyBridgeSettings,
  [IPC_CHANNELS.centerServerSettingsGet]: () => demoCenterServerSettings,
  [IPC_CHANNELS.gitSettingsGet]: () => demoGitSettings,
  [IPC_CHANNELS.personalizationSettingsGet]: () => demoPersonalizationSettings,
  [IPC_CHANNELS.browserSettingsGet]: () => defaultBrowserSettings(),
  [IPC_CHANNELS.integrationAvailabilityGet]: () => demoIntegrationAvailability,
  [IPC_CHANNELS.imageGenerationSettingsGet]: () => ({
    enabled: false,
    profiles: [],
    activeProfileId: "",
    apiKeyEncryptionAvailable: false,
  }),
  [IPC_CHANNELS.webChatListGet]: () => ({ items: [] }),
  [IPC_CHANNELS.notificationSettingsGet]: () => ({
    turnCompletion: "never",
    permissionEnabled: true,
    questionEnabled: true,
  }),
  [IPC_CHANNELS.threadList]: () => demoThreads,
  [IPC_CHANNELS.threadListInitial]: () => ({ threads: demoThreads, hasMore: false }),
  [IPC_CHANNELS.threadListMore]: () => ({ threads: [], hasMore: false }),
  [IPC_CHANNELS.threadGet]: (payload) => demoThreads.find((thread) => thread.id === resolveDemoThreadId(payload)),
  [IPC_CHANNELS.threadSessionBootstrap]: (payload) =>
    buildDemoSessionBootstrap(resolveDemoThreadId(payload) ?? DEMO_THREAD_ID),
  [IPC_CHANNELS.threadRunProjectionGet]: (payload) => {
    const threadId = resolveDemoThreadId(payload);
    return threadId === DEMO_THREAD_ID ? demoRunProjection : undefined;
  },
  [IPC_CHANNELS.threadSubagentSessionsList]: (payload) =>
    resolveDemoThreadId(payload) === DEMO_THREAD_ID ? demoSubagentSessions : [],
  [IPC_CHANNELS.threadSubagentMetricsList]: (payload) =>
    resolveDemoThreadId(payload) === DEMO_THREAD_ID ? demoSubagentMetrics : [],
  [IPC_CHANNELS.threadGetUsageSnapshot]: (payload) =>
    resolveDemoThreadId(payload) === DEMO_THREAD_ID
      ? { billing: demoBillingSnapshot, context: demoContextSnapshot }
      : {},
  [IPC_CHANNELS.threadUsageLedgerEventsList]: (payload) =>
    resolveDemoThreadId(payload) === DEMO_THREAD_ID ? demoUsageLedgerEvents : [],
  [IPC_CHANNELS.threadFollowUpList]: () => ({ followUps: [] }),
  [IPC_CHANNELS.threadTodoList]: () => [],
  [IPC_CHANNELS.threadGetPendingPlan]: () => undefined,
  [IPC_CHANNELS.threadGetApprovedPlan]: () => undefined,
  [IPC_CHANNELS.clarificationGetPending]: () => undefined,
  [IPC_CHANNELS.bashApprovalGetPending]: () => undefined,
  [IPC_CHANNELS.composerDraftGet]: () => undefined,
  [IPC_CHANNELS.gitGetStatus]: () => demoGitStatus,
  [IPC_CHANNELS.gitGetWorkspaceDiff]: () => ({ files: [] }),
  [IPC_CHANNELS.gitListCommitModelOptions]: () => ({ options: [] }),
  [IPC_CHANNELS.billingRoutePricing]: () => [],
  [IPC_CHANNELS.billingRouteCapabilities]: () => [],
  [IPC_CHANNELS.billingModelsDevList]: () => [],
  [IPC_CHANNELS.candidateModelList]: (payload) =>
    typeof payload === "string" && payload === demoProvider.id ? demoCandidateModels : [],
  [IPC_CHANNELS.agentTemplateList]: () => demoModelSettings.agentTemplates,
  [IPC_CHANNELS.skillsList]: () => ({
    userSkills: [],
    projectSkills: [],
    agentsOnlySkills: [],
    scannedAt: new Date().toISOString(),
  }),
  [IPC_CHANNELS.projectSkillsSettingsGet]: (payload) => ({
    workspacePath: typeof payload === "string" ? payload : DEMO_WORKSPACE_PATH,
    enabledByPath: {},
  }),
  [IPC_CHANNELS.projectMcpSettingsGet]: (payload) => ({
    workspacePath: typeof payload === "string" ? payload : DEMO_WORKSPACE_PATH,
    enabledByServer: {},
  }),
  [IPC_CHANNELS.projectIntegrationsSettingsGet]: (payload) => ({
    workspacePath: typeof payload === "string" ? payload : DEMO_WORKSPACE_PATH,
    enabled: {},
  }),
  [IPC_CHANNELS.projectOrchestrationSettingsGet]: (payload) => ({
    workspacePath: typeof payload === "string" ? payload : DEMO_WORKSPACE_PATH,
  }),
  [IPC_CHANNELS.storageGetUsage]: () => ({ totalBytes: 0, categories: [], unmetered: [] }),
  [IPC_CHANNELS.terminalList]: () => [],
  [IPC_CHANNELS.backgroundTerminalList]: () => [],
  [IPC_CHANNELS.browserGetState]: () => demoBrowserState,
  [IPC_CHANNELS.browserSetUiScope]: () => demoBrowserState,
  [IPC_CHANNELS.browserSetVisible]: () => demoBrowserState,
  [IPC_CHANNELS.asrSettingsGet]: () => ({ enabled: false, profiles: [], activeProfileId: undefined }),
  [IPC_CHANNELS.asrProfilesList]: () => ({
    profiles: [],
    activeProfileId: "",
    apiKeyEncryptionAvailable: false,
  }),
};

function defaultDemoHandler(channel: string, payload: unknown): unknown {
  if (channel.includes(":save") || channel.includes(":delete") || channel.includes(":resolve")) {
    return { ok: true };
  }
  if (channel.includes(":list") || channel.endsWith(":list")) {
    return [];
  }
  if (channel.includes(":get") || channel.startsWith("thread:")) {
    return undefined;
  }
  if (channel.includes(":start") || channel.includes(":continue") || channel.includes(":open")) {
    return { ok: true };
  }
  console.warn(`[eco-demo] fallback ipc ${channel}`, payload);
  return undefined;
}

let demoRendererReadyHook: ((webContents: WebContents) => void) | undefined;

export function registerDemoIpcHandlers(options: RegisterDemoIpcHandlersOptions = {}): void {
  demoRendererReadyHook = options.onRendererReady;
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (EVENT_CHANNELS.has(channel)) {
      continue;
    }
    ipcMain.handle(channel, async (event, payload) => {
      const handler = handlers[channel];
      if (handler) {
        return handler(payload, event);
      }
      return defaultDemoHandler(channel, payload);
    });
  }
}

export function queueDemoThreadOpen(threadId: string = DEMO_THREAD_ID): void {
  demoRuntimeState.pendingThreadOpenId = threadId;
}
