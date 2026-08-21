import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export type AdminClient = SupabaseClient;

export function createServiceClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new HttpError(
      500,
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      "misconfigured",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireUser(req: Request): Promise<User> {
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
  return data.user;
}
