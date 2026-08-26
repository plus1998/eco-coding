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
  int _playbackGeneration = 0;
  int _activeGeneration = 0;

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
      if (!_isActiveGeneration(_activeGeneration)) return;
      _state = TtsPlaybackState.speaking;
      notifyListeners();
    });

    _engine.setCompletionHandler(() {
      if (!_isActiveGeneration(_activeGeneration)) return;
      _finishPlayback();
    });

    _engine.setCancelHandler(() {
      if (!_isActiveGeneration(_activeGeneration)) return;
      _finishPlayback();
    });

    _engine.setErrorHandler((message) {
      if (!_isActiveGeneration(_activeGeneration)) return;
      _finishPlayback();
    });
  }

  bool _isActiveGeneration(int generation) => generation == _playbackGeneration;

  void _finishPlayback() {
    _state = TtsPlaybackState.idle;
    _activeEntryId = null;
    notifyListeners();
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
      await stop();
    }

    final generation = ++_playbackGeneration;
    _activeGeneration = generation;
    _activeEntryId = entryId;
    notifyListeners();

    await _trySetLanguage(
      speechLanguageCandidatesForText(plainText, locale),
    );

    if (!_isActiveGeneration(generation)) return false;

    final result = await _engine.speak(plainText);
    if (!_isActiveGeneration(generation)) return false;

    if (result != 1) {
      _finishPlayback();
      return false;
    }
    return true;
  }

  Future<void> stop() async {
    if (!isSpeaking && _activeEntryId == null) return;

    _playbackGeneration++;
    _activeGeneration = _playbackGeneration;
    await _engine.stop();
    _finishPlayback();
  }

  @override
  void dispose() {
    _playbackGeneration++;
    unawaited(_engine.stop());
    super.dispose();
  }
}
