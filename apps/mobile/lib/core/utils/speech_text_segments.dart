import 'dart:ui';

import 'package:characters/characters.dart';

enum SpeechScript { chinese, latin, neutral }

class SpeechTextSegment {
  const SpeechTextSegment({
    required this.text,
    required this.script,
  });

  final String text;
  final SpeechScript script;
}

bool isChineseSpeechChar(String char) {
  if (char.isEmpty) return false;
  final code = char.runes.first;
  return (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0xF900 && code <= 0xFAFF);
}

bool isLatinSpeechChar(String char) {
  if (char.isEmpty) return false;
  final code = char.codeUnitAt(0);
  return (code >= 0x41 && code <= 0x5A) ||
      (code >= 0x61 && code <= 0x7A) ||
      (code >= 0x30 && code <= 0x39);
}

SpeechScript scriptForSpeechChar(String char) {
  if (isChineseSpeechChar(char)) return SpeechScript.chinese;
  if (isLatinSpeechChar(char)) return SpeechScript.latin;
  return SpeechScript.neutral;
}

/// Splits plain text into Chinese / Latin runs for bilingual TTS.
List<SpeechTextSegment> splitSpeechTextSegments(String text) {
  if (text.trim().isEmpty) return const [];

  final segments = <SpeechTextSegment>[];
  final buffer = StringBuffer();
  SpeechScript? current;

  void flush() {
    final value = buffer.toString();
    if (value.trim().isEmpty) {
      buffer.clear();
      return;
    }
    segments.add(
      SpeechTextSegment(
        text: value,
        script: current ?? SpeechScript.neutral,
      ),
    );
    buffer.clear();
  }

  for (final char in text.characters) {
    final script = scriptForSpeechChar(char);
    if (script == SpeechScript.neutral) {
      buffer.write(char);
      continue;
    }
    if (current != null && current != script) {
      flush();
    }
    current = script;
    buffer.write(char);
  }
  flush();

  return _mergeAdjacentSegments(segments);
}

List<SpeechTextSegment> _mergeAdjacentSegments(List<SpeechTextSegment> segments) {
  if (segments.length <= 1) return segments;

  final merged = <SpeechTextSegment>[segments.first];
  for (var index = 1; index < segments.length; index++) {
    final segment = segments[index];
    final last = merged.last;
    if (last.script == segment.script) {
      merged[merged.length - 1] = SpeechTextSegment(
        text: '${last.text}${segment.text}',
        script: last.script,
      );
    } else {
      merged.add(segment);
    }
  }
  return merged;
}

List<String> languageCandidatesForSegment(
  SpeechTextSegment segment,
  Locale appLocale,
) {
  return switch (segment.script) {
    SpeechScript.chinese => _chineseLanguageCandidates(appLocale),
    SpeechScript.latin => const ['en-US', 'en-GB', 'en'],
    SpeechScript.neutral => _neutralLanguageCandidates(appLocale),
  };
}

List<String> _chineseLanguageCandidates(Locale appLocale) {
  final candidates = <String>[];
  if (appLocale.languageCode == 'zh' &&
      appLocale.countryCode != null &&
      appLocale.countryCode!.isNotEmpty) {
    candidates.add('${appLocale.languageCode}-${appLocale.countryCode}');
  }
  candidates.addAll(const ['zh-CN', 'zh-TW', 'zh-HK', 'zh']);
  return _unique(candidates);
}

List<String> _neutralLanguageCandidates(Locale appLocale) {
  if (appLocale.languageCode == 'zh') {
    return _chineseLanguageCandidates(appLocale);
  }
  return const ['en-US', 'en-GB', 'en', 'zh-CN', 'zh'];
}

List<String> _unique(List<String> values) {
  final seen = <String>{};
  final result = <String>[];
  for (final value in values) {
    if (seen.add(value)) {
      result.add(value);
    }
  }
  return result;
}
