export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function jsonMarshal(value: unknown): string {
  return JSON.stringify(value);
}

export function jsonParse<T = JsonValue>(text: string): T {
  return JSON.parse(text) as T;
}

export function cloneJson<T>(value: T): T {
  return jsonParse(jsonMarshal(value)) as T;
}

export function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalizeJsonValue(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function bytesTrimSpace(bytes: Uint8Array | string): string {
  if (typeof bytes === "string") {
    return bytes.trim();
  }
  return new TextDecoder().decode(bytes).trim();
}
