import 'package:eco_mobile/core/utils/speech_text.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mergeRecognizedSpeechText inserts at cursor', () {
    final result = mergeRecognizedSpeechText(
      currentText: 'hello',
      selection: const TextSelection.collapsed(offset: 5),
      recognizedText: 'world',
    );

    expect(result.text, 'hello world');
    expect(result.selectionOffset, result.text.length);
  });

  test('mergeRecognizedSpeechText replaces selected range', () {
    final result = mergeRecognizedSpeechText(
      currentText: 'run old command',
      selection: const TextSelection(baseOffset: 4, extentOffset: 7),
      recognizedText: 'new',
    );

    expect(result.text, 'run new command');
    expect(result.selectionOffset, 7);
  });

  test('mergeRecognizedSpeechText does not add spaces for Chinese text', () {
    final result = mergeRecognizedSpeechText(
      currentText: '检查',
      selection: const TextSelection.collapsed(offset: 2),
      recognizedText: '当前状态',
    );

    expect(result.text, '检查当前状态');
    expect(result.selectionOffset, 6);
  });
}
