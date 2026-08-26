import 'dart:ui';

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

import '../utils/markdown_to_speech_text.dart';

enum TtsPlaybackState { idle, speaking }

/// Wraps the platform TTS engine for reading agent output aloud.
class EcoTtsService extends ChangeNotifier {
  EcoTtsService({FlutterTts? engine}) : _engine = engine ?? FlutterTts();

  final FlutterTts _engine;
  TtsPlaybackState _state = TtsPlaybackState.idle;
  String? _activeEntryId;
  bool _initialized = false;

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
      _resetPlayback();
    });

    _engine.setCancelHandler(() {
      _resetPlayback();
    });

    _engine.setErrorHandler((message) {
      _resetPlayback();
    });
  }

  void _resetPlayback() {
    _state = TtsPlaybackState.idle;
    _activeEntryId = null;
    notifyListeners();
  }

  Future<bool> _applyLocale(Locale locale) async {
    final candidates = <String>[
      if (locale.countryCode != null && locale.countryCode!.isNotEmpty)
        '${locale.languageCode}-${locale.countryCode}',
      locale.languageCode,
      if (locale.languageCode == 'zh') 'zh-CN',
      if (locale.languageCode == 'en') 'en-US',
    ];

    for (final code in candidates) {
      final available = await _engine.isLanguageAvailable(code);
      if (available == true) {
        await _engine.setLanguage(code);
        return true;
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
      await _engine.stop();
      _resetPlayback();
    }

    await _applyLocale(locale);
    _activeEntryId = entryId;
    notifyListeners();

    final result = await _engine.speak(plainText);
    if (result != 1) {
      _resetPlayback();
      return false;
    }
    return true;
  }

  Future<void> stop() async {
    if (!isSpeaking) return;
    await _engine.stop();
    _resetPlayback();
  }

  @override
  void dispose() {
    unawaited(_engine.stop());
    super.dispose();
  }
}
