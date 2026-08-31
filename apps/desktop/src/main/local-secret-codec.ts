import type { CenterServerSecretCodec } from "./center-server-store";

const LEGACY_KEYCHAIN_PREFIXES = ["safe-v1:", "safe:v1:"] as const;
export const LOCAL_SECRET_PREFIX = "plain:v1:";

export interface LocalSecretCodec {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

function isLegacyKeychainValue(value: string): boolean {
  return LEGACY_KEYCHAIN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function throwLegacyKeychainError(): never {
  throw new Error("该敏感信息由旧版系统钥匙串加密存储，请重新输入并保存。");
}

export function createLocalSecretCodec(): LocalSecretCodec {
  return {
    isAvailable: () => true,
    encrypt(value: string) {
      return `${LOCAL_SECRET_PREFIX}${value}`;
    },
    decrypt(value: string) {
      if (!value) {
        return "";
      }
      if (isLegacyKeychainValue(value)) {
        throwLegacyKeychainError();
      }
      if (value.startsWith(LOCAL_SECRET_PREFIX)) {
        return value.slice(LOCAL_SECRET_PREFIX.length);
      }
      return value;
    },
  };
}

export function createLocalCenterServerSecretCodec(): CenterServerSecretCodec {
  return {
    encode(value: string) {
      if (!value) {
        return "";
      }
      return `${LOCAL_SECRET_PREFIX}${value}`;
    },
    decode(value: string) {
      if (!value) {
        return "";
      }
      if (isLegacyKeychainValue(value)) {
        throwLegacyKeychainError();
      }
      if (value.startsWith(LOCAL_SECRET_PREFIX)) {
        return value.slice(LOCAL_SECRET_PREFIX.length);
      }
      return value;
    },
  };
}
