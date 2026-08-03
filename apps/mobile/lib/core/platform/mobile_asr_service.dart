import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';

import '../models/asr_models.dart';
import '../network/desktop_rpc.dart';
import '../../features/threads/thread_providers.dart';

const asrSampleRate = 16000;
const asrChannels = 1;
const asrMaxDuration = Duration(seconds: 180);
const asrMaxAudioBase64Bytes = 10 * 1024 * 1024;

String asrHttpErrorCode(int? status) {
  return switch (status) {
    401 || 403 => 'auth_failed',
    429 => 'rate_limited',
    _ => 'network',
  };
}

/// Map recorder dBFS (`Amplitude.current`) into 0..1 for waveform display.
///
/// Android ambient noise often sits around -35..-25 dBFS. Mapping from
/// [-60, 0] made that baseline look nearly full before any speech.
double normalizeAsrAmplitudeDb(double db) {
  if (!db.isFinite) return 0;
  const floorDb = -50.0;
  const ceilingDb = -8.0;
  if (db <= floorDb) return 0;
  if (db >= ceilingDb) return 1;
  return ((db - floorDb) / (ceilingDb - floorDb)).clamp(0.0, 1.0);
}

String normalizeAsrBaseEndpoint(String value) {
  final uri = Uri.parse(value.trim());
  var path = uri.path.replaceFirst(RegExp(r'/+$'), '');
  path = path.replaceFirst(
    RegExp(r'(?:/chat/completions)+$', caseSensitive: false),
    '',
  );
  path = path.replaceFirst(
    RegExp(r'(?:/audio/transcriptions)+$', caseSensitive: false),
    '',
  );
  return Uri(
    scheme: uri.scheme,
    userInfo: uri.userInfo,
    host: uri.host,
    port: uri.hasPort ? uri.port : null,
    path: path.isEmpty ? '/' : path,
  ).toString().replaceFirst(RegExp(r'/+$'), '');
}

String normalizeAsrRequestEndpoint(String value, AsrApiMode apiMode) {
  final base = normalizeAsrBaseEndpoint(value);
  final suffix = apiMode == AsrApiMode.audioTranscriptions
      ? '/audio/transcriptions'
      : '/chat/completions';
  if (base.endsWith('/')) {
    return '${base.substring(0, base.length - 1)}$suffix';
  }
  return '$base$suffix';
}

/// Legacy alias used by existing tests; always builds chat completions path.
String normalizeAsrCompletionEndpoint(String value) {
  return normalizeAsrRequestEndpoint(value, AsrApiMode.chatCompletions);
}

Map<String, dynamic> buildAsrRequestBody({
  required AsrClientConfig config,
  required String audioDataUrl,
}) {
  return {
    'model': config.model,
    'messages': [
      // Qwen ASR OpenAI-compatible API requires system content as [{ text }], not a plain string.
      if (config.systemPrompt?.isNotEmpty == true)
        {
          'role': 'system',
          'content': [
            {'text': config.systemPrompt},
          ],
        },
      {
        'role': 'user',
        'content': [
          {
            'type': 'input_audio',
            'input_audio': {'data': audioDataUrl},
          },
        ],
      },
    ],
    'stream': false,
    'asr_options': {'enable_itn': false},
  };
}

FormData buildAsrTranscriptionsFormData({
  required AsrClientConfig config,
  required Uint8List wavBytes,
}) {
  return FormData.fromMap({
    'file': MultipartFile.fromBytes(
      wavBytes,
      filename: 'audio.wav',
      contentType: DioMediaType('audio', 'wav'),
    ),
    'model': config.model,
    if (config.systemPrompt?.isNotEmpty == true) 'prompt': config.systemPrompt,
  });
}

final mobileAsrServiceProvider = Provider<MobileAsrService>((ref) {
  final service = MobileAsrService(
    recorder: AudioRecorder(),
    getRpc: () => ref.read(desktopRpcProvider),
  );
  ref.onDispose(() => unawaited(service.dispose()));
  return service;
});

enum AsrRecordingState { idle, recording, stopping }

abstract interface class MobileAsrRecorder {
  Future<bool> hasPermission();

  Future<Stream<Uint8List>> startStream(RecordConfig config);

  Stream<Amplitude> onAmplitudeChanged(Duration interval);

  Future<String?> stop();

  Future<void> cancel();

  Future<void> dispose();
}

class _AudioRecorderAdapter implements MobileAsrRecorder {
  _AudioRecorderAdapter(this._recorder);

  final AudioRecorder _recorder;

  @override
  Future<void> cancel() => _recorder.cancel();

  @override
  Future<void> dispose() => _recorder.dispose();

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Stream<Amplitude> onAmplitudeChanged(Duration interval) =>
      _recorder.onAmplitudeChanged(interval);

  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) =>
      _recorder.startStream(config);

  @override
  Future<String?> stop() => _recorder.stop();
}

class MobileAsrService {
  MobileAsrService({
    required AudioRecorder recorder,
    required DesktopRpc? Function() getRpc,
  }) : this.withRecorder(
         recorder: _AudioRecorderAdapter(recorder),
         getRpc: getRpc,
       );

  MobileAsrService.withRecorder({
    required MobileAsrRecorder recorder,
    required DesktopRpc? Function() getRpc,
  }) : _recorder = recorder,
       _getRpc = getRpc;

  final MobileAsrRecorder _recorder;
  final DesktopRpc? Function() _getRpc;
  final _stateController = StreamController<AsrRecordingState>.broadcast();
  final _levelController = StreamController<double>.broadcast();
  final List<Uint8List> _chunks = [];
  StreamSubscription<Uint8List>? _audioSubscription;
  StreamSubscription<Amplitude>? _amplitudeSubscription;
  Timer? _maximumDurationTimer;
  DesktopRpc? _recordingRpc;
  String? _recordingProfileId;
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
      throw const AsrServiceException('not_configured', '桌面尚未配置 ASR');
    }
    final profileId = status.activeProfileId;
    if (profileId == null || profileId.isEmpty) {
      throw const AsrServiceException('missing_profile', '桌面未返回当前 ASR profile');
    }
    if (_cancelRequested) {
      throw const AsrServiceException('cancelled', '录音已取消');
    }
    if (!await _recorder.hasPermission()) {
      throw const AsrServiceException('permission_denied', '需要麦克风权限');
    }
    if (_cancelRequested) {
      throw const AsrServiceException('cancelled', '录音已取消');
    }
    _chunks.clear();
    _recordingRpc = rpc;
    _recordingProfileId = profileId;
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
            _levelController.add(normalizeAsrAmplitudeDb(db));
          });
      _maximumDurationTimer = Timer(asrMaxDuration, () async {
        if (!_disposed) await onMaximumDuration?.call();
      });
    } catch (_) {
      await _cleanupRecording();
      _recordingRpc = null;
      _recordingProfileId = null;
      _chunks.clear();
      rethrow;
    }
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
      final audioWavBase64 = base64Encode(wav);
      if (audioWavBase64.length > asrMaxAudioBase64Bytes) {
        throw const AsrServiceException('audio_too_large', '录音超过 10 MB 限制');
      }
      final rpc = _recordingRpc;
      final profileId = _recordingProfileId;
      if (rpc == null || profileId == null) {
        throw const AsrServiceException('missing_profile', '语音识别 profile 缺失');
      }
      return await rpc.transcribeAsr(
        audioWavBase64: audioWavBase64,
        profileId: profileId,
      );
    } on FormatException {
      throw const AsrServiceException('invalid_response', '语音识别返回格式无效');
    } finally {
      await _cleanupRecording();
      _recordingRpc = null;
      _recordingProfileId = null;
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
    _recordingRpc = null;
    _recordingProfileId = null;
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
