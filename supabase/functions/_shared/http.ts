import { corsHeaders } from "./cors.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  console.error(error);
  return json({ error: "Internal server error.", code: "internal" }, 500);
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.", "invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.", "invalid_json");
  }
  return body as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${key} is required.`, "invalid_request");
  }
  return value.trim();
}

export function optionalObject(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${key} must be an object.`, "invalid_request");
  }
  return value as Record<string, unknown>;
}

export function requireMethod(req: Request, method: string): void {
  if (req.method !== method) {
    throw new HttpError(405, `Method ${req.method} not allowed.`, "method_not_allowed");
  }
}
