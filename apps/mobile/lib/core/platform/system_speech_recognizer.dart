import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final systemSpeechRecognizerProvider = Provider<SystemSpeechRecognizer>((ref) {
  return const SystemSpeechRecognizer();
});

class SystemSpeechRecognizer {
  const SystemSpeechRecognizer();

  static const MethodChannel _channel = MethodChannel(
    'eco_mobile/system_speech_recognizer',
  );

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
    required this.message,
  });

  factory SystemSpeechRecognitionException.fromPlatformException(
    PlatformException error,
  ) {
    return SystemSpeechRecognitionException(
      code: error.code,
      message: _messageForCode(error.code, error.message),
    );
  }

  final String code;
  final String message;

  @override
  String toString() => message;
}

String _messageForCode(String code, String? fallback) {
  return switch (code) {
    'permission_denied' => '需要麦克风与语音识别权限',
    'unavailable' => '当前设备没有可用的系统语音识别',
    'busy' => '正在识别上一段语音',
    'no_match' => '未识别到语音内容',
    'network' => '系统语音识别服务暂时不可用',
    _ => fallback?.trim().isNotEmpty == true ? fallback!.trim() : '语音识别失败',
  };
}
