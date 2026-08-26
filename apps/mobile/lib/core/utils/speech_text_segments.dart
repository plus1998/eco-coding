import 'dart:ui';

import 'package:characters/characters.dart';

class SpeechLanguagePlan {
  const SpeechLanguagePlan({
    required this.candidates,
    required this.preferChinese,
  });

  final List<String> candidates;
  final bool preferChinese;
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

bool containsChineseSpeechText(String text) {
  for (final char in text.characters) {
    if (isChineseSpeechChar(char)) return true;
  }
  return false;
}

bool isChineseLanguageTag(String tag) {
  final lower = tag.toLowerCase();
  return lower.startsWith('zh') ||
      lower.startsWith('cmn') ||
      lower.contains('hans') ||
      lower.contains('yue');
}

/// Chooses a single TTS language plan from message content first, then app locale.
SpeechLanguagePlan planSpeechLanguage(String text, Locale appLocale) {
  var chineseCount = 0;
  var latinCount = 0;

  for (final char in text.characters) {
    if (isChineseSpeechChar(char)) {
      chineseCount++;
    } else if (isLatinSpeechChar(char)) {
      latinCount++;
    }
  }

  final preferChineseFromContent =
      chineseCount > 0 &&
      (chineseCount >= latinCount || chineseCount * 2 >= latinCount);

  if (preferChineseFromContent) {
    return SpeechLanguagePlan(
      candidates: _chineseLanguageCandidates(appLocale),
      preferChinese: true,
    );
  }

  if (latinCount > 0 && latinCount > chineseCount * 2) {
    return const SpeechLanguagePlan(
      candidates: ['en-US', 'en-GB', 'en-AU', 'en'],
      preferChinese: false,
    );
  }

  if (chineseCount > 0) {
    return SpeechLanguagePlan(
      candidates: _chineseLanguageCandidates(appLocale),
      preferChinese: true,
    );
  }

  if (appLocale.languageCode == 'zh') {
    return SpeechLanguagePlan(
      candidates: _chineseLanguageCandidates(appLocale),
      preferChinese: true,
    );
  }

  return const SpeechLanguagePlan(
    candidates: ['en-US', 'en-GB', 'en-AU', 'en'],
    preferChinese: false,
  );
}

List<String> _chineseLanguageCandidates(Locale appLocale) {
  final candidates = <String>[];
  if (appLocale.languageCode == 'zh' &&
      appLocale.countryCode != null &&
      appLocale.countryCode!.isNotEmpty) {
    candidates.add('${appLocale.languageCode}-${appLocale.countryCode}');
  }
  candidates.addAll(const [
    'zh-CN',
    'zh-Hans-CN',
    'zh-Hans',
    'cmn-CN',
    'zh-TW',
    'zh-HK',
    'zh',
  ]);
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
