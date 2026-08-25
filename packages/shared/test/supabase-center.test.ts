import { expect, test } from "bun:test";
import {
  buildEcoBindTopic,
  buildEcoJsonRpcNotification,
  buildEcoJsonRpcRequest,
  buildEcoJsonRpcSuccess,
  buildEcoUserTopic,
  buildEcoVaultTopic,
  ECO_REALTIME_BROADCAST_EVENT,
  ECO_REALTIME_TOPIC_PREFIX,
  ECO_RPC_METHODS,
  ECO_VAULT_PASSWORD_WRAP_ALGORITHM,
  ECO_VAULT_WRAP_ALGORITHM,
  decryptSecretWithVaultKey,
  encryptSecretWithVaultKey,
  generateVaultClaimCode,
  generateVaultClaimKeyPair,
  generateVaultKey,
  hashVaultClaimCode,
  isEcoRealtimeRpcEnvelope,
  isEcoUuid,
  isPasswordWrappedVaultKey,
  isWrappedVaultKey,
  normalizeEcoUuid,
  normalizeVaultClaimCode,
  parseEcoBindTopic,
  parseEcoRealtimeTopic,
  parseEcoUserTopic,
  parseEcoVaultTopic,
  unwrapEcoRpcFromBroadcast,
  unwrapVaultKeyFromClaim,
  unwrapVaultKeyWithPassword,
  verifyVaultClaimCode,
  wrapEcoRpcForBroadcast,
  wrapVaultKeyForClaim,
  wrapVaultKeyWithPassword,
} from "../src";

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BINDING_ID = "11111111-2222-3333-4444-555555555555";
const CLAIM_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("builds and parses eco realtime topics", () => {
  expect(buildEcoUserTopic(USER_ID)).toBe(`${ECO_REALTIME_TOPIC_PREFIX.user}${USER_ID}`);
  expect(buildEcoBindTopic(BINDING_ID)).toBe(`${ECO_REALTIME_TOPIC_PREFIX.bind}${BINDING_ID}`);
  expect(buildEcoVaultTopic(CLAIM_ID)).toBe(`${ECO_REALTIME_TOPIC_PREFIX.vault}${CLAIM_ID}`);

  expect(parseEcoUserTopic(buildEcoUserTopic(USER_ID))).toBe(USER_ID);
  expect(parseEcoBindTopic(buildEcoBindTopic(BINDING_ID))).toBe(BINDING_ID);
  expect(parseEcoVaultTopic(buildEcoVaultTopic(CLAIM_ID))).toBe(CLAIM_ID);

  expect(parseEcoRealtimeTopic(buildEcoBindTopic(BINDING_ID))).toEqual({
    kind: "bind",
    id: BINDING_ID,
    topic: buildEcoBindTopic(BINDING_ID),
  });
});

test("normalizes UUID case for topics", () => {
  const upper = USER_ID.toUpperCase();
  expect(normalizeEcoUuid(upper)).toBe(USER_ID);
  expect(isEcoUuid(upper)).toBe(true);
  expect(buildEcoUserTopic(upper)).toBe(`eco:user:${USER_ID}`);
  expect(parseEcoUserTopic(`eco:user:${upper}`)).toBe(USER_ID);
});

test("rejects invalid realtime topics", () => {
  expect(parseEcoUserTopic("eco:user:not-a-uuid")).toBeNull();
  expect(parseEcoBindTopic("eco:vault:" + CLAIM_ID)).toBeNull();
  expect(parseEcoVaultTopic("eco:bind:" + BINDING_ID)).toBeNull();
  expect(parseEcoRealtimeTopic("public:room")).toBeNull();
  expect(() => buildEcoUserTopic("nope")).toThrow(/userId/);
});

test("wraps EcoJsonRpcMessage for supabase broadcast roundtrip", () => {
  const request = buildEcoJsonRpcRequest("req_1", ECO_RPC_METHODS.ping, { t: 1 });
  const envelope = wrapEcoRpcForBroadcast(request);

  expect(envelope).toEqual({
    v: 1,
    event: ECO_REALTIME_BROADCAST_EVENT,
    message: request,
  });
  expect(isEcoRealtimeRpcEnvelope(envelope)).toBe(true);
  expect(unwrapEcoRpcFromBroadcast(envelope)).toEqual(request);

  const notification = buildEcoJsonRpcNotification(ECO_RPC_METHODS.event, { kind: "x" });
  expect(unwrapEcoRpcFromBroadcast(wrapEcoRpcForBroadcast(notification))).toEqual(notification);

  const response = buildEcoJsonRpcSuccess("req_1", { ok: true });
  expect(unwrapEcoRpcFromBroadcast(wrapEcoRpcForBroadcast(response))).toEqual(response);
});

test("rejects malformed realtime envelopes", () => {
  expect(isEcoRealtimeRpcEnvelope(null)).toBe(false);
  expect(isEcoRealtimeRpcEnvelope({ v: 1, event: "other", message: {} })).toBe(false);
  expect(
    unwrapEcoRpcFromBroadcast({
      v: 2,
      event: ECO_REALTIME_BROADCAST_EVENT,
      message: buildEcoJsonRpcRequest("1", ECO_RPC_METHODS.ping, {}),
    }),
  ).toBeNull();
});

test("generates and normalizes 6-digit vault claim codes", () => {
  for (let i = 0; i < 20; i += 1) {
    const code = generateVaultClaimCode();
    expect(code).toMatch(/^\d{6}$/);
  }
  expect(normalizeVaultClaimCode(" 12-34 56 ")).toBe("123456");
  expect(normalizeVaultClaimCode("12345")).toBeNull();
  expect(normalizeVaultClaimCode("1234567")).toBeNull();
  expect(normalizeVaultClaimCode("12ab56")).toBeNull();
});

test("hashes vault claim codes for storage comparison only", async () => {
  const code = "042189";
  const hash = await hashVaultClaimCode(code);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(hash).not.toContain(code);
  expect(await verifyVaultClaimCode("042-189", hash)).toBe(true);
  expect(await verifyVaultClaimCode("000000", hash)).toBe(false);
  // Documented: hash is for DB compare — code itself is not AES key material.
  expect(hash.length).toBe(64);
});

test("wraps and unwraps vault_key via ECDH claim channel", async () => {
  const vaultKey = await generateVaultKey();
  const requester = await generateVaultClaimKeyPair();

  const wrapped = await wrapVaultKeyForClaim(vaultKey, requester.publicKey);
  expect(wrapped.algorithm).toBe(ECO_VAULT_WRAP_ALGORITHM);
  expect(isWrappedVaultKey(wrapped)).toBe(true);
  expect(wrapped.ciphertext).not.toContain(vaultKey);

  const unwrapped = await unwrapVaultKeyFromClaim(wrapped, requester.privateKey);
  expect(unwrapped).toBe(vaultKey);
});

test("wraps and unwraps vault_key with account login password", async () => {
  const vaultKey = await generateVaultKey();
  const password = "correct-horse-battery-staple";
  const wrapped = await wrapVaultKeyWithPassword(vaultKey, password, { iterations: 100_000 });
  expect(wrapped.algorithm).toBe(ECO_VAULT_PASSWORD_WRAP_ALGORITHM);
  expect(isPasswordWrappedVaultKey(wrapped)).toBe(true);
  expect(wrapped.ciphertext).not.toContain(vaultKey);
  expect(await unwrapVaultKeyWithPassword(wrapped, password)).toBe(vaultKey);
  await expect(unwrapVaultKeyWithPassword(wrapped, "wrong-password")).rejects.toThrow(
    /Incorrect password/,
  );
});

test("vault wrap fails across mismatched claim key pairs", async () => {
  const vaultKey = await generateVaultKey();
  const requester = await generateVaultClaimKeyPair();
  const other = await generateVaultClaimKeyPair();
  const wrapped = await wrapVaultKeyForClaim(vaultKey, requester.publicKey);
  await expect(unwrapVaultKeyFromClaim(wrapped, other.privateKey)).rejects.toThrow();
});

test("encrypts and decrypts API secrets with vault_key", async () => {
  const vaultKey = await generateVaultKey();
  const plaintext = "sk-test-provider-key-12345";
  const sealed = await encryptSecretWithVaultKey(vaultKey, plaintext);
  expect(sealed.ciphertext).not.toContain(plaintext);
  expect(sealed.nonce.length).toBeGreaterThan(0);
  expect(await decryptSecretWithVaultKey(vaultKey, sealed.ciphertext, sealed.nonce)).toBe(plaintext);

  const otherKey = await generateVaultKey();
  await expect(
    decryptSecretWithVaultKey(otherKey, sealed.ciphertext, sealed.nonce),
  ).rejects.toThrow();
});
