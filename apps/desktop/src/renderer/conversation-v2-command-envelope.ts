/** A new user action is a new command, even when its payload/history repeats. */
export async function buildConversationV2CommandEnvelope<T extends Record<string, unknown>>(input: {
  threadId: string;
  operation: string;
  payload: T;
  getHead: (threadId: string) => Promise<{ historyRevision: number }>;
}) {
  const clientCommandId = `command_${input.operation}_${crypto.randomUUID()}`;
  const head = await input.getHead(input.threadId);
  return {
    ...input.payload,
    principalId: "desktop-local",
    clientCommandId,
    threadId: input.threadId,
    expectedHistoryRevision: head.historyRevision,
  };
}
