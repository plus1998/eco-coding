/**
 * Password-wrapped vault_key stored in `user_vault_wraps` (account unlock path).
 */

import {
  ECO_VAULT_PASSWORD_WRAP_ALGORITHM,
  isPasswordWrappedVaultKey,
  type PasswordWrappedVaultKey,
  unwrapVaultKeyWithPassword,
  wrapVaultKeyWithPassword,
} from "@eco/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export const VAULT_PASSWORD_WRAP_REQUIRED_CODE = "vault_password_wrap_required";
export const VAULT_PASSWORD_UNLOCK_FAILED_CODE = "vault_password_unlock_failed";
export const VAULT_PASSWORD_WRAP_MISSING_CODE = "vault_password_wrap_missing";

export class VaultPasswordError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "VaultPasswordError";
    this.code = code;
  }
}

export interface UserVaultWrapRow {
  user_id: string;
  algorithm: string;
  salt: string;
  iterations: number;
  nonce: string;
  ciphertext: string;
  updated_at: string;
}

export function rowToPasswordWrappedVaultKey(row: UserVaultWrapRow): PasswordWrappedVaultKey {
  const wrapped: PasswordWrappedVaultKey = {
    algorithm: ECO_VAULT_PASSWORD_WRAP_ALGORITHM,
    salt: row.salt,
    iterations: row.iterations,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
  };
  if (!isPasswordWrappedVaultKey(wrapped)) {
    throw new VaultPasswordError("Cloud vault wrap row is invalid.", "vault_wrap_invalid");
  }
  return wrapped;
}

export async function fetchUserVaultWrap(
  client: SupabaseClient,
  userId: string,
): Promise<UserVaultWrapRow | null> {
  const { data, error } = await client
    .from("user_vault_wraps")
    .select("user_id, algorithm, salt, iterations, nonce, ciphertext, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data as UserVaultWrapRow | null;
}

export async function upsertUserVaultWrap(
  client: SupabaseClient,
  userId: string,
  wrapped: PasswordWrappedVaultKey,
): Promise<UserVaultWrapRow> {
  if (!isPasswordWrappedVaultKey(wrapped)) {
    throw new VaultPasswordError("Invalid password wrap payload.", "vault_wrap_invalid");
  }
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("user_vault_wraps")
    .upsert(
      {
        user_id: userId,
        algorithm: wrapped.algorithm,
        salt: wrapped.salt,
        iterations: wrapped.iterations,
        nonce: wrapped.nonce,
        ciphertext: wrapped.ciphertext,
        updated_at: now,
      },
      { onConflict: "user_id" },
    )
    .select("user_id, algorithm, salt, iterations, nonce, ciphertext, updated_at")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to upsert user_vault_wraps.");
  }
  return data as UserVaultWrapRow;
}

export async function unlockVaultKeyWithPassword(input: {
  client: SupabaseClient;
  userId: string;
  password: string;
}): Promise<string> {
  const row = await fetchUserVaultWrap(input.client, input.userId);
  if (!row) {
    throw new VaultPasswordError(
      "No password-wrapped vault key on this account yet. Sync secrets on a device that already has them, then wrap with your login password.",
      VAULT_PASSWORD_WRAP_MISSING_CODE,
    );
  }
  try {
    return await unwrapVaultKeyWithPassword(rowToPasswordWrappedVaultKey(row), input.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new VaultPasswordError(message, VAULT_PASSWORD_UNLOCK_FAILED_CODE);
  }
}

export async function wrapAndUploadVaultKeyWithPassword(input: {
  client: SupabaseClient;
  userId: string;
  vaultKey: string;
  password: string;
}): Promise<UserVaultWrapRow> {
  if (!input.password.trim()) {
    throw new VaultPasswordError(
      "Password is required to wrap the vault key.",
      VAULT_PASSWORD_WRAP_REQUIRED_CODE,
    );
  }
  const wrapped = await wrapVaultKeyWithPassword(input.vaultKey, input.password);
  return upsertUserVaultWrap(input.client, input.userId, wrapped);
}
