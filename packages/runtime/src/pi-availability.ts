export interface PiCoreAvailability {
  available: boolean;
  version?: string;
  reason?: string;
}

let cached: PiCoreAvailability | undefined;

/** Reset in-process probe cache (tests only). */
export function resetPiCoreAvailabilityCache(): void {
  cached = undefined;
}

/**
 * Probe whether `@earendil-works/pi-coding-agent` can be loaded.
 * Failures are explicit — never silent-fallback to another Core.
 */
export async function probePiCoreAvailability(): Promise<PiCoreAvailability> {
  if (cached) {
    return cached;
  }
  try {
    const mod = await import("@earendil-works/pi-coding-agent");
    const version =
      typeof (mod as { VERSION?: string }).VERSION === "string"
        ? (mod as { VERSION: string }).VERSION
        : undefined;
    if (typeof mod.createAgentSession !== "function") {
      cached = {
        available: false,
        reason: "PI coding-agent package loaded but createAgentSession is missing.",
      };
      return cached;
    }
    cached = {
      available: true,
      ...(version && { version }),
    };
    return cached;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cached = {
      available: false,
      reason: `PI Core 不可用：无法加载 @earendil-works/pi-coding-agent（${message}）。`,
    };
    return cached;
  }
}

export function isPiCoreAvailableSync(): boolean {
  return cached?.available === true;
}
