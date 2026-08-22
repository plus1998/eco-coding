import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export type AdminClient = SupabaseClient;

export function createServiceClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.", "misconfigured");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export interface VerifiedAuthSession {
  user: User;
  jwt: string;
  sessionId: string | null;
}

export async function requireAuthSession(req: Request): Promise<VerifiedAuthSession> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authorization Bearer token is required.", "unauthorized");
  }
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) {
    throw new HttpError(401, "Authorization Bearer token is required.", "unauthorized");
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new HttpError(500, "Missing SUPABASE_URL or SUPABASE_ANON_KEY.", "misconfigured");
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await userClient.auth.getUser(jwt);
  if (error || !data.user) {
    throw new HttpError(401, "Invalid or expired user session.", "unauthorized");
  }
  return {
    user: data.user,
    jwt,
    sessionId: readJwtStringClaim(jwt, "session_id"),
  };
}

export async function requireUser(req: Request): Promise<User> {
  return (await requireAuthSession(req)).user;
}

function readJwtStringClaim(jwt: string, claim: string): string | null {
  const encodedPayload = jwt.split(".")[1];
  if (!encodedPayload) {
    return null;
  }
  try {
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const value = (payload as Record<string, unknown>)[claim];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
