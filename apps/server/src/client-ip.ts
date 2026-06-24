import type { EcoDeviceKind } from "@eco/shared";

export function resolveClientIp(request: Request): string | undefined {
  const directHeader =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for");
  return normalizeIpAddress(directHeader?.split(",")[0]);
}

export function normalizeIpAddress(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unknown") {
    return undefined;
  }
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice("::ffff:".length);
  }
  return trimmed;
}

export function enrichDeviceMetadata(input: {
  metadata?: Record<string, string>;
  clientIp?: string;
  deviceKind: EcoDeviceKind;
}): Record<string, string> | undefined {
  const next = { ...(input.metadata ?? {}) };
  if (input.deviceKind === "desktop") {
    delete next.ipAddress;
    const observed = normalizeIpAddress(input.clientIp);
    if (observed) {
      next.ipAddress = observed;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function clientIdentity(request: Request): string {
  return resolveClientIp(request) ?? "unknown";
}
