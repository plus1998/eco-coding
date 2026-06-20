import '../models/git_models.dart';

enum DiffLineKind { context, addition, deletion }

class DiffLine {
  const DiffLine({
    required this.kind,
    required this.content,
    this.oldLineNumber,
    this.newLineNumber,
  });

  final DiffLineKind kind;
  final String content;
  final int? oldLineNumber;
  final int? newLineNumber;
}

class DiffHunk {
  const DiffHunk({
    required this.oldStart,
    required this.oldLines,
    required this.newStart,
    required this.newLines,
    required this.lines,
  });

  final int oldStart;
  final int oldLines;
  final int newStart;
  final int newLines;
  final List<DiffLine> lines;

  int get newEnd => newStart + newLines - 1;

  int get additions =>
      lines.where((line) => line.kind == DiffLineKind.addition).length;

  int get deletions =>
      lines.where((line) => line.kind == DiffLineKind.deletion).length;

  String get rangeLabel {
    if (newLines <= 0) return '变更';
    if (newLines == 1) return '第 $newStart 行';
    return '第 $newStart-$newEnd 行';
  }
}

class ParsedDiffFile {
  const ParsedDiffFile({
    required this.path,
    required this.hunks,
  });

  final String path;
  final List<DiffHunk> hunks;

  int get additions => hunks.fold(0, (sum, hunk) => sum + hunk.additions);

  int get deletions => hunks.fold(0, (sum, hunk) => sum + hunk.deletions);

  String get fileName {
    final normalized = path.replaceAll('\\', '/');
    final segments = normalized.split('/').where((part) => part.isNotEmpty);
    final list = segments.toList();
    return list.isEmpty ? path : list.last;
  }

  String get directory {
    final normalized = path.replaceAll('\\', '/');
    final index = normalized.lastIndexOf('/');
    if (index <= 0) return '';
    return normalized.substring(0, index);
  }
}

final _hunkHeaderPattern = RegExp(
  r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',
);
final _diffGitPattern = RegExp(r'^diff --git a/(.+?) b/(.+)$');

List<ParsedDiffFile> parseUnifiedDiff(String patch) {
  if (patch.trim().isEmpty) return const [];

  ParsedDiffFile? currentFile;
  DiffHunk? currentHunk;
  final hunks = <DiffHunk>[];
  final lines = <DiffLine>[];
  var oldLine = 0;
  var newLine = 0;
  var hunkOldStart = 0;
  var hunkOldLines = 0;
  var hunkNewStart = 0;
  var hunkNewLines = 0;
  final output = <ParsedDiffFile>[];

  void flushHunk() {
    if (currentFile == null || lines.isEmpty) {
      lines.clear();
      currentHunk = null;
      return;
    }
    hunks.add(
      DiffHunk(
        oldStart: hunkOldStart,
        oldLines: hunkOldLines,
        newStart: hunkNewStart,
        newLines: hunkNewLines,
        lines: List.unmodifiable(lines),
      ),
    );
    lines.clear();
    currentHunk = null;
  }

  void flushFile() {
    flushHunk();
    if (currentFile == null) return;
    output.add(ParsedDiffFile(path: currentFile!.path, hunks: List.unmodifiable(hunks)));
    hunks.clear();
    currentFile = null;
  }

  for (final rawLine in patch.split('\n')) {
    final line = rawLine.replaceAll('\r', '');
    if (line.startsWith('diff --git ')) {
      flushFile();
      final match = _diffGitPattern.firstMatch(line);
      final path = match?.group(2) ?? match?.group(1) ?? '';
      if (path.isNotEmpty) {
        currentFile = ParsedDiffFile(path: path, hunks: const []);
      }
      continue;
    }
    if (currentFile == null) continue;

    if (line.startsWith('+++ ')) {
      final path = line.substring(4).trim();
      if (path != '/dev/null') {
        currentFile = ParsedDiffFile(
          path: path.startsWith('b/') ? path.substring(2) : path,
          hunks: const [],
        );
      }
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('index ')) {
      continue;
    }
    if (line.startsWith('@@')) {
      flushHunk();
      final match = _hunkHeaderPattern.firstMatch(line);
      if (match == null) continue;
      hunkOldStart = int.parse(match.group(1)!);
      hunkOldLines = int.parse(match.group(2) ?? '1');
      hunkNewStart = int.parse(match.group(3)!);
      hunkNewLines = int.parse(match.group(4) ?? '1');
      oldLine = hunkOldStart;
      newLine = hunkNewStart;
      currentHunk = DiffHunk(
        oldStart: hunkOldStart,
        oldLines: hunkOldLines,
        newStart: hunkNewStart,
        newLines: hunkNewLines,
        lines: const [],
      );
      continue;
    }
    if (currentHunk == null) continue;
    if (line.startsWith(r'\')) continue;

    if (line.isEmpty) {
      lines.add(
        DiffLine(
          kind: DiffLineKind.context,
          content: '',
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        ),
      );
      oldLine += 1;
      newLine += 1;
      continue;
    }

    final prefix = line[0];
    final content = line.length > 1 ? line.substring(1) : '';
    if (prefix == ' ') {
      lines.add(
        DiffLine(
          kind: DiffLineKind.context,
          content: content,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        ),
      );
      oldLine += 1;
      newLine += 1;
    } else if (prefix == '+') {
      lines.add(
        DiffLine(
          kind: DiffLineKind.addition,
          content: content,
          newLineNumber: newLine,
        ),
      );
      newLine += 1;
    } else if (prefix == '-') {
      lines.add(
        DiffLine(
          kind: DiffLineKind.deletion,
          content: content,
          oldLineNumber: oldLine,
        ),
      );
      oldLine += 1;
    }
  }

  flushFile();
  return output;
}

List<ParsedDiffFile> mergeDiffFilesWithStats({
  required String patch,
  required List<WorkspaceDiffFile> files,
}) {
  final parsed = parseUnifiedDiff(patch);
  if (parsed.isEmpty) {
    return files
        .map(
          (file) => ParsedDiffFile(path: file.path, hunks: const []),
        )
        .toList();
  }

  final byPath = {for (final file in parsed) file.path: file};
  return files
      .map(
        (file) => byPath[file.path] ?? ParsedDiffFile(path: file.path, hunks: const []),
      )
      .toList();
}
