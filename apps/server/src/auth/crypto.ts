import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { AccessTokenClaims } from "../types";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const DEFAULT_PASSWORD_ITERATIONS = 210_000;

export interface PasswordHashResult {
  salt: string;
  hash: string;
  iterations: number;
}

export function createRandomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function createPairingCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(
  password: string,
  options: { salt?: string; iterations?: number } = {},
): Promise<PasswordHashResult> {
  const salt = options.salt ?? createRandomToken(16);
  const iterations = options.iterations ?? DEFAULT_PASSWORD_ITERATIONS;
  const key = await crypto.subtle.importKey("raw", TEXT_ENCODER.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: decodeBase64UrlArrayBuffer(salt),
      iterations,
    },
    key,
    256,
  );
  return {
    salt,
    hash: encodeBase64Url(new Uint8Array(bits)),
    iterations,
  };
}

export async function verifyPassword(
  password: string,
  stored: { salt: string; hash: string; iterations: number },
): Promise<boolean> {
  const candidate = await hashPassword(password, {
    salt: stored.salt,
    iterations: stored.iterations,
  });
  return timingSafeStringEqual(candidate.hash, stored.hash);
}

export async function signAccessToken(claims: AccessTokenClaims, secret: string): Promise<string> {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson(claims);
  const signature = await hmacSha256(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export async function verifyAccessToken(token: string, secret: string, nowMs = Date.now()): Promise<AccessTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed access token.");
  }
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) {
    throw new Error("Malformed access token.");
  }
  const expectedSignature = await hmacSha256(`${header}.${payload}`, secret);
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw new Error("Invalid access token signature.");
  }
  const claims = decodeJson(payload);
  if (!isAccessTokenClaims(claims)) {
    throw new Error("Invalid access token claims.");
  }
  if (claims.expiresAt <= Math.floor(nowMs / 1000)) {
    throw new Error("Access token expired.");
  }
  return claims;
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(TEXT_ENCODER.encode(JSON.stringify(value)));
}

function decodeJson(value: string): unknown {
  return JSON.parse(TEXT_DECODER.decode(decodeBase64UrlArrayBuffer(value))) as unknown;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(decodeBase64UrlArrayBuffer(value));
}

function decodeBase64UrlArrayBuffer(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, "base64url");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function hmacSha256(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (!value || typeof value !== "object") {
    return false;
  }
  const claims = value as AccessTokenClaims;
  if (
    claims.tokenType !== "access" ||
    typeof claims.tokenId !== "string" ||
    typeof claims.userId !== "string" ||
    !Array.isArray(claims.capabilities) ||
    typeof claims.issuedAt !== "number" ||
    typeof claims.expiresAt !== "number"
  ) {
    return false;
  }
  if (claims.subjectKind === "user") {
    return true;
  }
  return (
    claims.subjectKind === "device" &&
    typeof claims.deviceId === "string" &&
    (claims.deviceKind === "desktop" || claims.deviceKind === "mobile")
  );
}
