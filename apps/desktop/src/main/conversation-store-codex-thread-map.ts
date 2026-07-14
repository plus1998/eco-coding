import type { ConversationStore } from "./conversation-store";
import type { CodexThreadAttributionRecord, CodexThreadMap } from "./codex-thread-map";

export class ConversationStoreCodexThreadMap implements CodexThreadMap {
  private readonly attribution = new Map<string, CodexThreadAttributionRecord>();

  constructor(private readonly store: ConversationStore) {}

  getCodexThreadId(ecoThreadId: string): string | undefined {
    const session = this.store.getThreadCoreSession(ecoThreadId.trim());
    return session?.coreKind === "codex" ? session.externalSessionId : undefined;
  }

  getEcoThreadId(codexThreadId: string): string | undefined {
    return this.store.getThreadIdByCoreSession("codex", codexThreadId.trim());
  }

  setMapping(ecoThreadId: string, codexThreadId: string): void {
    const thread = this.store.getThread(ecoThreadId.trim());
    if (!thread) {
      throw new Error(`Thread not found: ${ecoThreadId}`);
    }
    this.store.saveThreadCoreSession({
      threadId: thread.id,
      coreKind: "codex",
      externalSessionId: codexThreadId,
      cwd: thread.workspacePath,
    });
  }

  deleteMapping(ecoThreadId: string): void {
    this.store.deleteThreadCoreSession(ecoThreadId.trim(), "codex");
  }

  getThreadAttribution(codexThreadId: string): CodexThreadAttributionRecord | undefined {
    return this.attribution.get(codexThreadId.trim());
  }

  setThreadAttribution(codexThreadId: string, record: CodexThreadAttributionRecord): void {
    const id = codexThreadId.trim();
    if (!id || !record.parentThreadId.trim()) {
      throw new Error("Codex child attribution requires thread and parent ids.");
    }
    this.attribution.set(id, { ...record, parentThreadId: record.parentThreadId.trim() });
  }
}
