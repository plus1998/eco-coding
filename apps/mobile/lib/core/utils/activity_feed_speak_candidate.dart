import '../../features/threads/activity_feed.dart';

class ActivityFeedSpeakCandidate {
  const ActivityFeedSpeakCandidate({
    required this.id,
    required this.text,
    required this.streaming,
  });

  final String id;
  final String text;
  final bool streaming;
}

/// Returns the latest assistant narrative block in chronological feed order.
ActivityFeedSpeakCandidate? findLatestAssistantSpeakCandidate(
  List<ActivityFeedEntry> entries,
) {
  ActivityFeedSpeakCandidate? latest;

  void visit(ActivityFeedEntry entry) {
    if (entry.kind == ActivityFeedKind.assistant &&
        entry.text.trim().isNotEmpty) {
      latest = ActivityFeedSpeakCandidate(
        id: entry.id,
        text: entry.text,
        streaming: entry.streaming,
      );
    }

    if (entry.kind == ActivityFeedKind.turn) {
      for (final child in entry.processEntries) {
        visit(child);
      }
      final output = entry.finalOutput;
      if (output != null) {
        visit(output);
      }
    }

    for (final child in entry.actionChildren) {
      visit(child);
    }
  }

  for (final entry in entries) {
    visit(entry);
  }
  return latest;
}
