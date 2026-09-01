import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function snapshotWorkspace(dir) {
  /** @type {Record<string, string>} */
  const files = {};
  const walk = (current, rel = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const abs = path.join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, nextRel);
      else if (entry.isFile() && entry.name.length < 200) {
        const stat = fs.statSync(abs);
        if (stat.size <= 64_000) {
          files[nextRel.replace(/\\/g, "/")] = fs.readFileSync(abs, "utf8");
        }
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files;
}

export function redactSecrets(value, secret) {
  if (!secret) return value;
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "string" && v.includes(secret)) {
        return v.split(secret).join("***REDACTED***");
      }
      return v;
    }),
  );
}
