import 'dart:ui';

import 'package:eco_mobile/core/platform/system_speech_recognizer.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('eco_mobile/system_speech_recognizer');

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('system speech locale uses BCP-47 language tags', () {
    expect(systemSpeechRecognitionLocaleTag(const Locale('en', 'US')), 'en-US');
    expect(
      systemSpeechRecognitionLocaleTag(
        const Locale.fromSubtags(
          languageCode: 'zh',
          scriptCode: 'Hans',
          countryCode: 'CN',
        ),
      ),
      'zh-Hans-CN',
    );
  });

  test('passes the selected locale to availability and recognition', () async {
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return switch (call.method) {
            'isAvailable' => true,
            'recognize' => '你好',
            _ => null,
          };
        });

    const recognizer = SystemSpeechRecognizer();
    expect(await recognizer.isAvailable(locale: 'zh-Hans-CN'), isTrue);
    expect(await recognizer.recognize(locale: 'zh-Hans-CN'), '你好');

    expect(calls, hasLength(2));
    expect(calls[0].arguments, {'locale': 'zh-Hans-CN'});
    expect(calls[1].arguments, {'locale': 'zh-Hans-CN'});
  });

  test('omits locale when the caller requests the system default', () async {
    MethodCall? receivedCall;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          receivedCall = call;
          return true;
        });

    const recognizer = SystemSpeechRecognizer();
    expect(await recognizer.isAvailable(), isTrue);
    expect(receivedCall?.arguments, isEmpty);
  });
}
