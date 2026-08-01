import 'dart:typed_data';

import 'package:eco_mobile/core/models/asr_models.dart';
import 'package:eco_mobile/features/composer/session_composer.dart';
import 'package:eco_mobile/core/platform/mobile_asr_service.dart';
import 'package:flutter_test/flutter_test.dart';

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
      }).configured,
      isTrue,
    );
    expect(
      () => AsrStatus.fromJson({'hasApiKey': 'yes'}),
      throwsFormatException,
    );
  });

  test('builds the non-streaming input_audio request body', () {
    const config = AsrClientConfig(
      endpointUrl: 'https://example.test',
      apiKey: 'secret',
      model: 'custom-asr-model',
      systemPrompt: 'Transcribe only.',
    );
    final body = buildAsrRequestBody(
      config: config,
      audioDataUrl: 'data:audio/wav;base64,AAAA',
    );
    expect(body['model'], 'custom-asr-model');
    expect(body['stream'], isFalse);
    expect(body['asr_options'], {'enable_itn': false});
    expect(body['messages'], [
      {'role': 'system', 'content': 'Transcribe only.'},
      {
        'role': 'user',
        'content': [
          {
            'type': 'input_audio',
            'input_audio': {
              'data': 'data:audio/wav;base64,AAAA',
              'format': 'wav',
            },
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
  });
}
