import type { AgentSession } from "@earendil-works/pi-coding-agent";

const shutdowns = new WeakMap<AgentSession, Promise<void>>();

/** SDK dispose invalidates the runner; extensions must shut down before that. */
export function disposePiSdkSession(session: AgentSession): Promise<void> {
  const existing = shutdowns.get(session);
  if (existing) return existing;
  const shutdown = (async () => {
    try {
      await session.abort();
    } finally {
      try {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } finally {
        session.dispose();
      }
    }
  })();
  shutdowns.set(session, shutdown);
  return shutdown;
}
