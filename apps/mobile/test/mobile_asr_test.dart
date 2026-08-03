import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:eco_mobile/core/models/asr_models.dart';
import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/platform/mobile_asr_service.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:eco_mobile/features/composer/session_composer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';

void main() {
  test('composer dispose cancels recording and stopping states', () {
    expect(
      shouldCancelMobileAsrOnDispose(speechBusy: true, speechFinishing: false),
      isTrue,
    );
    expect(
      shouldCancelMobileAsrOnDispose(speechBusy: false, speechFinishing: true),
      isTrue,
    );
    expect(
      shouldCancelMobileAsrOnDispose(speechBusy: false, speechFinishing: false),
      isFalse,
    );
  });

  test('maps HTTP failures to stable ASR error codes', () {
    expect(asrHttpErrorCode(401), 'auth_failed');
    expect(asrHttpErrorCode(403), 'auth_failed');
    expect(asrHttpErrorCode(429), 'rate_limited');
    expect(asrHttpErrorCode(500), 'network');
    expect(asrHttpErrorCode(null), 'network');
  });

  test('maps recorder dBFS into graduated waveform levels', () {
    expect(normalizeAsrAmplitudeDb(double.nan), 0);
    expect(normalizeAsrAmplitudeDb(-80), 0);
    expect(normalizeAsrAmplitudeDb(-50), 0);
    // Android ambient often sits near -35 dBFS; must stay well below full.
    final ambient = normalizeAsrAmplitudeDb(-35);
    expect(ambient, greaterThan(0));
    expect(ambient, lessThan(0.5));
    final speech = normalizeAsrAmplitudeDb(-20);
    final loud = normalizeAsrAmplitudeDb(-10);
    expect(speech, greaterThan(ambient));
    expect(loud, greaterThan(speech));
    expect(normalizeAsrAmplitudeDb(-8), 1);
    expect(normalizeAsrAmplitudeDb(0), 1);
  });

  test('encodes PCM16 as a standard mono WAV', () {
    final wav = PcmWav.encode(Uint8List.fromList([1, 2, 3, 4]));
    expect(wav.length, 48);
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
    expect(String.fromCharCodes(wav.sublist(12, 16)), 'fmt ');
    expect(wav[20], 1);
    expect(wav[22], 1);
    expect(ByteData.sublistView(wav).getUint32(24, Endian.little), 16000);
    expect(String.fromCharCodes(wav.sublist(36, 40)), 'data');
    expect(ByteData.sublistView(wav).getUint32(40, Endian.little), 4);
    expect(wav.sublist(44), [1, 2, 3, 4]);
  });

  test('prefers the desktop endpoint and strictly parses the ASR response', () {
    final config = AsrClientConfig.fromJson({
      'endpoint': 'https://example.test/v1',
      'endpointUrl': 'https://example.test/v1',
      'baseUrl': 'https://wrong.test',
      'apiKey': 'secret',
      'model': ' custom-asr-model ',
      'systemPrompt': 'transcribe',
    });
    expect(config.endpointUrl, 'https://example.test/v1');
    expect(config.model, 'custom-asr-model');
    expect(config.apiMode, AsrApiMode.chatCompletions);
    expect(
      AsrTranscriptResponse.fromJson({
        'choices': [
          {
            'message': {'content': ' hello '},
          },
        ],
      }).text,
      'hello',
    );
    expect(
      AsrTranscriptResponse.fromJson({
        'choices': [
          {
            'message': {
              'content': [
                {'text': 'hello '},
                {'text': 'world'},
              ],
            },
          },
        ],
      }).text,
      'hello world',
    );
    expect(
      () => AsrTranscriptResponse.fromJson({'choices': []}),
      throwsFormatException,
    );
    expect(
      AsrTranscriptResponse.fromJson({
        'text': ' whisper ',
      }, apiMode: AsrApiMode.audioTranscriptions).text,
      'whisper',
    );
  });

  test('defaults missing apiMode and accepts audio_transcriptions', () {
    expect(
      AsrClientConfig.fromJson({
        'endpoint': 'https://example.test/v1',
        'apiKey': 'key',
        'model': 'whisper-1',
      }).apiMode,
      AsrApiMode.chatCompletions,
    );
    expect(
      AsrClientConfig.fromJson({
        'endpoint': 'https://example.test/v1',
        'apiKey': 'key',
        'model': 'whisper-1',
        'apiMode': 'audio_transcriptions',
      }).apiMode,
      AsrApiMode.audioTranscriptions,
    );
  });

  test('accepts active profile metadata in ASR status', () {
    final status = AsrStatus.fromJson({
      'hasApiKey': true,
      'activeProfileId': ' profile_1 ',
      'activeProfileName': ' Primary ',
      'futureDesktopField': true,
    });
    expect(status.activeProfileId, 'profile_1');
    expect(status.activeProfileName, 'Primary');
    expect(status.configured, isTrue);
  });

  test('accepts all desktop endpoint field names in precedence order', () {
    expect(
      AsrClientConfig.fromJson({
        'endpointUrl': 'https://endpoint-url.test',
        'baseUrl': 'https://base.test',
        'apiKey': 'key',
        'model': 'model',
      }).endpointUrl,
      'https://endpoint-url.test',
    );
    expect(
      AsrClientConfig.fromJson({
        'baseUrl': 'https://base.test',
        'apiKey': 'key',
        'model': 'model',
      }).endpointUrl,
      'https://base.test',
    );
  });

  test('rejects missing client secrets and malformed status', () {
    expect(
      () => AsrClientConfig.fromJson({
        'baseUrl': 'https://example.test',
        'model': 'qwen3-asr-flash',
      }),
      throwsFormatException,
    );
    expect(
      () => AsrClientConfig.fromJson({
        'baseUrl': 'https://example.test',
        'apiKey': 'key',
        'model': '  ',
      }),
      throwsFormatException,
    );
    expect(
      AsrStatus.fromJson({
        'hasApiKey': true,
        'apiKeyEncryptionAvailable': true,
        'model': 'custom-asr-model',
      }).configured,
      isTrue,
    );
    expect(
      AsrStatus.fromJson({
        'hasApiKey': true,
        'apiKeyEncryptionAvailable': true,
        'model': ' custom-asr-model ',
      }).model,
      'custom-asr-model',
    );
    expect(
      () => AsrStatus.fromJson({'hasApiKey': 'yes'}),
      throwsFormatException,
    );
  });

  test('builds the non-streaming input_audio request body', () {
    // Official Qwen ASR docs Data URL base64 sample prefix.
    const officialBase64 =
        'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//PAxABQ/BXRbMPe4IQAhl9';
    const audioDataUrl = 'data:audio/wav;base64,$officialBase64';
    const config = AsrClientConfig(
      endpointUrl: 'https://example.test',
      apiKey: 'secret',
      model: 'custom-asr-model',
      systemPrompt: 'Transcribe only.',
    );
    final body = buildAsrRequestBody(
      config: config,
      audioDataUrl: audioDataUrl,
    );
    expect(body['model'], 'custom-asr-model');
    expect(body['stream'], isFalse);
    expect(body['asr_options'], {'enable_itn': false});
    expect(body['messages'], [
      {
        'role': 'system',
        'content': [
          {'text': 'Transcribe only.'},
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
    ]);

    final withoutPrompt = buildAsrRequestBody(
      config: const AsrClientConfig(
        endpointUrl: 'https://example.test',
        apiKey: 'secret',
        model: 'qwen3-asr-flash',
      ),
      audioDataUrl: audioDataUrl,
    );
    expect(withoutPrompt['messages'], [
      {
        'role': 'user',
        'content': [
          {
            'type': 'input_audio',
            'input_audio': {'data': audioDataUrl},
          },
        ],
      },
    ]);
  });

  test('normalizes completion endpoints without duplicating the path', () {
    expect(
      normalizeAsrCompletionEndpoint(
        'https://example.test/v1/chat/completions?x=1#frag',
      ),
      'https://example.test/v1/chat/completions',
    );
    expect(
      normalizeAsrCompletionEndpoint(
        'https://example.test/v1/chat/completions/chat/completions',
      ),
      'https://example.test/v1/chat/completions',
    );
    expect(
      normalizeAsrCompletionEndpoint('https://example.test/v1/'),
      'https://example.test/v1/chat/completions',
    );
    expect(
      normalizeAsrCompletionEndpoint('https://example.test/v1'),
      'https://example.test/v1/chat/completions',
    );
    expect(
      normalizeAsrCompletionEndpoint('http://user:pass@[::1]:8080/v1?x=1#frag'),
      'http://user:pass@[::1]:8080/v1/chat/completions',
    );
    expect(
      normalizeAsrRequestEndpoint(
        'https://example.test/v1/audio/transcriptions',
        AsrApiMode.audioTranscriptions,
      ),
      'https://example.test/v1/audio/transcriptions',
    );
    expect(
      normalizeAsrRequestEndpoint(
        'https://example.test/v1/chat/completions',
        AsrApiMode.audioTranscriptions,
      ),
      'https://example.test/v1/audio/transcriptions',
    );
  });

  test('builds transcriptions FormData with optional prompt', () {
    final withPrompt = buildAsrTranscriptionsFormData(
      config: const AsrClientConfig(
        endpointUrl: 'https://example.test',
        apiKey: 'secret',
        model: 'whisper-1',
        apiMode: AsrApiMode.audioTranscriptions,
        systemPrompt: 'domain terms',
      ),
      wavBytes: Uint8List.fromList([1, 2, 3]),
    );
    expect(
      Map.fromEntries(withPrompt.fields),
      containsPair('model', 'whisper-1'),
    );
    expect(
      Map.fromEntries(withPrompt.fields),
      containsPair('prompt', 'domain terms'),
    );
    expect(withPrompt.files.single.key, 'file');
    expect(withPrompt.files.single.value.filename, 'audio.wav');

    final withoutPrompt = buildAsrTranscriptionsFormData(
      config: const AsrClientConfig(
        endpointUrl: 'https://example.test',
        apiKey: 'secret',
        model: 'whisper-1',
        apiMode: AsrApiMode.audioTranscriptions,
      ),
      wavBytes: Uint8List.fromList([1, 2, 3]),
    );
    expect(withoutPrompt.fields.any((field) => field.key == 'prompt'), isFalse);
  });

  test('requires an active profile before recording starts', () async {
    final client = _ChangingAsrEcoCenterClient()..activeProfileId = null;
    final service = MobileAsrService.withRecorder(
      recorder: _FakeMobileAsrRecorder(),
      getRpc: () => DesktopRpc(client, 'desktop_1'),
    );
    addTearDown(service.dispose);

    await expectLater(
      service.start(),
      throwsA(
        isA<AsrServiceException>().having(
          (error) => error.code,
          'code',
          'missing_profile',
        ),
      ),
    );
    expect(client.statusRequestCount, 1);
    expect(client.transcribeRequests, isEmpty);
  });

  test(
    'pins profile for one recording and refreshes it on next start',
    () async {
      final client = _ChangingAsrEcoCenterClient();
      final rpc = DesktopRpc(client, 'desktop_1');
      final recorder = _FakeMobileAsrRecorder();
      final service = MobileAsrService.withRecorder(
        recorder: recorder,
        getRpc: () => rpc,
      );
      addTearDown(service.dispose);

      await service.start();
      recorder.addPcm([1, 2, 3, 4]);
      expect(recorder.synchronouslyDeliveredChunkCount, 1);
      expect(client.transcribeRequests, isEmpty);
      client.activeProfileId = 'profile_b';
      expect(await service.stopAndTranscribe(), 'transcript-profile_a');

      expect(client.statusRequestCount, 1);
      expect(client.transcribeRequests.single['profileId'], 'profile_a');
      expect(client.transcribeDeadlines.single, 240000);
      _expectWavPayload(
        client.transcribeRequests.single['audioWavBase64'] as String,
        [1, 2, 3, 4],
      );

      await service.start();
      recorder.addPcm([5, 6, 7, 8]);
      expect(recorder.synchronouslyDeliveredChunkCount, 2);
      expect(await service.stopAndTranscribe(), 'transcript-profile_b');

      expect(client.statusRequestCount, 2);
      expect(client.transcribeRequests[1]['profileId'], 'profile_b');
      expect(client.transcribeDeadlines[1], 240000);
      _expectWavPayload(
        client.transcribeRequests[1]['audioWavBase64'] as String,
        [5, 6, 7, 8],
      );
    },
  );
}

void _expectWavPayload(String audioWavBase64, List<int> expectedPcm) {
  final wav = base64Decode(audioWavBase64);
  expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
  expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
  expect(wav.sublist(44), expectedPcm);
}

class _FakeMobileAsrRecorder implements MobileAsrRecorder {
  StreamController<Uint8List>? _audioController;
  int synchronouslyDeliveredChunkCount = 0;

  void addPcm(List<int> bytes) {
    final controller = _audioController;
    if (controller == null || !controller.hasListener) {
      throw StateError('Audio stream listener is not ready.');
    }
    controller.add(Uint8List.fromList(bytes));
    synchronouslyDeliveredChunkCount++;
  }

  @override
  Future<void> cancel() async {
    await _audioController?.close();
    _audioController = null;
  }

  @override
  Future<void> dispose() => cancel();

  @override
  Future<bool> hasPermission() async => true;

  @override
  Stream<Amplitude> onAmplitudeChanged(Duration interval) =>
      const Stream<Amplitude>.empty();

  @override
  Future<Stream<Uint8List>> startStream(RecordConfig config) async {
    _audioController = StreamController<Uint8List>(sync: true);
    return _audioController!.stream;
  }

  @override
  Future<String?> stop() async {
    await _audioController?.close();
    _audioController = null;
    return null;
  }
}

class _ChangingAsrEcoCenterClient extends EcoCenterClient {
  _ChangingAsrEcoCenterClient() : super(store: CredentialStore());

  String? activeProfileId = 'profile_a';
  int statusRequestCount = 0;
  final List<Map<String, dynamic>> transcribeRequests = [];
  final List<int?> transcribeDeadlines = [];

  @override
  Future<T> invoke<T>(
    String desktopDeviceId,
    String channel,
    List<dynamic> args, {
    int? deadlineMs,
  }) async {
    if (channel == 'asr-settings:get-status') {
      statusRequestCount++;
      return {
            'hasApiKey': true,
            'activeProfileId': activeProfileId,
            'activeProfileName': 'Active ASR',
          }
          as T;
    }
    if (channel == 'asr:transcribe') {
      final request = Map<String, dynamic>.from(args.single as Map);
      transcribeRequests.add(request);
      transcribeDeadlines.add(deadlineMs);
      return {'text': ' transcript-${request['profileId']} '} as T;
    }
    throw UnsupportedError(channel);
  }
}
