import type { OpenAIAccountProfile } from "../shared/openai-account";

export interface ParsedOpenAIAccountImportRow extends OpenAIAccountProfile {
  lineNumber: number;
  email?: string;
}

export interface OpenAIAccountImportError {
  lineNumber: number;
  message: string;
}

export interface ParsedOpenAIAccountImport {
  rows: ParsedOpenAIAccountImportRow[];
  errors: OpenAIAccountImportError[];
}

function unwrapMarkdownLink(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\[(.*)\]\((\S+)\)$/u);
  return match?.[1] ?? value;
}

function splitFields(line: string): string[] {
  const firstSeparator = line.indexOf("----");
  const secondSeparator = firstSeparator < 0 ? -1 : line.indexOf("----", firstSeparator + 4);
  if (secondSeparator < 0) return line.split("----");

  // Exports can wrap URL----2FA together, or just the URL. Expand that link
  // before splitting its display text; brackets in the password are literal.
  const prefix = line.slice(0, secondSeparator + 4);
  const tail = line.slice(secondSeparator + 4);
  const link = tail.match(/^\s*\[(.*)\]\((\S+?)\)(?=----|$)(.*)$/u);
  return `${prefix}${link ? `${link[1]}${link[3]}` : tail}`.split("----");
}

function parseHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Parse and validate every non-empty input line without writing anything. */
export function parseOpenAIAccountImport(text: string): ParsedOpenAIAccountImport {
  const rows: ParsedOpenAIAccountImportRow[] = [];
  const errors: OpenAIAccountImportError[] = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

  text.split(/\r?\n/u).forEach((sourceLine, index) => {
    if (!sourceLine.trim()) return;
    const lineNumber = index + 1;
    // Some exports wrap the whole record in a Markdown link. Only its display text
    // is data; the wrapper target is deliberately never fetched or retained.
    const line = unwrapMarkdownLink(sourceLine);
    const rawFields = splitFields(line);
    if (rawFields.length > 4) {
      errors.push({ lineNumber, message: "包含多余的 ---- 分隔符" });
      return;
    }
    const fields = rawFields.map((field, index) => index === 1 ? field : unwrapMarkdownLink(field));
    while (fields.length < 4) fields.push("");
    const [rawEmail = "", password = "", pickupUrl = "", twoFactorSecret = ""] = fields;
    const email = rawEmail.trim();
    const normalizedPickupUrl = pickupUrl.trim();
    if (fields.every((field) => field.trim() === "")) {
      errors.push({ lineNumber, message: "记录字段不能为空" });
      return;
    }
    if (email && !emailPattern.test(email)) {
      errors.push({ lineNumber, message: "邮箱格式无效" });
      return;
    }
    if (normalizedPickupUrl && !parseHttpUrl(normalizedPickupUrl)) {
      errors.push({ lineNumber, message: "取件地址必须是 HTTP(S) URL" });
      return;
    }
    rows.push({
      lineNumber,
      ...(email ? { email } : {}),
      ...(password !== "" ? { password } : {}),
      ...(normalizedPickupUrl ? { pickupUrl: normalizedPickupUrl } : {}),
      ...(twoFactorSecret !== "" ? { twoFactorSecret } : {}),
    });
  });

  return { rows, errors };
}
