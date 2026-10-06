import type { Page } from "@playwright/test";

/** Send a follow-up through the durable Conversation V2 command boundary. */
export async function sendConversationV2(
  page: Page,
  threadId: string,
  prompt: string,
  scope: string,
): Promise<unknown> {
  const clientCommandId = `e2e_conversation_send_${scope}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
  return page.evaluate(
    async ({ threadId: conversationId, prompt: text, clientCommandId: commandId }) => {
      if (typeof window.eco?.conversationV2SendMessage !== "function") {
        throw new Error("Conversation V2 send command is unavailable.");
      }
      return window.eco.conversationV2SendMessage({
        principalId: "desktop-e2e",
        conversationId,
        clientCommandId: commandId,
        text,
      });
    },
    { threadId, prompt, clientCommandId },
  );
}
