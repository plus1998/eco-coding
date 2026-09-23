import '../../core/models/conversation_v2_models.dart';
import 'activity_feed.dart';

/// Converts one lazily fetched V2 detail page into the existing collapsible
/// detail tile format. The page remains bounded by the RPC limit; this helper
/// does not fetch additional pages implicitly.
List<ActivityFeedEntry> buildConversationV2ToolDetailFeed(
  ConversationV2DetailPage page, {
  required String runId,
  String? toolCallId,
}) {
  final normalizedToolCallId = toolCallId?.trim();
  return [
    for (final item in page.items)
      if (item.runId == runId &&
          (normalizedToolCallId == null ||
              normalizedToolCallId.isEmpty ||
              item.toolCallId == normalizedToolCallId))
        ActivityFeedEntry(
          id: 'v2-detail:${item.itemId}',
          kind: ActivityFeedKind.thinking,
          text: _detailText(item),
          toolUseId: item.toolCallId,
          runAttemptId: item.runId,
          agentId: item.agentId,
          conversationV2Detail: item.toJson(),
          sequence: item.createdSeq,
        ),
  ];
}

String _detailText(ConversationV2Detail item) {
  final content = item.content?.trim();
  if (content != null && content.isNotEmpty) return item.content!;
  final ref = item.ref?.trim();
  if (ref != null && ref.isNotEmpty) return '${item.type} · $ref';
  return item.type;
}
