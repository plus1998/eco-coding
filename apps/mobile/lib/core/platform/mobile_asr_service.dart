import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';

import '../models/asr_models.dart';
import '../network/desktop_rpc.dart';
import '../providers/app_providers.dart';
import '../../features/threads/thread_providers.dart';

const asrSampleRate = 16000;
const asrChannels = 1;
const asrMaxDuration = Duration(seconds: 180);
const asrMaxDataUrlBytes = 10 * 1024 * 1024;
const asrRequestTimeout = Duration(seconds: 180);

String asrHttpErrorCode(int? status) {
  return switch (status) {
    401 || 403 => 'auth_failed',
    429 => 'rate_limited',
    _ => 'network',
  };
}

String normalizeAsrCompletionEndpoint(String value) {
  final uri = Uri.parse(value.trim());
  var path = uri.path.replaceFirst(RegExp(r'/+$'), '');
  path = path.replaceFirst(
    RegExp(r'(?:/chat/completions)+$', caseSensitive: false),
    '',
  );
  return Uri(
    scheme: uri.scheme,
    userInfo: uri.userInfo,
    host: uri.host,
    port: uri.hasPort ? uri.port : null,
    path: '$path/chat/completions',
  ).toString();
}

Map<String, dynamic> buildAsrRequestBody({
  required AsrClientConfig config,
  required String audioDataUrl,
}) {
  return {
    'model': config.model,
    'messages': [
      if (config.systemPrompt?.isNotEmpty == true)
        {'role': 'system', 'content': config.systemPrompt},
      {
        'role': 'user',
        'content': [
          {
            'type': 'input_audio',
            'input_audio': {'data': audioDataUrl, 'format': 'wav'},
          },
        ],
      },
    ],
    'stream': false,
    'asr_options': {'enable_itn': false},
  };
}

final mobileAsrServiceProvider = Provider<MobileAsrService>((ref) {
  final service = MobileAsrService(
    recorder: AudioRecorder(),
    dio: ref.read(ecoCenterClientProvider).dio,
    getRpc: () => ref.read(desktopRpcProvider),
  );
  ref.onDispose(() => unawaited(service.dispose()));
  return service;
});

enum AsrRecordingState { idle, recording, stopping }

class MobileAsrService {
  MobileAsrService({
    required AudioRecorder recorder,
    required Dio dio,
    required DesktopRpc? Function() getRpc,
  }) : _recorder = recorder,
       _dio = dio,
       _getRpc = getRpc;

  final AudioRecorder _recorder;
  final Dio _dio;
  final DesktopRpc? Function() _getRpc;
  final _stateController = StreamController<AsrRecordingState>.broadcast();
  final _levelController = StreamController<double>.broadcast();
  final List<Uint8List> _chunks = [];
  StreamSubscription<Uint8List>? _audioSubscription;
  StreamSubscription<Amplitude>? _amplitudeSubscription;
  Timer? _maximumDurationTimer;
  AsrClientConfig? _clientConfig;
  AsrRecordingState _state = AsrRecordingState.idle;
  Future<void>? _startFuture;
  Future<String>? _stopFuture;
  bool _starting = false;
  bool _cancelRequested = false;
  bool _disposed = false;

  Stream<AsrRecordingState> get states => _stateController.stream;
  Stream<double> get audioLevels => _levelController.stream;
  AsrRecordingState get state => _state;

  Future<void> start({Future<void> Function()? onMaximumDuration}) async {
    if (_disposed) {
      throw const AsrServiceException('disposed', '录音服务已释放');
    }
    if (_state != AsrRecordingState.idle || _starting) return;
    _starting = true;
    _cancelRequested = false;
    final future = _startInternal(onMaximumDuration);
    _startFuture = future;
    try {
      await future;
    } finally {
      _startFuture = null;
      _starting = false;
    }
  }

  Future<void> _startInternal(
    Future<void> Function()? onMaximumDuration,
  ) async {
    final rpc = _getRpc();
    if (rpc == null) {
      throw const AsrServiceException('desktop_offline', '未选择可用的桌面');
    }
    final status = await rpc.getAsrStatus();
    if (status.online == false) {
      throw const AsrServiceException('desktop_offline', '桌面当前离线');
    }
    if (!status.configured) {
      throw const AsrServiceException('not_configured', '桌面尚未配置 ASR API key');
    }
    final config = await rpc.getAsrClientConfig();
    if (_cancelRequested) {
      throw const AsrServiceException('cancelled', '录音已取消');
    }
    _clientConfig = config;
    if (!await _recorder.hasPermission()) {
      throw const AsrServiceException('permission_denied', '需要麦克风权限');
    }
    if (_cancelRequested) {
      throw const AsrServiceException('cancelled', '录音已取消');
    }
    _chunks.clear();
    try {
      final stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: asrSampleRate,
          numChannels: asrChannels,
        ),
      );
      if (_cancelRequested) {
        await _recorder.cancel();
        throw const AsrServiceException('cancelled', '录音已取消');
      }
      _state = AsrRecordingState.recording;
      _stateController.add(_state);
      _audioSubscription = stream.listen(_appendPcm);
      _amplitudeSubscription = _recorder
          .onAmplitudeChanged(const Duration(milliseconds: 75))
          .listen((amplitude) {
            if (_disposed) return;
            final db = amplitude.current;
            final normalized = db.isFinite
                ? ((db + 60) / 60).clamp(0.0, 1.0)
                : 0.0;
            _levelController.add(normalized);
          });
      _maximumDurationTimer = Timer(asrMaxDuration, () async {
        if (!_disposed) await onMaximumDuration?.call();
      });
    } catch (_) {
      await _cleanupRecording();
      _clientConfig = null;
      _chunks.clear();
      rethrow;
    }
    // Keep the client config only for this recording/transcription flow.
    assert(config.endpointUrl.isNotEmpty);
  }

  void _appendPcm(Uint8List bytes) {
    if (_state != AsrRecordingState.recording) return;
    _chunks.add(Uint8List.fromList(bytes));
  }

  Future<String> stopAndTranscribe() async {
    if (_state == AsrRecordingState.stopping) {
      return _stopFuture!;
    }
    if (_state != AsrRecordingState.recording) {
      throw const AsrServiceException('not_recording', '当前没有录音');
    }
    _state = AsrRecordingState.stopping;
    _stateController.add(_state);
    final future = _transcribeAfterStop();
    _stopFuture = future;
    try {
      return await future;
    } finally {
      _stopFuture = null;
    }
  }

  Future<String> _transcribeAfterStop() async {
    try {
      _maximumDurationTimer?.cancel();
      try {
        await _recorder.stop();
      } catch (_) {
        await _recorder.cancel();
        rethrow;
      }
      await _audioSubscription?.cancel();
      await _amplitudeSubscription?.cancel();
      _audioSubscription = null;
      _amplitudeSubscription = null;
      final pcm = _joinChunks();
      if (_cancelRequested) {
        throw const AsrServiceException('cancelled', '录音已取消');
      }
      if (pcm.isEmpty) {
        throw const AsrServiceException('empty_recording', '没有录到语音内容');
      }
      final wav = PcmWav.encode(pcm);
      final dataUrl = 'data:audio/wav;base64,${base64Encode(wav)}';
      if (utf8.encode(dataUrl).length > asrMaxDataUrlBytes) {
        throw const AsrServiceException('audio_too_large', '录音超过 10 MB 限制');
      }
      final config = _clientConfig;
      if (config == null) {
        throw const AsrServiceException('missing_config', '语音识别配置缺失');
      }
      final endpoint = _completionEndpoint(config.endpointUrl);
      final response = await _dio.post<dynamic>(
        endpoint,
        data: buildAsrRequestBody(config: config, audioDataUrl: dataUrl),
        options: Options(
          headers: {
            'Authorization': 'Bearer ${config.apiKey}',
            'Content-Type': 'application/json',
          },
          validateStatus: (_) => true,
          sendTimeout: asrRequestTimeout,
          receiveTimeout: asrRequestTimeout,
        ),
      );
      if ((response.statusCode ?? 0) < 200 ||
          (response.statusCode ?? 0) >= 300) {
        throw AsrServiceException(
          asrHttpErrorCode(response.statusCode),
          _asrHttpError(response.statusCode, response.data),
        );
      }
      return AsrTranscriptResponse.fromJson(response.data).text;
    } on DioException catch (error) {
      final code =
          error.type == DioExceptionType.connectionTimeout ||
              error.type == DioExceptionType.receiveTimeout ||
              error.type == DioExceptionType.sendTimeout
          ? 'timeout'
          : 'network';
      throw AsrServiceException(
        code,
        code == 'timeout' ? '语音识别请求超时' : '语音识别网络请求失败',
      );
    } on FormatException {
      throw const AsrServiceException('invalid_response', '语音识别返回格式无效');
    } finally {
      await _cleanupRecording();
      _clientConfig = null;
      _chunks.clear();
    }
  }

  Future<void> cancel() async {
    _cancelRequested = true;
    if (_starting) {
      try {
        await _startFuture;
      } catch (_) {
        return;
      }
    }
    if (_state == AsrRecordingState.stopping) {
      try {
        await _stopFuture;
      } catch (_) {
        // Cancellation intentionally prevents the pending transcription.
      }
      return;
    }
    if (_state == AsrRecordingState.recording) {
      await _recorder.cancel();
    }
    await _cleanupRecording();
    _chunks.clear();
    _clientConfig = null;
  }

  Future<void> _cleanupRecording() async {
    _maximumDurationTimer?.cancel();
    _maximumDurationTimer = null;
    await _audioSubscription?.cancel();
    await _amplitudeSubscription?.cancel();
    _audioSubscription = null;
    _amplitudeSubscription = null;
    if (_state != AsrRecordingState.idle) {
      _state = AsrRecordingState.idle;
      if (!_disposed) _stateController.add(_state);
    }
  }

  Uint8List _joinChunks() {
    final result = BytesBuilder(copy: false);
    for (final chunk in _chunks) {
      result.add(chunk);
    }
    return result.takeBytes();
  }

  String _completionEndpoint(String value) {
    return normalizeAsrCompletionEndpoint(value);
  }

  String _asrHttpError(int? status, Object? data) {
    final message = data is Map ? data['error'] : null;
    final detail = message is Map ? message['message'] : message;
    final suffix = detail is String && detail.trim().isNotEmpty
        ? ': ${detail.trim()}'
        : '';
    return switch (status) {
      401 || 403 => '语音识别鉴权失败$suffix',
      429 => '语音识别请求过于频繁$suffix',
      _ => '语音识别请求失败（HTTP ${status ?? 0}）$suffix',
    };
  }

  Future<void> dispose() async {
    _disposed = true;
    await cancel();
    await _stateController.close();
    await _levelController.close();
    await _recorder.dispose();
  }
}

class PcmWav {
  static Uint8List encode(Uint8List pcm) {
    final result = ByteData(44 + pcm.length);
    void ascii(int offset, String value) {
      for (var i = 0; i < value.length; i++) {
        result.setUint8(offset + i, value.codeUnitAt(i));
      }
    }

    ascii(0, 'RIFF');
    result.setUint32(4, 36 + pcm.length, Endian.little);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    result.setUint32(16, 16, Endian.little);
    result.setUint16(20, 1, Endian.little);
    result.setUint16(22, asrChannels, Endian.little);
    result.setUint32(24, asrSampleRate, Endian.little);
    result.setUint32(28, asrSampleRate * asrChannels * 2, Endian.little);
    result.setUint16(32, asrChannels * 2, Endian.little);
    result.setUint16(34, 16, Endian.little);
    ascii(36, 'data');
    result.setUint32(40, pcm.length, Endian.little);
    result.buffer.asUint8List().setRange(44, 44 + pcm.length, pcm);
    return result.buffer.asUint8List();
  }
}
