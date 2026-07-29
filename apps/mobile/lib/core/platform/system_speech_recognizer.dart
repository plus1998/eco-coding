import 'dart:ui';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final systemSpeechRecognizerProvider = Provider<SystemSpeechRecognizer>((ref) {
  return const SystemSpeechRecognizer();
});

final systemSpeechRecognizerAvailabilityProvider =
    FutureProvider.family<bool, String?>((ref, locale) {
      return ref
          .watch(systemSpeechRecognizerProvider)
          .isAvailable(locale: locale);
    });

String? systemSpeechRecognitionLocaleTag([Locale? locale]) {
  final tag = (locale ?? PlatformDispatcher.instance.locale)
      .toLanguageTag()
      .trim();
  return tag.isEmpty ? null : tag;
}

class SystemSpeechRecognizer {
  const SystemSpeechRecognizer();

  static const MethodChannel _channel = MethodChannel(
    'eco_mobile/system_speech_recognizer',
  );
  static const EventChannel _levelChannel = EventChannel(
    'eco_mobile/system_speech_recognizer_levels',
  );

  Stream<double> get audioLevels {
    return _levelChannel.receiveBroadcastStream().map((value) {
      final level = value is num ? value.toDouble() : 0.0;
      return level.clamp(0.0, 1.0);
    });
  }

  Future<bool> isAvailable({String? locale}) async {
    final result = await _channel.invokeMethod<bool>(
      'isAvailable',
      _buildArgs(locale: locale),
    );
    return result ?? false;
  }

  Future<String> recognize({String? locale}) async {
    try {
      final result = await _channel.invokeMethod<String>(
        'recognize',
        _buildArgs(locale: locale),
      );
      return result?.trim() ?? '';
    } on PlatformException catch (error) {
      throw SystemSpeechRecognitionException.fromPlatformException(error);
    }
  }

  Future<void> stop() async {
    await _channel.invokeMethod<void>('stop');
  }

  Map<String, Object?> _buildArgs({String? locale}) {
    return {
      if (locale != null && locale.trim().isNotEmpty) 'locale': locale.trim(),
    };
  }
}

class SystemSpeechRecognitionException implements Exception {
  const SystemSpeechRecognitionException({
    required this.code,
    this.nativeMessage,
  });

  factory SystemSpeechRecognitionException.fromPlatformException(
    PlatformException error,
  ) {
    return SystemSpeechRecognitionException(
      code: error.code,
      nativeMessage: error.message?.trim(),
    );
  }

  final String code;
  final String? nativeMessage;

  @override
  String toString() =>
      nativeMessage?.isNotEmpty == true ? nativeMessage! : code;
}
