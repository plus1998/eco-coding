import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  SkillCatalogEntry,
  SkillCatalogInstallRequest,
  SkillCatalogInstallResult,
  SkillCatalogSearchResult,
  SkillLayout,
} from "../shared/skills";

const CATALOG_BASE_URL = "https://skills.sh";
const MAX_DOWNLOAD_FILES = 200;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
const MAX_CATALOG_PAGE_BYTES = 5 * 1024 * 1024;
const LEADERBOARD_CACHE_TTL_MS = 60 * 60 * 1000;

let leaderboardCache: { expiresAt: number; entries: SkillCatalogEntry[] } | undefined;

type FetchLike = typeof fetch;

export async function searchSkillsCatalog(
  query: string,
  options: { fetch?: FetchLike; limit?: number } = {},
): Promise<SkillCatalogSearchResult> {
  const normalized = query.trim();
  if (normalized.length < 2) {
    throw new Error("搜索词至少需要 2 个字符。");
  }
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const url = new URL("/api/search", CATALOG_BASE_URL);
  url.searchParams.set("q", normalized);
  url.searchParams.set("limit", String(limit));
  const response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`skills.sh 搜索失败（HTTP ${response.status}）。`);
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.skills)) {
    throw new Error("skills.sh 返回了无法识别的搜索结果。");
  }
  const entries = payload.skills.flatMap(parseCatalogEntry);
  return {
    query: typeof payload.query === "string" ? payload.query : normalized,
    searchType:
      payload.searchType === "fuzzy" || payload.searchType === "semantic"
        ? payload.searchType
        : "unknown",
    entries,
    ...(typeof payload.duration_ms === "number" ? { durationMs: payload.duration_ms } : {}),
  };
}

export async function listSkillsLeaderboard(
  options: { fetch?: FetchLike; limit?: number; now?: number; cache?: boolean } = {},
): Promise<SkillCatalogSearchResult> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 12));
  const now = options.now ?? Date.now();
  const useCache = options.cache !== false;
  if (useCache && leaderboardCache && leaderboardCache.expiresAt > now) {
    return { query: "", searchType: "unknown", entries: leaderboardCache.entries.slice(0, limit) };
  }
  const response = await (options.fetch ?? fetch)(CATALOG_BASE_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`skills.sh 排行榜加载失败（HTTP ${response.status}）。`);
  }
  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_CATALOG_PAGE_BYTES) {
    throw new Error("skills.sh 排行榜响应超过 5 MB 限制。");
  }
  const leaderboard = parseLeaderboardFromPage(html);
  if (!leaderboard) {
    throw new Error("skills.sh 返回了无法识别的排行榜结构。");
  }
  const entries = leaderboard.initialSkills
    .flatMap(parseLeaderboardEntry)
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 50);
  if (entries.length === 0) {
    throw new Error("skills.sh 排行榜没有可展示的 Skill。");
  }
  if (useCache) {
    leaderboardCache = { expiresAt: now + LEADERBOARD_CACHE_TTL_MS, entries };
  }
  return { query: "", searchType: "unknown", entries: entries.slice(0, limit) };
}

export function clearSkillsLeaderboardCacheForTests(): void {
  leaderboardCache = undefined;
}

export async function installCatalogSkill(
  request: SkillCatalogInstallRequest,
  options: { fetch?: FetchLike; homedir?: string } = {},
): Promise<SkillCatalogInstallResult> {
  const [owner, repo] = parseSource(request.source);
  const skillId = normalizePathSegment(request.skillId, "Skill id");
  const root = skillRoot(options.homedir ?? os.homedir(), request.layout);
  const installName = filesystemSkillName(skillId);
  const destination = path.join(root, installName);
  if (await pathExists(destination)) {
    throw new Error(`${installName} 已安装到 ${root}。`);
  }

  const url = new URL(
    `/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(skillId)}`,
    CATALOG_BASE_URL,
  );
  const response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`下载 Skill 失败（HTTP ${response.status}）。`);
  }
  const payload = (await response.json()) as unknown;
  const files = parseDownloadFiles(payload);
  const temporary = path.join(root, `.${installName}.installing-${randomUUID()}`);

  await fs.mkdir(root, { recursive: true });
  let installed = false;
  try {
    for (const file of files) {
      const target = safeInstallPath(temporary, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.contents, "utf8");
    }
    if (!(await pathExists(path.join(temporary, "SKILL.md")))) {
      throw new Error("下载内容缺少 SKILL.md，未执行安装。");
    }
    await fs.rename(temporary, destination);
    installed = true;
    await recordCatalogInstall(options.homedir ?? os.homedir(), request.layout, installName, request);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    if (installed) {
      await fs.rm(destination, { recursive: true, force: true });
    }
    throw error;
  }
  return { ok: true, directory: destination, fileCount: files.length };
}

async function recordCatalogInstall(
  homedir: string,
  layout: SkillLayout,
  installName: string,
  request: SkillCatalogInstallRequest,
): Promise<void> {
  const layoutDirectory = layout === "agents" ? ".agents" : layout === "codex" ? ".codex" : ".claude";
  const lockPath = path.join(homedir, layoutDirectory, ".skill-lock.json");
  let lock: { version: number; skills: Record<string, unknown> } = { version: 3, skills: {} };
  try {
    const existing = JSON.parse(await fs.readFile(lockPath, "utf8")) as unknown;
    if (isRecord(existing) && isRecord(existing.skills)) {
      lock = {
        version: typeof existing.version === "number" ? existing.version : 3,
        skills: { ...existing.skills },
      };
    }
  } catch {
    // A missing lock file is expected for layouts that have not installed catalog Skills yet.
  }
  const now = new Date().toISOString();
  lock.skills[installName] = {
    source: request.source,
    skillId: request.skillId,
    installedAt: now,
    updatedAt: now,
  };
  const temporaryLock = `${lockPath}.tmp-${randomUUID()}`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(temporaryLock, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  await fs.rename(temporaryLock, lockPath);
}

function parseCatalogEntry(value: unknown): SkillCatalogEntry[] {
  if (!isRecord(value)) return [];
  const id = readString(value.id);
  const skillId = readString(value.skillId);
  const name = readString(value.name);
  const source = readString(value.source);
  if (!id || !skillId || !name || !source) return [];
  return [{
    id,
    skillId,
    name,
    source,
    installs: typeof value.installs === "number" && value.installs >= 0 ? value.installs : 0,
    url: `${CATALOG_BASE_URL}/${id}`,
  }];
}

function parseLeaderboardEntry(value: unknown): SkillCatalogEntry[] {
  if (!isRecord(value)) return [];
  const skillId = readString(value.skillId);
  const name = readString(value.name);
  const source = readString(value.source);
  if (!skillId || !name || !source) return [];
  const id = `${source}/${skillId}`;
  return [{
    id,
    skillId,
    name,
    source,
    installs: typeof value.installs === "number" && value.installs >= 0 ? value.installs : 0,
    url: `${CATALOG_BASE_URL}/${id}`,
  }];
}

function parseLeaderboardFromPage(html: string): { initialSkills: unknown[] } | undefined {
  const prefix = "self.__next_f.push(";
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const script = match[1]?.trim();
    if (!script?.startsWith(prefix) || !script.endsWith(")")) continue;
    try {
      const nextPayload = JSON.parse(script.slice(prefix.length, -1)) as unknown;
      if (!Array.isArray(nextPayload) || typeof nextPayload[1] !== "string") continue;
      const frame = nextPayload[1];
      const separator = frame.indexOf(":");
      if (separator < 0 || !frame.includes("initialSkills")) continue;
      const frameValue = JSON.parse(frame.slice(separator + 1).trim()) as unknown;
      const leaderboard = findLeaderboardPayload(frameValue);
      if (leaderboard) return leaderboard;
    } catch {
      continue;
    }
  }
  return undefined;
}

function findLeaderboardPayload(value: unknown): { initialSkills: unknown[] } | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findLeaderboardPayload(item);
      if (match) return match;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.initialSkills)) return { initialSkills: value.initialSkills };
  for (const item of Object.values(value)) {
    const match = findLeaderboardPayload(item);
    if (match) return match;
  }
  return undefined;
}

function parseDownloadFiles(payload: unknown): Array<{ path: string; contents: string }> {
  if (!isRecord(payload) || !Array.isArray(payload.files)) {
    throw new Error("skills.sh 返回了无法识别的下载内容。");
  }
  if (payload.files.length === 0 || payload.files.length > MAX_DOWNLOAD_FILES) {
    throw new Error("Skill 文件数量超出允许范围。");
  }
  let totalBytes = 0;
  return payload.files.map((file) => {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.contents !== "string") {
      throw new Error("Skill 下载内容包含无效文件。");
    }
    totalBytes += Buffer.byteLength(file.contents, "utf8");
    if (totalBytes > MAX_DOWNLOAD_BYTES) {
      throw new Error("Skill 下载内容超过 12 MB 限制。");
    }
    return { path: file.path, contents: file.contents };
  });
}

function safeInstallPath(root: string, relativePath: string): string {
  if (!relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error("Skill 包含不安全的文件路径。");
  }
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Skill 包含越界文件路径。");
  }
  return target;
}

function parseSource(source: string): [string, string] {
  const parts = source.trim().split("/");
  if (parts.length !== 2) throw new Error("Skill 来源必须是 owner/repo。");
  return [normalizePathSegment(parts[0] ?? "", "Owner"), normalizePathSegment(parts[1] ?? "", "Repository")];
}

function normalizePathSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized === ".." || /[/\\\0]/.test(normalized)) {
    throw new Error(`${label} 无效。`);
  }
  return normalized;
}

function filesystemSkillName(skillId: string): string {
  const normalized = skillId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Skill 名称无法映射到本地目录。");
  return normalized;
}

function skillRoot(homedir: string, layout: SkillLayout): string {
  if (layout === "claude") return path.join(homedir, ".claude", "skills");
  if (layout === "codex") return path.join(homedir, ".codex", "skills");
  return path.join(homedir, ".agents", "skills");
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch {
    return false;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
