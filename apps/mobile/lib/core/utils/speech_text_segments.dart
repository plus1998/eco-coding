import 'dart:ui';

import 'package:characters/characters.dart';

enum SpeechScript { chinese, latin, neutral }

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

/// Picks one TTS language for the whole utterance so mixed text is read continuously.
///
/// Chinese voices generally handle inline English better than switching languages
/// per segment, so Chinese UI prefers a Chinese voice for typical mixed replies.
List<String> speechLanguageCandidatesForText(String text, Locale appLocale) {
  var chineseCount = 0;
  var latinCount = 0;

  for (final char in text.characters) {
    if (isChineseSpeechChar(char)) {
      chineseCount++;
    } else if (isLatinSpeechChar(char)) {
      latinCount++;
    }
  }

  if (chineseCount == 0 && latinCount == 0) {
    return _localeDefaultCandidates(appLocale);
  }

  if (appLocale.languageCode == 'zh') {
    if (chineseCount > 0) {
      return _chineseLanguageCandidates(appLocale);
    }
    return const ['en-US', 'en-GB', 'en'];
  }

  if (latinCount > 0) {
    return const ['en-US', 'en-GB', 'en'];
  }
  return _chineseLanguageCandidates(appLocale);
}

List<String> _localeDefaultCandidates(Locale appLocale) {
  if (appLocale.languageCode == 'zh') {
    return _chineseLanguageCandidates(appLocale);
  }
  return const ['en-US', 'en-GB', 'en'];
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
