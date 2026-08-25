/**
 * Vault crypto helpers for Eco Supabase Center.
 *
 * - `vault_key` is a local AES key material used to encrypt API keys before upload.
 * - Primary unlock path: wrap `vault_key` with a key derived from the account login
 *   password (PBKDF2-SHA256 + AES-256-GCM) and store the blob in `user_vault_wraps`.
 * - Legacy claim path: 6-digit code is for short-TTL human verification ONLY — never
 *   AES key material. ECDH P-256 wraps `vault_key` between devices.
 */

const VAULT_KEY_BYTES = 32;
const CLAIM_CODE_DIGITS = 6;
const CLAIM_CODE_MAX = 1_000_000;
const CODE_HASH_PREFIX = "eco-vault-claim-code:v1:";
const WRAP_INFO = new TextEncoder().encode("eco-vault-key-wrap:v1");
const PASSWORD_WRAP_SALT_BYTES = 16;
/** PBKDF2 iterations for password → AES key (WebCrypto-friendly). */
export const ECO_VAULT_PASSWORD_WRAP_ITERATIONS = 310_000;

export const ECO_VAULT_WRAP_ALGORITHM = "ECDH-P256-AES-256-GCM" as const;
export const ECO_VAULT_PASSWORD_WRAP_ALGORITHM = "PBKDF2-SHA256-AES-256-GCM" as const;

export type VaultKeyBytes = Uint8Array;

export interface VaultClaimKeyPair {
  /** SPKI public key, base64url — store as vault_claims.requester_public_key */
  publicKey: string;
  /** PKCS8 private key, base64url — keep only on requester device */
  privateKey: string;
}

/**
 * Payload written to vault_claims.wrapped_vault_key (+ wrap_nonce mirrored for convenience).
 * Ciphertext never includes API keys in plaintext; only encrypted vault_key bytes.
 */
export interface WrappedVaultKey {
  algorithm: typeof ECO_VAULT_WRAP_ALGORITHM;
  /** Approver ephemeral SPKI public key (base64url) for requester ECDH */
  ephemeralPublicKey: string;
  /** AES-GCM ciphertext of vault_key (base64url) */
  ciphertext: string;
  /** AES-GCM IV / nonce (base64url) — also stored as vault_claims.wrap_nonce */
  nonce: string;
}

export async function generateVaultKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(VAULT_KEY_BYTES));
  return bytesToBase64Url(bytes);
}

export function vaultKeyToBytes(vaultKey: string): VaultKeyBytes {
  const bytes = base64UrlToBytes(vaultKey);
  if (bytes.byteLength !== VAULT_KEY_BYTES) {
    throw new Error(`Invalid vault_key length: expected ${VAULT_KEY_BYTES} bytes`);
  }
  return bytes;
}

/**
 * Generate a 6-digit claim code (000000–999999).
 * For claim binding only — never derive encryption keys from this value.
 */
export function generateVaultClaimCode(): string {
  const buffer = new Uint32Array(1);
  let value: number;
  // Reject values that would bias modulo CLAIM_CODE_MAX.
  const limit = Math.floor(0x1_0000_0000 / CLAIM_CODE_MAX) * CLAIM_CODE_MAX;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return String(value % CLAIM_CODE_MAX).padStart(CLAIM_CODE_DIGITS, "0");
}

/**
 * Normalize user-entered claim codes: trim, strip spaces/dashes, require exactly 6 digits.
 */
export function normalizeVaultClaimCode(input: string): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const digits = input.trim().replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(digits)) {
    return null;
  }
  return digits;
}

/**
 * SHA-256 hex digest for DB comparison (`vault_claims.code_hash`).
 * Hashes the normalized 6-digit code only — not suitable as an AES key.
 */
export async function hashVaultClaimCode(code: string): Promise<string> {
  const normalized = normalizeVaultClaimCode(code);
  if (!normalized) {
    throw new Error("Invalid vault claim code");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${CODE_HASH_PREFIX}${normalized}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyVaultClaimCode(code: string, codeHash: string): Promise<boolean> {
  const normalized = normalizeVaultClaimCode(code);
  if (!normalized || typeof codeHash !== "string" || codeHash.length === 0) {
    return false;
  }
  const actual = await hashVaultClaimCode(normalized);
  return timingSafeEqualHex(actual, codeHash);
}

/** Ephemeral P-256 key pair for the vault claim requester. */
export async function generateVaultClaimKeyPair(): Promise<VaultClaimKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    publicKey: bytesToBase64Url(new Uint8Array(publicKey)),
    privateKey: bytesToBase64Url(new Uint8Array(privateKey)),
  };
}

/**
 * Approver: wrap local vault_key to the requester's public key via ephemeral ECDH.
 * The 6-digit code is not used here — verify it separately before calling.
 */
export async function wrapVaultKeyForClaim(
  vaultKey: string,
  requesterPublicKey: string,
): Promise<WrappedVaultKey> {
  const vaultKeyBytes = vaultKeyToBytes(vaultKey);
  const requesterKey = await importSpkiPublicKey(requesterPublicKey);

  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const aesKey = await deriveWrapAesKey(ephemeral.privateKey, requesterKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, vaultKeyBytes);
  const ephemeralPublicKey = await crypto.subtle.exportKey("spki", ephemeral.publicKey);

  return {
    algorithm: ECO_VAULT_WRAP_ALGORITHM,
    ephemeralPublicKey: bytesToBase64Url(new Uint8Array(ephemeralPublicKey)),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
  };
}

/**
 * Requester: unwrap vault_key using the private key matching requester_public_key.
 */
export async function unwrapVaultKeyFromClaim(
  wrapped: WrappedVaultKey,
  requesterPrivateKey: string,
): Promise<string> {
  if (wrapped.algorithm !== ECO_VAULT_WRAP_ALGORITHM) {
    throw new Error(`Unsupported vault wrap algorithm: ${String(wrapped.algorithm)}`);
  }
  const privateKey = await importPkcs8PrivateKey(requesterPrivateKey);
  const ephemeralPublicKey = await importSpkiPublicKey(wrapped.ephemeralPublicKey);
  const aesKey = await deriveWrapAesKey(privateKey, ephemeralPublicKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(wrapped.nonce) },
    aesKey,
    base64UrlToBytes(wrapped.ciphertext),
  );
  const bytes = new Uint8Array(plaintext);
  if (bytes.byteLength !== VAULT_KEY_BYTES) {
    throw new Error(`Unwrapped vault_key has invalid length: ${bytes.byteLength}`);
  }
  return bytesToBase64Url(bytes);
}

export function isWrappedVaultKey(value: unknown): value is WrappedVaultKey {
  if (!value || typeof value !== "object") {
    return false;
  }
  const wrapped = value as WrappedVaultKey;
  return (
    wrapped.algorithm === ECO_VAULT_WRAP_ALGORITHM &&
    typeof wrapped.ephemeralPublicKey === "string" &&
    wrapped.ephemeralPublicKey.length > 0 &&
    typeof wrapped.ciphertext === "string" &&
    wrapped.ciphertext.length > 0 &&
    typeof wrapped.nonce === "string" &&
    wrapped.nonce.length > 0
  );
}

/**
 * Payload for `user_vault_wraps` — vault_key encrypted under a password-derived AES key.
 * Never store the password or plaintext vault_key in the cloud.
 */
export interface PasswordWrappedVaultKey {
  algorithm: typeof ECO_VAULT_PASSWORD_WRAP_ALGORITHM;
  /** Random salt (base64url) for PBKDF2 */
  salt: string;
  iterations: number;
  /** AES-GCM ciphertext of vault_key (base64url) */
  ciphertext: string;
  /** AES-GCM IV / nonce (base64url) */
  nonce: string;
}

/** Wrap local vault_key with a key derived from the account login password. */
export async function wrapVaultKeyWithPassword(
  vaultKey: string,
  password: string,
  options?: { iterations?: number },
): Promise<PasswordWrappedVaultKey> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password is required to wrap vault_key");
  }
  const iterations = options?.iterations ?? ECO_VAULT_PASSWORD_WRAP_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 100_000) {
    throw new Error("PBKDF2 iterations must be an integer >= 100000");
  }
  const vaultKeyBytes = vaultKeyToBytes(vaultKey);
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_WRAP_SALT_BYTES));
  const aesKey = await derivePasswordAesKey(password, salt, iterations);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    vaultKeyBytes,
  );
  return {
    algorithm: ECO_VAULT_PASSWORD_WRAP_ALGORITHM,
    salt: bytesToBase64Url(salt),
    iterations,
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
  };
}

/** Unwrap vault_key using the same account login password used at wrap time. */
export async function unwrapVaultKeyWithPassword(
  wrapped: PasswordWrappedVaultKey,
  password: string,
): Promise<string> {
  if (wrapped.algorithm !== ECO_VAULT_PASSWORD_WRAP_ALGORITHM) {
    throw new Error(`Unsupported password vault wrap algorithm: ${String(wrapped.algorithm)}`);
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password is required to unwrap vault_key");
  }
  if (!Number.isInteger(wrapped.iterations) || wrapped.iterations < 100_000) {
    throw new Error("Invalid PBKDF2 iterations on password wrap");
  }
  const aesKey = await derivePasswordAesKey(
    password,
    base64UrlToBytes(wrapped.salt),
    wrapped.iterations,
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(wrapped.nonce) },
      aesKey,
      base64UrlToBytes(wrapped.ciphertext),
    );
  } catch {
    throw new Error("Incorrect password or corrupt vault wrap");
  }
  const bytes = new Uint8Array(plaintext);
  if (bytes.byteLength !== VAULT_KEY_BYTES) {
    throw new Error(`Unwrapped vault_key has invalid length: ${bytes.byteLength}`);
  }
  return bytesToBase64Url(bytes);
}

export function isPasswordWrappedVaultKey(value: unknown): value is PasswordWrappedVaultKey {
  if (!value || typeof value !== "object") {
    return false;
  }
  const wrapped = value as PasswordWrappedVaultKey;
  return (
    wrapped.algorithm === ECO_VAULT_PASSWORD_WRAP_ALGORITHM &&
    typeof wrapped.salt === "string" &&
    wrapped.salt.length > 0 &&
    typeof wrapped.iterations === "number" &&
    Number.isInteger(wrapped.iterations) &&
    wrapped.iterations >= 100_000 &&
    typeof wrapped.ciphertext === "string" &&
    wrapped.ciphertext.length > 0 &&
    typeof wrapped.nonce === "string" &&
    wrapped.nonce.length > 0
  );
}

async function derivePasswordAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** AES-256-GCM ciphertext of a UTF-8 secret (API key), keyed by vault_key. */
export interface VaultSecretCipher {
  ciphertext: string;
  nonce: string;
}

/**
 * Encrypt a UTF-8 secret (API key) with the local vault_key for `user_secrets`.
 * Never upload plaintext API keys — only ciphertext + nonce.
 */
export async function encryptSecretWithVaultKey(
  vaultKey: string,
  plaintext: string,
): Promise<VaultSecretCipher> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("plaintext secret is required");
  }
  const aesKey = await importVaultAesKey(vaultKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
  };
}

/** Decrypt a `user_secrets` ciphertext with the local vault_key. */
export async function decryptSecretWithVaultKey(
  vaultKey: string,
  ciphertext: string,
  nonce: string,
): Promise<string> {
  if (typeof ciphertext !== "string" || !ciphertext || typeof nonce !== "string" || !nonce) {
    throw new Error("ciphertext and nonce are required");
  }
  const aesKey = await importVaultAesKey(vaultKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(nonce) },
    aesKey,
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function importVaultAesKey(vaultKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    vaultKeyToBytes(vaultKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveWrapAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: WRAP_INFO,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importSpkiPublicKey(spkiBase64Url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64UrlToBytes(spkiBase64Url),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

async function importPkcs8PrivateKey(pkcs8Base64Url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64UrlToBytes(pkcs8Base64Url),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
