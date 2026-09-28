import { type ConversationMessage, stableHash } from "@eco/shared";
import type { ThreadPendingFollowUp } from "../shared/ipc";
import { abandonedFollowUpsForConversationMessage } from "../shared/thread-follow-up-drain";
import type { ConversationV2Store } from "./conversation-v2-store";

export interface DiscardAbandonedAcceptedPromptsInput {
  conversationId: string;
  /** V2 `message.accepted` identities (`ThreadPendingFollowUp.conversationMessageId`). */
  messageIds: readonly string[];
  reason: string;
  occurredAt?: string;
}

/**
 * Queued acceptances startup recovery must settle instead of resending, because the
 * queue row that was supposed to deliver them is cancelled or superseded.
 *
 * Recovery used to look only at the V2 status (`queued`), so a deleted follow-up came
 * back as a brand-new run on the next app start.
 */
export function abandonedQueuedAcceptedPrompts(input: {
  messages: readonly ConversationMessage[];
  listFollowUps: (conversationId: string) => readonly ThreadPendingFollowUp[];
}): ConversationMessage[] {
  return input.messages.filter(
    (message) =>
      abandonedFollowUpsForConversationMessage(input.listFollowUps(message.conversationId), message.messageId)
        .length > 0,
  );
}

/**
 * Drop the V2 accepted prompt a queue row was holding when that row can never deliver
 * it (user cancel, escalate-supersede).
 *
 * `message.accepted` stays `queued` until something finalizes it, so an abandoned row
 * leaves a ghost acceptance behind. Startup queued-message recovery only looks at the
 * V2 status, so that ghost is rescheduled as a fresh run — the prompt the user removed
 * comes back minutes later, on the next app start. Tombstoning the acceptance keeps it
 * out of history and out of recovery, matching how an accepted-prompt duplicate is
 * repaired.
 *
 * Rows that already reached a delivered outcome (`final`/`failed`/`cancelled`) are left
 * alone: a real delivery or a real failure owns them, not the abandoned queue row.
 */
export function discardAbandonedAcceptedPrompts(
  v2: ConversationV2Store,
  input: DiscardAbandonedAcceptedPromptsInput,
): string[] {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const discarded: string[] = [];
  for (const rawMessageId of input.messageIds) {
    const messageId = rawMessageId.trim();
    if (!messageId) continue;
    const existing = v2.getMessage(input.conversationId, messageId);
    if (!existing || existing.isDeleted) continue;
    if (existing.status === "final" || existing.status === "failed" || existing.status === "cancelled") {
      continue;
    }
    const sourceEventKey = `desktop:user:follow-up-abandoned:${input.conversationId}:${messageId}:${input.reason}`;
    v2.append({
      conversationId: input.conversationId,
      eventId: `desktop_v2_follow_up_abandoned_${stableHash(sourceEventKey)}`,
      sourceEventKey,
      type: "history.deleted",
      occurredAt,
      messageId,
      payload: { reason: input.reason, affectedMessageIds: [messageId] },
    });
    discarded.push(messageId);
  }
  return discarded;
}
