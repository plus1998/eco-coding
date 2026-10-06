import { CONVERSATION_V2_ERROR, ConversationV2Error } from "@eco/shared";

/** Isolate a corrupt/unmigrated conversation without suppressing its error or stopping other threads. */
export class ConversationRecoveryGate {
  private readonly failures = new Map<string, ConversationV2Error>();

  inspect(
    conversationIds: readonly string[],
    validate: (id: string) => void,
  ): ReadonlyMap<string, ConversationV2Error> {
    this.failures.clear();
    for (const id of conversationIds) {
      try {
        validate(id);
      } catch (error) {
        this.failures.set(
          id,
          error instanceof ConversationV2Error
            ? error
            : new ConversationV2Error(
                CONVERSATION_V2_ERROR.integrityFailure,
                `Conversation recovery failed: ${error instanceof Error ? error.message : String(error)}`,
                { conversationId: id },
              ),
        );
      }
    }
    return this.failures;
  }

  isBlocked(conversationId: string): boolean {
    return this.failures.has(conversationId);
  }

  assertReady(conversationId: string): void {
    const failure = this.failures.get(conversationId);
    if (failure) throw failure;
  }
}
