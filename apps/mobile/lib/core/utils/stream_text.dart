import 'package:characters/characters.dart';

const pacedStreamInterval = Duration(milliseconds: 40);

int resolvePacedRevealCount(int pendingCount, {required bool streaming}) {
  if (pendingCount <= 0) return 0;
  if (!streaming) {
    final third = (pendingCount / 3).ceil();
    return pendingCount < 4 ? pendingCount : (third < 4 ? 4 : third);
  }
  if (pendingCount > 96) return 8;
  if (pendingCount > 48) return 4;
  if (pendingCount > 20) return 2;
  return 1;
}

String revealPacedStreamText(
  String current,
  String target, {
  required bool streaming,
}) {
  if (current == target) return current;
  if (!target.startsWith(current)) return target;

  final pending = target.substring(current.length).characters;
  final revealCount = resolvePacedRevealCount(
    pending.length,
    streaming: streaming,
  );
  return current + pending.take(revealCount).toString();
}

/// Merges streaming text chunks (cumulative snapshots or incremental deltas).
String mergeStreamText(String previous, String incoming) {
  if (incoming.isEmpty) {
    return previous;
  }
  if (previous.isEmpty) {
    return incoming;
  }
  if (incoming == previous) {
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
  final max = [
    previous.length,
    incoming.length,
    256,
  ].reduce((left, right) => left < right ? left : right);
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
    plain = plain.replaceAllMapped(pattern, (match) => match.group(1) ?? '');
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
