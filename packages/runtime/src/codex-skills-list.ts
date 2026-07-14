import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_SKILLS_LIST_METHOD = "skills/list";

export type CodexSkillScope = "user" | "repo" | "system" | "admin";

export interface CodexSkillInterface {
  displayName?: string | null;
  shortDescription?: string | null;
  iconSmall?: string | null;
  iconLarge?: string | null;
  brandColor?: string | null;
  defaultPrompt?: string | null;
}

export interface CodexSkillToolDependency {
  type: string;
  value: string;
  description?: string | null;
  transport?: string | null;
  command?: string | null;
  url?: string | null;
}

export interface CodexSkillDependencies {
  tools: CodexSkillToolDependency[];
}

export interface CodexSkillMetadata {
  name: string;
  description: string;
  shortDescription?: string | null;
  interface?: CodexSkillInterface | null;
  dependencies?: CodexSkillDependencies | null;
  path: string;
  scope: CodexSkillScope;
  enabled: boolean;
}

export interface CodexSkillErrorInfo {
  path: string;
  message: string;
}

export interface CodexSkillsListEntry {
  cwd: string;
  skills: CodexSkillMetadata[];
  errors: CodexSkillErrorInfo[];
}

export interface CodexSkillsListOptions {
  cwds?: readonly string[];
  forceReload?: boolean;
}

export interface CodexSkillsListParams {
  cwds: string[];
  forceReload: boolean;
}

export function buildCodexSkillsListParams(options: CodexSkillsListOptions = {}): CodexSkillsListParams {
  const cwds = options.cwds ?? [];
  if (!Array.isArray(cwds)) {
    throw new Error("Codex skills/list cwds must be an array.");
  }
  if (options.forceReload !== undefined && typeof options.forceReload !== "boolean") {
    throw new Error("Codex skills/list forceReload must be a boolean.");
  }
  return {
    cwds: cwds.map((cwd, index) => readNonEmptyString(cwd, `cwds[${index}]`)),
    forceReload: options.forceReload ?? false,
  };
}

export async function listCodexSkills(
  client: Pick<CodexAppServerClient, "request">,
  options: CodexSkillsListOptions = {},
): Promise<CodexSkillsListEntry[]> {
  const response = await client.request<unknown>(
    CODEX_SKILLS_LIST_METHOD,
    buildCodexSkillsListParams(options),
  );
  return parseCodexSkillsListResponse(response);
}

export function parseCodexSkillsListResponse(value: unknown): CodexSkillsListEntry[] {
  const response = requireRecord(value, "Codex skills/list response");
  const data = requireArray(response.data, "Codex skills/list response.data");
  return data.map((entry, index) => parseSkillsListEntry(entry, index));
}

function parseSkillsListEntry(value: unknown, index: number): CodexSkillsListEntry {
  const location = `Codex skills/list response.data[${index}]`;
  const entry = requireRecord(value, location);
  return {
    cwd: readNonEmptyString(entry, "cwd", location),
    skills: requireArray(entry.skills, `${location}.skills`).map((skill, skillIndex) =>
      parseSkillMetadata(skill, `${location}.skills[${skillIndex}]`),
    ),
    errors: requireArray(entry.errors, `${location}.errors`).map((error, errorIndex) =>
      parseSkillError(error, `${location}.errors[${errorIndex}]`),
    ),
  };
}

function parseSkillMetadata(value: unknown, location: string): CodexSkillMetadata {
  const skill = requireRecord(value, location);
  const scope = skill.scope;
  if (!isCodexSkillScope(scope)) {
    throw new Error(`${location}.scope must be user, repo, system, or admin.`);
  }
  if (typeof skill.enabled !== "boolean") {
    throw new Error(`${location}.enabled must be a boolean.`);
  }

  const shortDescription = readOptionalNullableString(skill, "shortDescription", location);
  const skillInterface =
    skill.interface === undefined
      ? undefined
      : skill.interface === null
        ? null
        : parseSkillInterface(skill.interface, `${location}.interface`);
  const dependencies =
    skill.dependencies === undefined
      ? undefined
      : skill.dependencies === null
        ? null
        : parseSkillDependencies(skill.dependencies, `${location}.dependencies`);

  return {
    name: readNonEmptyString(skill, "name", location),
    description: readString(skill, "description", location),
    ...(shortDescription !== undefined && { shortDescription }),
    ...(skillInterface !== undefined && { interface: skillInterface }),
    ...(dependencies !== undefined && { dependencies }),
    path: readNonEmptyString(skill, "path", location),
    scope,
    enabled: skill.enabled,
  };
}

function parseSkillInterface(value: unknown, location: string): CodexSkillInterface {
  const input = requireRecord(value, location);
  const output: CodexSkillInterface = {};
  for (const key of [
    "displayName",
    "shortDescription",
    "iconSmall",
    "iconLarge",
    "brandColor",
    "defaultPrompt",
  ] as const) {
    const field = readOptionalNullableString(input, key, location);
    if (field !== undefined) {
      output[key] = field;
    }
  }
  return output;
}

function parseSkillDependencies(value: unknown, location: string): CodexSkillDependencies {
  const dependencies = requireRecord(value, location);
  return {
    tools: requireArray(dependencies.tools, `${location}.tools`).map((tool, index) =>
      parseSkillToolDependency(tool, `${location}.tools[${index}]`),
    ),
  };
}

function parseSkillToolDependency(value: unknown, location: string): CodexSkillToolDependency {
  const tool = requireRecord(value, location);
  const output: CodexSkillToolDependency = {
    type: readNonEmptyString(tool, "type", location),
    value: readNonEmptyString(tool, "value", location),
  };
  for (const key of ["description", "transport", "command", "url"] as const) {
    const field = readOptionalNullableString(tool, key, location);
    if (field !== undefined) {
      output[key] = field;
    }
  }
  return output;
}

function parseSkillError(value: unknown, location: string): CodexSkillErrorInfo {
  const error = requireRecord(value, location);
  return {
    path: readNonEmptyString(error, "path", location),
    message: readString(error, "message", location),
  };
}

function isCodexSkillScope(value: unknown): value is CodexSkillScope {
  return value === "user" || value === "repo" || value === "system" || value === "admin";
}

function readOptionalNullableString(
  value: Record<string, unknown>,
  key: string,
  location: string,
): string | null | undefined {
  const field = value[key];
  if (field === undefined || field === null) {
    return field;
  }
  if (typeof field !== "string") {
    throw new Error(`${location}.${key} must be a string or null when present.`);
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

function readNonEmptyString(value: Record<string, unknown>, key: string, location: string): string;
function readNonEmptyString(value: unknown, location: string): string;
function readNonEmptyString(
  value: Record<string, unknown> | unknown,
  keyOrLocation: string,
  maybeLocation?: string,
): string {
  const field = maybeLocation === undefined ? value : (value as Record<string, unknown>)[keyOrLocation];
  const location = maybeLocation === undefined ? keyOrLocation : `${maybeLocation}.${keyOrLocation}`;
  if (typeof field !== "string" || !field.trim()) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  return field;
}

function requireArray(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${location} must be an array.`);
  }
  return value;
}

function requireRecord(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object.`);
  }
  return value as Record<string, unknown>;
}
