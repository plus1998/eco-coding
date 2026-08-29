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
  String? _mountedThreadId;
  bool _baselineEstablished = false;
  String? _baselineEntryId;
  String? _baselineEntryText;
  bool _baselineEntryWasStreaming = false;
  String? _lastHandledEntryId;
  String? _lastHandledText;

  @override
  void initState() {
    super.initState();
    _mountedThreadId = widget.threadId;
    _maybeEstablishBaseline(widget.entries);
  }

  @override
  void deactivate() {
    // Prefer deactivate over dispose: Riverpod forbids using `ref` after dispose.
    unawaited(ref.read(ecoTtsServiceProvider).stop());
    super.deactivate();
  }

  @override
  void didUpdateWidget(ActivityFeedAutoReadListener oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.threadId != widget.threadId) {
      unawaited(ref.read(ecoTtsServiceProvider).stop());
      _resetSession(widget.threadId);
      _maybeEstablishBaseline(widget.entries);
      return;
    }

    if (!_baselineEstablished) {
      _maybeEstablishBaseline(widget.entries);
      return;
    }

    if (!identical(oldWidget.entries, widget.entries) ||
        oldWidget.entries.length != widget.entries.length) {
      _maybeAutoRead();
      return;
    }

    final oldCandidate = findLatestAssistantSpeakCandidate(oldWidget.entries);
    final nextCandidate = findLatestAssistantSpeakCandidate(widget.entries);
    if (oldCandidate?.id != nextCandidate?.id ||
        oldCandidate?.streaming != nextCandidate?.streaming ||
        oldCandidate?.text != nextCandidate?.text) {
      _maybeAutoRead();
    }
  }

  void _resetSession(String threadId) {
    _mountedThreadId = threadId;
    _baselineEstablished = false;
    _baselineEntryId = null;
    _baselineEntryText = null;
    _baselineEntryWasStreaming = false;
    _lastHandledEntryId = null;
    _lastHandledText = null;
  }

  void _maybeEstablishBaseline(List<ActivityFeedEntry> entries) {
    if (_baselineEstablished || entries.isEmpty) return;

    final candidate = findLatestAssistantSpeakCandidate(entries);
    _baselineEntryId = candidate?.id;
    _baselineEntryText = candidate?.text;
    _baselineEntryWasStreaming = candidate?.streaming ?? false;
    if (candidate != null && !candidate.streaming) {
      _lastHandledEntryId = candidate.id;
      _lastHandledText = candidate.text;
    }
    _baselineEstablished = true;
  }

  void _establishBaselineFromCurrentEntries() {
    _maybeEstablishBaseline(widget.entries);
    if (!_baselineEstablished && widget.entries.isNotEmpty) {
      final candidate = findLatestAssistantSpeakCandidate(widget.entries);
      _baselineEntryId = candidate?.id;
      _baselineEntryText = candidate?.text;
      _baselineEntryWasStreaming = candidate?.streaming ?? false;
      _lastHandledEntryId =
          candidate != null && !candidate.streaming ? candidate.id : null;
      _lastHandledText =
          candidate != null && !candidate.streaming ? candidate.text : null;
      _baselineEstablished = true;
    }
  }

  bool _isBaselineHistoryEntry(ActivityFeedSpeakCandidate candidate) {
    return candidate.id == _baselineEntryId &&
        candidate.text == _baselineEntryText &&
        !_baselineEntryWasStreaming;
  }

  void _maybeAutoRead() {
    if (_mountedThreadId != widget.threadId) return;
    if (!_baselineEstablished) return;
    if (!ref.read(activityFeedAutoReadProvider)) return;

    final candidate = findLatestAssistantSpeakCandidate(widget.entries);
    if (candidate == null || candidate.streaming) return;

    if (_isBaselineHistoryEntry(candidate)) return;

    if (candidate.id == _lastHandledEntryId &&
        candidate.text == _lastHandledText) {
      return;
    }

    _lastHandledEntryId = candidate.id;
    _lastHandledText = candidate.text;
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
        _establishBaselineFromCurrentEntries();
        return;
      }
      unawaited(ref.read(ecoTtsServiceProvider).stop());
    });

    return widget.child;
  }
}
