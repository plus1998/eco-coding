import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  SUPABASE_BACKEND_VERSION_PATTERN,
  SUPPORTED_SUPABASE_API_VERSION,
  type SupabaseDeploymentVersion,
} from "../shared/supabase-deployment";

const deploymentManifestSchema = z.strictObject({
  backendVersion: z.string().regex(SUPABASE_BACKEND_VERSION_PATTERN),
  apiVersion: z.number().int().positive(),
});

export interface SupabaseDeploymentBundle {
  version: SupabaseDeploymentVersion;
  desktopVersion: string;
  migrations: Array<{ version: string; name: string; sql: string }>;
  functions: Array<{ name: string; verifyJwt: boolean; entrypoint: string }>;
  files: Array<{ name: string; content: string }>;
}

/** The packaged app includes the same source/config/migrations as the repository CLI. */
export async function readSupabaseDeploymentBundle(
  directory: string,
  desktopVersion: string,
): Promise<SupabaseDeploymentBundle> {
  const manifest = deploymentManifestSchema.parse(
    JSON.parse(await readFile(path.join(directory, "deployment.json"), "utf8")),
  );
  if (manifest.apiVersion !== SUPPORTED_SUPABASE_API_VERSION) {
    throw new Error(`部署包的接口版本 ${manifest.apiVersion} 与当前客户端不兼容。`);
  }
  const config = await readFile(path.join(directory, "config.toml"), "utf8");
  const readSource = async (filename: string) => (await readFile(filename, "utf8")).replaceAll("\r\n", "\n");
  const migrations: SupabaseDeploymentBundle["migrations"] = [];
  for (const filename of (await readdir(path.join(directory, "migrations"))).sort()) {
    if (filename === ".DS_Store") continue;
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(filename);
    if (!match) throw new Error(`无法识别迁移文件：${filename}`);
    if (migrations.some((migration) => migration.version === match[1])) {
      throw new Error(`迁移版本重复：${match[1]}`);
    }
    migrations.push({
      version: match[1]!,
      name: match[2]!,
      sql: await readSource(path.join(directory, "migrations", filename)),
    });
  }
  const files: SupabaseDeploymentBundle["files"] = [];
  async function walk(relative: string): Promise<void> {
    const entries = await readdir(path.join(directory, "functions", relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name === ".DS_Store") continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile() && /\.(ts|json)$/.test(entry.name)) {
        files.push({ name, content: await readSource(path.join(directory, "functions", name)) });
      } else throw new Error(`不支持的函数资源：${name}`);
    }
  }
  await walk("");
  const functions: SupabaseDeploymentBundle["functions"] = [];
  for (const entry of await readdir(path.join(directory, "functions"), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const section = config.split(`[functions.${entry.name}]`)[1]?.split(/\n\[/)[0];
    const verifyJwt = section?.match(/^verify_jwt\s*=\s*(true|false)\s*$/m)?.[1];
    const entrypoint = `${entry.name}/index.ts`;
    if (!verifyJwt || !files.some((file) => file.name === entrypoint)) {
      throw new Error(`函数 ${entry.name} 缺少入口或 verify_jwt 配置。`);
    }
    functions.push({ name: entry.name, verifyJwt: verifyJwt === "true", entrypoint });
  }
  functions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!migrations.length || !functions.length) throw new Error("Supabase 部署资源不完整。");
  const hash = createHash("sha256")
    .update(JSON.stringify({ manifest, migrations, functions, files }))
    .digest("hex");
  return {
    version: {
      release: manifest.backendVersion,
      apiVersion: manifest.apiVersion,
      schema: migrations.at(-1)!.version,
      hash,
    },
    desktopVersion,
    migrations,
    functions,
    files,
  };
}
