import 'dart:convert';

// Auto-generated and legacy placeholders filtered from model-provided raw titles.
const _pendingThreadTitles = {
  '新任务',
  'New Task',
  '新编码任务',
};

final _titleRefusalPattern = RegExp(
  r"(?:对不起|抱歉|无法|不能|只能生成|I\s*(?:can't|cannot)|I\s*am\s*unable|unable\s+to)",
  caseSensitive: false,
);

final _titleGarbageSuffixPattern = RegExp(r'''[\]})'"]{3,}$''');

final _titlePrefixPattern = RegExp(
  r'^(?:会话)?标题\s*[:：]\s*',
  caseSensitive: false,
);

final _titleQuotePattern = RegExp(r'''^["'""''`]+|["'""''`]+$''');

String? parseThreadTitleJson(String? text) {
  final trimmed = text?.trim();
  if (trimmed == null || trimmed.isEmpty) {
    return null;
  }

  final candidates = <String>[trimmed];
  final extracted = _extractJsonObjectCandidate(trimmed);
  if (extracted != null) {
    candidates.add(extracted);
  }

  for (final candidate in candidates) {
    try {
      final parsed = jsonDecode(candidate);
      if (parsed is Map<String, dynamic> && parsed['title'] is String) {
        final title = (parsed['title'] as String).trim();
        if (title.isNotEmpty) {
          return title;
        }
      }
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

String? sanitizeThreadTitle(String? title, {String prompt = ''}) {
  final fromJson = parseThreadTitleJson(title);
  final raw = fromJson ?? title;
  final cleaned = raw
      ?.split('\n')
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .cast<String>()
      .firstOrNull
      ?.replaceFirst(_titlePrefixPattern, '')
      .replaceAll(_titleQuotePattern, '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();

  if (cleaned == null || cleaned.isEmpty) {
    return null;
  }
  if (_titleRefusalPattern.hasMatch(cleaned) ||
      _titleGarbageSuffixPattern.hasMatch(cleaned)) {
    return null;
  }
  if (prompt.isNotEmpty &&
      _normalizeTitle(cleaned) == _normalizeTitle(prompt)) {
    return null;
  }
  if (_pendingThreadTitles.contains(cleaned)) {
    return null;
  }
  return cleaned.length > 42 ? '${cleaned.substring(0, 39)}...' : cleaned;
}

String displayThreadTitle({
  required String title,
  required String prompt,
  required String fallback,
}) {
  return sanitizeThreadTitle(title, prompt: prompt) ??
      sanitizeThreadTitle(prompt) ??
      fallback;
}

String _normalizeTitle(String value) {
  return value.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
}

String? _extractJsonObjectCandidate(String text) {
  final start = text.indexOf('{');
  final end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  return text.substring(start, end + 1);
}
