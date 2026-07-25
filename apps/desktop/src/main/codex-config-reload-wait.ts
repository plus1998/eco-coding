export type CodexConfigReloadReadiness =
  | { kind: "ready" }
  | { kind: "skip" }
  | { kind: "busy"; activeThreadIds: readonly string[] };

export interface WaitForCodexConfigReloadInput {
  check: () => Promise<CodexConfigReloadReadiness>;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  onWaiting?: (activeThreadIds: readonly string[]) => void;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export async function waitForCodexConfigReload(
  input: WaitForCodexConfigReloadInput,
): Promise<"ready" | "skip"> {
  let previousBlockers = "";
  while (true) {
    input.signal?.throwIfAborted();
    const readiness = await input.check();
    input.signal?.throwIfAborted();
    if (readiness.kind !== "busy") {
      return readiness.kind;
    }

    const activeThreadIds = [
      ...new Set(readiness.activeThreadIds.map((id) => id.trim()).filter(Boolean)),
    ].sort();
    const blockerKey = activeThreadIds.join("\0");
    if (blockerKey !== previousBlockers) {
      previousBlockers = blockerKey;
      input.onWaiting?.(activeThreadIds);
    }
    await (input.wait ?? waitForDelay)(input.pollIntervalMs ?? 500, input.signal);
  }
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Codex config reload wait was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
