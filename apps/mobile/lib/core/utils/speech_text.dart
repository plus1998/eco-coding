import 'package:flutter/services.dart';

class SpeechTextMergeResult {
  const SpeechTextMergeResult({
    required this.text,
    required this.selectionOffset,
  });

  final String text;
  final int selectionOffset;
}

SpeechTextMergeResult mergeRecognizedSpeechText({
  required String currentText,
  required TextSelection selection,
  required String recognizedText,
}) {
  final recognized = recognizedText.trim();
  if (recognized.isEmpty) {
    final offset = selection.isValid
        ? selection.extentOffset
        : currentText.length;
    return SpeechTextMergeResult(text: currentText, selectionOffset: offset);
  }

  final length = currentText.length;
  final rawStart = selection.isValid
      ? selection.start.clamp(0, length).toInt()
      : length;
  final rawEnd = selection.isValid
      ? selection.end.clamp(0, length).toInt()
      : length;
  final start = rawStart < rawEnd ? rawStart : rawEnd;
  final end = rawStart < rawEnd ? rawEnd : rawStart;
  final before = currentText.substring(0, start);
  final after = currentText.substring(end);
  var insertion = recognized;

  if (_needsAsciiSpaceBetween(before, insertion)) {
    insertion = ' $insertion';
  }
  if (_needsAsciiSpaceBetween(insertion, after)) {
    insertion = '$insertion ';
  }

  return SpeechTextMergeResult(
    text: '$before$insertion$after',
    selectionOffset: before.length + insertion.length,
  );
}

bool _needsAsciiSpaceBetween(String left, String right) {
  if (left.isEmpty || right.isEmpty) {
    return false;
  }
  final leftCode = left.codeUnitAt(left.length - 1);
  final rightCode = right.codeUnitAt(0);
  return _isAsciiWord(leftCode) && _isAsciiWord(rightCode);
}

bool _isAsciiWord(int codeUnit) {
  return (codeUnit >= 48 && codeUnit <= 57) ||
      (codeUnit >= 65 && codeUnit <= 90) ||
      (codeUnit >= 97 && codeUnit <= 122);
}
