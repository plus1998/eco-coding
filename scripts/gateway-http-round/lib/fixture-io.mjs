import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function appendJsonl(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

export function redactSecrets(value, secrets = []) {
  const active = secrets.filter((s) => typeof s === "string" && s.length > 8);
  if (active.length === 0) return value;
  let text = JSON.stringify(value);
  for (const secret of active) {
    text = text.split(secret).join("***REDACTED***");
  }
  return JSON.parse(text);
}

export function snapshotHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

export function bodyKind(contentType) {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/event-stream")) return "sse";
  if (ct.includes("application/json")) return "json";
  return "text";
}

export function writeBodyArtifact(dir, name, body, contentType) {
  const kind = bodyKind(contentType);
  const ext = kind === "sse" ? "sse" : kind === "json" ? "json" : "txt";
  const file = path.join(dir, `${name}.${ext}`);
  fs.writeFileSync(file, body);
  return { file: path.basename(file), kind, bytes: Buffer.byteLength(body, "utf8") };
}
