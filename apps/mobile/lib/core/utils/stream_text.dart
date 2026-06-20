/// Merges streaming text chunks (cumulative snapshots or incremental deltas).
String mergeStreamText(String previous, String incoming) {
  if (incoming.isEmpty) {
    return previous;
  }
  if (previous.isEmpty) {
    return incoming;
  }
  if (incoming == previous && incoming.length > 1) {
    return previous;
  }
  if (incoming.startsWith(previous) && incoming.length > previous.length) {
    return incoming;
  }
  if (incoming.length >= 2 && previous.endsWith(incoming)) {
    return previous;
  }

  final overlapped = _mergeWithSuffixPrefixOverlap(previous, incoming);
  if (overlapped != null) {
    return overlapped;
  }

  return '$previous$incoming';
}

String? _mergeWithSuffixPrefixOverlap(String previous, String incoming) {
  final max = [previous.length, incoming.length, 256]
      .reduce((left, right) => left < right ? left : right);
  for (var len = max; len >= 3; len--) {
    if (previous.substring(previous.length - len) ==
        incoming.substring(0, len)) {
      return previous + incoming.substring(len);
    }
  }
  return null;
}

bool shouldMergeThinkingBlocks(String previous, String next) {
  final prev = previous.trim();
  final nextTrim = next.trim();
  if (prev.isEmpty || nextTrim.isEmpty) {
    return false;
  }
  return nextTrim.startsWith(prev) || prev.startsWith(nextTrim);
}

String mergeThinkingBlocks(String previous, String next) {
  final prev = previous.trim();
  final nextTrim = next.trim();
  if (nextTrim.startsWith(prev)) {
    return nextTrim;
  }
  if (prev.startsWith(nextTrim)) {
    return prev;
  }
  return '$prev\n\n$nextTrim';
}

String thinkingPreviewLine(String text, {int max = 120}) {
  var plain = text.replaceAll(RegExp(r'```[\s\S]*?```'), ' ');
  for (final pattern in [
    RegExp(r'`([^`]+)`'),
    RegExp(r'\*\*([^*]+)\*\*'),
    RegExp(r'\*([^*]+)\*'),
  ]) {
    plain = plain.replaceAllMapped(
      pattern,
      (match) => match.group(1) ?? '',
    );
  }
  plain = plain
      .replaceAll(RegExp(r'^#+\s+', multiLine: true), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (plain.length <= max) {
    return plain;
  }
  return '${plain.substring(0, max - 1)}…';
}
