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

/// Splits Summary carousel stages at explicit newlines and sentence-like
/// lower-to-upper transitions (for example `outputsRefining`).
List<String> splitThinkingCarouselLines(String text) {
  return text
      .split(RegExp(r'\r?\n'))
      .expand(
        (line) => line
            .replaceAllMapped(
              RegExp(r'([a-z0-9])([A-Z])'),
              (match) => '${match.group(1)}\n${match.group(2)}',
            )
            .split('\n'),
      )
      .map((line) => line.replaceAll(RegExp(r'[ \t]+'), ' ').trim())
      .where((line) => line.isNotEmpty)
      .toList();
}

/// Reasoning summary label. Keeps natural line breaks for carousel stages and
/// strips markdown markers like [thinkingPreviewLine] without flattening them.
/// [maxLines] only bounds pathological inputs; Summary remains ephemeral.
String reasoningSummaryLabel(String text, {int maxLines = 20}) {
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
      .replaceAll(RegExp(r'[ \t]+'), ' ')
      .trim();
  final lines = plain.split('\n');
  if (lines.length <= maxLines) {
    return plain;
  }
  return lines.sublist(lines.length - maxLines).join('\n');
}
