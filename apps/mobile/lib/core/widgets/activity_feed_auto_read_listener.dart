import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/threads/activity_feed.dart';
import '../providers/activity_feed_auto_read_provider.dart';
import '../providers/app_providers.dart';
import '../utils/activity_feed_speak_candidate.dart';

/// Starts TTS automatically when a new assistant message finishes streaming.
class ActivityFeedAutoReadListener extends ConsumerStatefulWidget {
  const ActivityFeedAutoReadListener({
    super.key,
    required this.threadId,
    required this.entries,
    required this.child,
  });

  final String threadId;
  final List<ActivityFeedEntry> entries;
  final Widget child;

  @override
  ConsumerState<ActivityFeedAutoReadListener> createState() =>
      _ActivityFeedAutoReadListenerState();
}

class _ActivityFeedAutoReadListenerState
    extends ConsumerState<ActivityFeedAutoReadListener> {
  String? _lastHandledEntryId;
  String? _mountedThreadId;

  @override
  void initState() {
    super.initState();
    _syncThreadSession(resetBaseline: true);
  }

  @override
  void didUpdateWidget(ActivityFeedAutoReadListener oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.threadId != widget.threadId) {
      unawaited(ref.read(ecoTtsServiceProvider).stop());
      _syncThreadSession(resetBaseline: true);
      return;
    }
    if (!identical(oldWidget.entries, widget.entries) ||
        oldWidget.entries.length != widget.entries.length) {
      _maybeAutoRead();
    } else {
      final oldCandidate = findLatestAssistantSpeakCandidate(oldWidget.entries);
      final nextCandidate = findLatestAssistantSpeakCandidate(widget.entries);
      if (oldCandidate?.id != nextCandidate?.id ||
          oldCandidate?.streaming != nextCandidate?.streaming ||
          oldCandidate?.text != nextCandidate?.text) {
        _maybeAutoRead();
      }
    }
  }

  void _syncThreadSession({required bool resetBaseline}) {
    _mountedThreadId = widget.threadId;
    if (resetBaseline) {
      final baseline = findLatestAssistantSpeakCandidate(widget.entries);
      _lastHandledEntryId =
          baseline != null && !baseline.streaming ? baseline.id : null;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _maybeAutoRead();
    });
  }

  void _maybeAutoRead() {
    if (_mountedThreadId != widget.threadId) return;
    if (!ref.read(activityFeedAutoReadProvider)) return;

    final candidate = findLatestAssistantSpeakCandidate(widget.entries);
    if (candidate == null || candidate.streaming) return;
    if (candidate.id == _lastHandledEntryId) return;

    _lastHandledEntryId = candidate.id;
    final locale = Localizations.localeOf(context);
    unawaited(
      ref.read(ecoTtsServiceProvider).speak(
            entryId: candidate.id,
            sourceText: candidate.text,
            locale: locale,
          ),
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<bool>(activityFeedAutoReadProvider, (previous, next) {
      if (next) {
        final baseline = findLatestAssistantSpeakCandidate(widget.entries);
        _lastHandledEntryId =
            baseline != null && !baseline.streaming ? baseline.id : null;
        return;
      }
      unawaited(ref.read(ecoTtsServiceProvider).stop());
    });

    return widget.child;
  }
}
