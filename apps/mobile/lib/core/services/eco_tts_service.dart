import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

import '../utils/markdown_to_speech_text.dart';
import '../utils/speech_text_segments.dart';

enum TtsPlaybackState { idle, speaking }

/// Wraps the platform TTS engine for reading agent output aloud.
class EcoTtsService extends ChangeNotifier {
  EcoTtsService({FlutterTts? engine}) : _engine = engine ?? FlutterTts();

  final FlutterTts _engine;
  TtsPlaybackState _state = TtsPlaybackState.idle;
  String? _activeEntryId;
  bool _initialized = false;
  List<SpeechTextSegment> _pendingSegments = const [];
  int _segmentIndex = 0;
  Locale _appLocale = const Locale('zh');

  TtsPlaybackState get state => _state;
  String? get activeEntryId => _activeEntryId;
  bool get isSpeaking => _state == TtsPlaybackState.speaking;

  bool isSpeakingEntry(String entryId) =>
      _state == TtsPlaybackState.speaking && _activeEntryId == entryId;

  Future<void> _ensureInitialized() async {
    if (_initialized) return;
    _initialized = true;

    await _engine.setSpeechRate(0.5);
    await _engine.setVolume(1.0);
    await _engine.setPitch(1.0);

    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      await _engine.setSharedInstance(true);
    }

    _engine.setStartHandler(() {
      _state = TtsPlaybackState.speaking;
      notifyListeners();
    });

    _engine.setCompletionHandler(() {
      unawaited(_onSegmentComplete());
    });

    _engine.setCancelHandler(() {
      _finishPlayback();
    });

    _engine.setErrorHandler((message) {
      _finishPlayback();
    });
  }

  void _finishPlayback() {
    _pendingSegments = const [];
    _segmentIndex = 0;
    _state = TtsPlaybackState.idle;
    _activeEntryId = null;
    notifyListeners();
  }

  Future<void> _onSegmentComplete() async {
    if (_pendingSegments.isEmpty) {
      _finishPlayback();
      return;
    }

    final nextIndex = _segmentIndex + 1;
    if (nextIndex >= _pendingSegments.length) {
      _finishPlayback();
      return;
    }

    _segmentIndex = nextIndex;
    await _speakSegmentAt(nextIndex);
  }

  Future<bool> _trySetLanguage(List<String> candidates) async {
    for (final code in candidates) {
      final result = await _engine.setLanguage(code);
      if (result == 1) return true;

      final available = await _engine.isLanguageAvailable(code);
      if (available == true) {
        final retry = await _engine.setLanguage(code);
        if (retry == 1) return true;
      }
    }
    return false;
  }

  Future<bool> _speakSegmentAt(int index) async {
    if (index < 0 || index >= _pendingSegments.length) {
      return false;
    }

    final segment = _pendingSegments[index];
    final text = segment.text.trim();
    if (text.isEmpty) {
      if (index + 1 < _pendingSegments.length) {
        _segmentIndex = index + 1;
        return _speakSegmentAt(index + 1);
      }
      _finishPlayback();
      return true;
    }

    await _trySetLanguage(
      languageCandidatesForSegment(segment, _appLocale),
    );

    final result = await _engine.speak(segment.text);
    if (result != 1) {
      _finishPlayback();
      return false;
    }
    return true;
  }

  Future<bool> speak({
    required String entryId,
    required String sourceText,
    required Locale locale,
  }) async {
    await _ensureInitialized();

    final plainText = markdownToSpeechText(sourceText);
    if (plainText.isEmpty) return false;

    if (isSpeakingEntry(entryId)) {
      await stop();
      return true;
    }

    if (isSpeaking) {
      await _engine.stop();
      _finishPlayback();
    }

    final segments = splitSpeechTextSegments(plainText);
    if (segments.isEmpty) return false;

    _appLocale = locale;
    _pendingSegments = segments;
    _segmentIndex = 0;
    _activeEntryId = entryId;
    notifyListeners();

    return _speakSegmentAt(0);
  }

  Future<void> stop() async {
    if (!isSpeaking && _pendingSegments.isEmpty) return;
    _pendingSegments = const [];
    _segmentIndex = 0;
    await _engine.stop();
    _finishPlayback();
  }

  @override
  void dispose() {
    unawaited(_engine.stop());
    super.dispose();
  }
}
