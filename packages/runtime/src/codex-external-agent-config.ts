import { type CodexAppServerClient, DEFAULT_CODEX_RPC_TIMEOUT_MS } from "./codex-app-server-client.js";

export const CODEX_EXTERNAL_AGENT_CONFIG_DETECT_METHOD = "externalAgentConfig/detect";
export const CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_METHOD = "externalAgentConfig/import";
export const CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD = "externalAgentConfig/import/completed";
export const DEFAULT_CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_WAIT_TIMEOUT_MS = DEFAULT_CODEX_RPC_TIMEOUT_MS;

export const CODEX_EXTERNAL_AGENT_CONFIG_MIGRATION_ITEM_TYPES = [
  "AGENTS_MD",
  "CONFIG",
  "SKILLS",
  "PLUGINS",
  "MCP_SERVER_CONFIG",
  "SUBAGENTS",
  "HOOKS",
  "COMMANDS",
  "SESSIONS",
] as const;

export type CodexExternalAgentConfigMigrationItemType =
  (typeof CODEX_EXTERNAL_AGENT_CONFIG_MIGRATION_ITEM_TYPES)[number];

export interface CodexExternalAgentConfigPluginsMigration {
  marketplaceName: string;
  pluginNames: string[];
}

export interface CodexExternalAgentConfigSessionMigration {
  path: string;
  cwd: string;
  title?: string | null;
}

export interface CodexExternalAgentConfigNamedMigration {
  name: string;
}

export interface CodexExternalAgentConfigMigrationDetails {
  plugins: CodexExternalAgentConfigPluginsMigration[];
  sessions: CodexExternalAgentConfigSessionMigration[];
  mcpServers: CodexExternalAgentConfigNamedMigration[];
  hooks: CodexExternalAgentConfigNamedMigration[];
  subagents: CodexExternalAgentConfigNamedMigration[];
  commands: CodexExternalAgentConfigNamedMigration[];
}

export interface CodexExternalAgentConfigMigrationItem {
  itemType: CodexExternalAgentConfigMigrationItemType;
  description: string;
  cwd?: string | null;
  details?: CodexExternalAgentConfigMigrationDetails | null;
}

export interface CodexExternalAgentConfigDetectOptions {
  includeHome?: boolean;
  cwds?: readonly string[] | null;
}

export interface CodexExternalAgentConfigDetectParams {
  includeHome: boolean;
  cwds: string[] | null;
}

export interface CodexExternalAgentConfigImportInput {
  migrationItems: readonly CodexExternalAgentConfigMigrationItem[];
  /** Explicit source product name, or null when intentionally unspecified. */
  source: string | null;
}

export interface CodexExternalAgentConfigImportParams {
  migrationItems: CodexExternalAgentConfigMigrationItem[];
  source: string | null;
}

export interface CodexExternalAgentConfigImportAcknowledgement {
  importId: string;
}

export interface CodexExternalAgentConfigImportSuccess {
  itemType: CodexExternalAgentConfigMigrationItemType;
  cwd?: string | null;
  source?: string | null;
  target?: string | null;
}

export interface CodexExternalAgentConfigImportFailure {
  itemType: CodexExternalAgentConfigMigrationItemType;
  errorType?: string | null;
  failureStage: string;
  message: string;
  cwd?: string | null;
  source?: string | null;
}

export interface CodexExternalAgentConfigImportTypeResult {
  itemType: CodexExternalAgentConfigMigrationItemType;
  successes: CodexExternalAgentConfigImportSuccess[];
  failures: CodexExternalAgentConfigImportFailure[];
}

export interface CodexExternalAgentConfigImportCompleted {
  importId: string;
  itemTypeResults: CodexExternalAgentConfigImportTypeResult[];
}

export interface CodexExternalAgentConfigImportWaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class CodexExternalAgentConfigImportFailed extends Error {
  readonly code = "CodexExternalAgentConfigImportFailed";
  readonly failures: CodexExternalAgentConfigImportFailure[];

  constructor(readonly completion: CodexExternalAgentConfigImportCompleted) {
    const failures = completion.itemTypeResults.flatMap((result) => result.failures);
    const detail = failures
      .map((failure) => `${failure.itemType}/${failure.failureStage}: ${failure.message}`)
      .join("; ");
    super(`Codex external-agent import ${completion.importId} failed: ${detail}`);
    this.name = "CodexExternalAgentConfigImportFailed";
    this.failures = failures;
  }
}

export function buildCodexExternalAgentConfigDetectParams(
  options: CodexExternalAgentConfigDetectOptions = {},
): CodexExternalAgentConfigDetectParams {
  if (options.includeHome !== undefined && typeof options.includeHome !== "boolean") {
    throw new Error("Codex externalAgentConfig/detect includeHome must be a boolean.");
  }
  return {
    includeHome: options.includeHome ?? false,
    cwds:
      options.cwds === null
        ? null
        : normalizeStringArray(options.cwds ?? [], "externalAgentConfig/detect cwds"),
  };
}

export async function detectCodexExternalAgentConfig(
  client: Pick<CodexAppServerClient, "request">,
  options: CodexExternalAgentConfigDetectOptions = {},
): Promise<CodexExternalAgentConfigMigrationItem[]> {
  const response = await client.request<unknown>(
    CODEX_EXTERNAL_AGENT_CONFIG_DETECT_METHOD,
    buildCodexExternalAgentConfigDetectParams(options),
  );
  return parseCodexExternalAgentConfigDetectResponse(response);
}

export function parseCodexExternalAgentConfigDetectResponse(
  value: unknown,
): CodexExternalAgentConfigMigrationItem[] {
  const response = requireRecord(value, "Codex externalAgentConfig/detect response");
  return requireArray(response.items, "Codex externalAgentConfig/detect response.items").map((item, index) =>
    parseMigrationItem(item, `Codex externalAgentConfig/detect response.items[${index}]`),
  );
}

export function buildCodexExternalAgentConfigImportParams(
  input: CodexExternalAgentConfigImportInput,
): CodexExternalAgentConfigImportParams {
  if (!isRecord(input)) {
    throw new Error("Codex externalAgentConfig/import input must be an object.");
  }
  if (!Object.hasOwn(input, "source")) {
    throw new Error("Codex externalAgentConfig/import source must be explicit (string or null).");
  }
  if (input.source !== null && (typeof input.source !== "string" || !input.source.trim())) {
    throw new Error("Codex externalAgentConfig/import source must be a non-empty string or null.");
  }
  if (!Array.isArray(input.migrationItems) || input.migrationItems.length === 0) {
    throw new Error(
      "Codex externalAgentConfig/import migrationItems must be a non-empty array; the app-server does not emit completed for an empty import.",
    );
  }
  return {
    migrationItems: input.migrationItems.map((item, index) =>
      parseMigrationItem(item, `Codex externalAgentConfig/import migrationItems[${index}]`),
    ),
    source: input.source,
  };
}

export async function importCodexExternalAgentConfig(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexExternalAgentConfigImportInput,
): Promise<CodexExternalAgentConfigImportAcknowledgement> {
  const response = await client.request<unknown>(
    CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_METHOD,
    buildCodexExternalAgentConfigImportParams(input),
  );
  return parseCodexExternalAgentConfigImportAcknowledgement(response);
}

export function parseCodexExternalAgentConfigImportAcknowledgement(
  value: unknown,
): CodexExternalAgentConfigImportAcknowledgement {
  const response = requireRecord(value, "Codex externalAgentConfig/import response");
  return {
    importId: readNonEmptyString(response, "importId", "Codex externalAgentConfig/import response"),
  };
}

export function parseCodexExternalAgentConfigImportCompleted(
  value: unknown,
): CodexExternalAgentConfigImportCompleted {
  const notification = requireRecord(value, "Codex externalAgentConfig/import/completed notification");
  const importId = readNonEmptyString(
    notification,
    "importId",
    "Codex externalAgentConfig/import/completed notification",
  );
  const itemTypeResults = requireArray(
    notification.itemTypeResults,
    "Codex externalAgentConfig/import/completed notification.itemTypeResults",
  ).map((result, index) => parseImportTypeResult(result, index));
  const seenTypes = new Set<CodexExternalAgentConfigMigrationItemType>();
  for (const result of itemTypeResults) {
    if (seenTypes.has(result.itemType)) {
      throw new Error(
        `Codex externalAgentConfig/import/completed notification contains duplicate ${result.itemType} results.`,
      );
    }
    seenTypes.add(result.itemType);
  }
  return { importId, itemTypeResults };
}

/**
 * Registers the completion listener before sending import, so a completion
 * notification delivered in the same stdout batch as the acknowledgement is not lost.
 */
export function importCodexExternalAgentConfigAndWait(
  client: Pick<CodexAppServerClient, "request" | "addNotificationHandler">,
  input: CodexExternalAgentConfigImportInput,
  options: CodexExternalAgentConfigImportWaitOptions = {},
): Promise<CodexExternalAgentConfigImportCompleted> {
  const params = buildCodexExternalAgentConfigImportParams(input);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`Invalid Codex external-agent import wait timeout: ${timeoutMs}.`));
  }
  if (options.signal?.aborted) {
    return Promise.reject(asError(options.signal.reason, "Codex external-agent import aborted"));
  }

  return new Promise<CodexExternalAgentConfigImportCompleted>((resolve, reject) => {
    let importId: string | undefined;
    let settled = false;
    const bufferedCompletions = new Map<string, CodexExternalAgentConfigImportCompleted>();
    let removeNotification: () => void = () => undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      removeNotification();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(asError(error, "Codex external-agent import failed"));
    };
    const complete = (completion: CodexExternalAgentConfigImportCompleted) => {
      if (settled) {
        return;
      }
      try {
        assertImportCompletionCoversSelection(completion, params.migrationItems);
      } catch (error) {
        fail(error);
        return;
      }
      const failures = completion.itemTypeResults.flatMap((result) => result.failures);
      if (failures.length > 0) {
        fail(new CodexExternalAgentConfigImportFailed(completion));
        return;
      }
      settled = true;
      cleanup();
      resolve(completion);
    };
    const onAbort = () => {
      fail(asError(options.signal?.reason, "Codex external-agent import aborted"));
    };
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Timed out waiting for Codex external-agent import${importId ? ` ${importId}` : " acknowledgement"} after ${timeoutMs}ms.`,
        ),
      );
    }, timeoutMs);

    removeNotification = client.addNotificationHandler((method, notificationParams) => {
      if (settled || method !== CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_COMPLETED_METHOD) {
        return;
      }
      let completion: CodexExternalAgentConfigImportCompleted;
      try {
        completion = parseCodexExternalAgentConfigImportCompleted(notificationParams);
      } catch (error) {
        fail(error);
        return;
      }
      if (completion.importId === importId) {
        complete(completion);
      } else {
        bufferedCompletions.set(completion.importId, completion);
      }
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });

    void client
      .request<unknown>(CODEX_EXTERNAL_AGENT_CONFIG_IMPORT_METHOD, params)
      .then(parseCodexExternalAgentConfigImportAcknowledgement)
      .then(
        (acknowledgement) => {
          if (settled) {
            return;
          }
          importId = acknowledgement.importId;
          const buffered = bufferedCompletions.get(importId);
          if (buffered) {
            complete(buffered);
          }
        },
        (error) => fail(error),
      );
  });
}

function assertImportCompletionCoversSelection(
  completion: CodexExternalAgentConfigImportCompleted,
  migrationItems: readonly CodexExternalAgentConfigMigrationItem[],
): void {
  const completedTypes = new Set(completion.itemTypeResults.map((result) => result.itemType));
  const missingTypes = [...new Set(migrationItems.map((item) => item.itemType))].filter(
    (itemType) => !completedTypes.has(itemType),
  );
  if (missingTypes.length > 0) {
    throw new Error(
      `Codex external-agent import ${completion.importId} completed without results for: ${missingTypes.join(", ")}.`,
    );
  }
}

function parseMigrationItem(value: unknown, location: string): CodexExternalAgentConfigMigrationItem {
  const item = requireRecord(value, location);
  const itemType = readMigrationItemType(item.itemType, `${location}.itemType`);
  const cwd = readOptionalNullableString(item, "cwd", location, { allowEmpty: true });
  const details =
    item.details === undefined
      ? undefined
      : item.details === null
        ? null
        : parseMigrationDetails(item.details, `${location}.details`);
  return {
    itemType,
    description: readString(item, "description", location),
    ...(cwd !== undefined && { cwd }),
    ...(details !== undefined && { details }),
  };
}

function parseMigrationDetails(value: unknown, location: string): CodexExternalAgentConfigMigrationDetails {
  const details = requireRecord(value, location);
  return {
    plugins: requireArrayOrDefault(details.plugins, `${location}.plugins`).map((plugin, index) => {
      const pluginLocation = `${location}.plugins[${index}]`;
      const record = requireRecord(plugin, pluginLocation);
      return {
        marketplaceName: readNonEmptyString(record, "marketplaceName", pluginLocation),
        pluginNames: normalizeStringArray(record.pluginNames, `${pluginLocation}.pluginNames`),
      };
    }),
    sessions: requireArrayOrDefault(details.sessions, `${location}.sessions`).map((session, index) => {
      const sessionLocation = `${location}.sessions[${index}]`;
      const record = requireRecord(session, sessionLocation);
      const title = readOptionalNullableString(record, "title", sessionLocation);
      return {
        path: readNonEmptyString(record, "path", sessionLocation),
        cwd: readNonEmptyString(record, "cwd", sessionLocation),
        ...(title !== undefined && { title }),
      };
    }),
    mcpServers: parseNamedMigrations(details.mcpServers, `${location}.mcpServers`),
    hooks: parseNamedMigrations(details.hooks, `${location}.hooks`),
    subagents: parseNamedMigrations(details.subagents, `${location}.subagents`),
    commands: parseNamedMigrations(details.commands, `${location}.commands`),
  };
}

function parseNamedMigrations(value: unknown, location: string): CodexExternalAgentConfigNamedMigration[] {
  return requireArrayOrDefault(value, location).map((entry, index) => {
    const entryLocation = `${location}[${index}]`;
    const record = requireRecord(entry, entryLocation);
    return { name: readNonEmptyString(record, "name", entryLocation) };
  });
}

function parseImportTypeResult(value: unknown, index: number): CodexExternalAgentConfigImportTypeResult {
  const location = `Codex externalAgentConfig/import/completed notification.itemTypeResults[${index}]`;
  const result = requireRecord(value, location);
  const itemType = readMigrationItemType(result.itemType, `${location}.itemType`);
  const successes = requireArray(result.successes, `${location}.successes`).map((success, successIndex) =>
    parseImportSuccess(success, `${location}.successes[${successIndex}]`, itemType),
  );
  const failures = requireArray(result.failures, `${location}.failures`).map((failure, failureIndex) =>
    parseImportFailure(failure, `${location}.failures[${failureIndex}]`, itemType),
  );
  return { itemType, successes, failures };
}

function parseImportSuccess(
  value: unknown,
  location: string,
  parentItemType: CodexExternalAgentConfigMigrationItemType,
): CodexExternalAgentConfigImportSuccess {
  const success = requireRecord(value, location);
  const itemType = readMigrationItemType(success.itemType, `${location}.itemType`);
  if (itemType !== parentItemType) {
    throw new Error(`${location}.itemType must match parent result ${parentItemType}.`);
  }
  const cwd = readOptionalNullableString(success, "cwd", location, { allowEmpty: true });
  const source = readOptionalNullableString(success, "source", location, { allowEmpty: true });
  const target = readOptionalNullableString(success, "target", location, { allowEmpty: true });
  return {
    itemType,
    ...(cwd !== undefined && { cwd }),
    ...(source !== undefined && { source }),
    ...(target !== undefined && { target }),
  };
}

function parseImportFailure(
  value: unknown,
  location: string,
  parentItemType: CodexExternalAgentConfigMigrationItemType,
): CodexExternalAgentConfigImportFailure {
  const failure = requireRecord(value, location);
  const itemType = readMigrationItemType(failure.itemType, `${location}.itemType`);
  if (itemType !== parentItemType) {
    throw new Error(`${location}.itemType must match parent result ${parentItemType}.`);
  }
  const errorType = readOptionalNullableString(failure, "errorType", location, {
    allowEmpty: true,
  });
  const cwd = readOptionalNullableString(failure, "cwd", location, { allowEmpty: true });
  const source = readOptionalNullableString(failure, "source", location, { allowEmpty: true });
  return {
    itemType,
    ...(errorType !== undefined && { errorType }),
    failureStage: readNonEmptyString(failure, "failureStage", location),
    message: readNonEmptyString(failure, "message", location),
    ...(cwd !== undefined && { cwd }),
    ...(source !== undefined && { source }),
  };
}

function readMigrationItemType(value: unknown, location: string): CodexExternalAgentConfigMigrationItemType {
  if (
    typeof value !== "string" ||
    !(CODEX_EXTERNAL_AGENT_CONFIG_MIGRATION_ITEM_TYPES as readonly string[]).includes(value)
  ) {
    throw new Error(
      `${location} must be one of ${CODEX_EXTERNAL_AGENT_CONFIG_MIGRATION_ITEM_TYPES.join(", ")}.`,
    );
  }
  return value as CodexExternalAgentConfigMigrationItemType;
}

function readOptionalNullableString(
  value: Record<string, unknown>,
  key: string,
  location: string,
  options: { allowEmpty?: boolean } = {},
): string | null | undefined {
  const field = value[key];
  if (field === undefined || field === null) {
    return field;
  }
  if (typeof field !== "string" || (!options.allowEmpty && !field.trim())) {
    throw new Error(
      `${location}.${key} must be ${options.allowEmpty ? "a string" : "a non-empty string"} or null.`,
    );
  }
  return field;
}

function readString(value: Record<string, unknown>, key: string, location: string): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`${location}.${key} must be a string.`);
  }
  return field;
}

function readNonEmptyString(value: Record<string, unknown>, key: string, location: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`${location}.${key} must be a non-empty string.`);
  }
  return field;
}

function normalizeStringArray(value: unknown, location: string): string[] {
  return requireArray(value, location).map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${location}[${index}] must be a non-empty string.`);
    }
    return entry;
  });
}

function requireArray(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array.`);
  }
  return value;
}

function requireArrayOrDefault(value: unknown, location: string): unknown[] {
  return value === undefined ? [] : requireArray(value, location);
}

function requireRecord(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${location} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(value === undefined ? fallback : String(value));
}
