enum MarkdownTableAlignment { left, right, center, none }

class MarkdownRepair {
  const MarkdownRepair({required this.id, required this.apply});

  final String id;
  final String Function(String markdown) apply;
}

class MarkdownTable {
  const MarkdownTable({
    required this.header,
    required this.separator,
    required this.rows,
  });

  final List<String> header;
  final List<MarkdownTableAlignment>? separator;
  final List<List<String>> rows;
}

class MarkdownTableBlock {
  const MarkdownTableBlock({
    required this.startLine,
    required this.endLine,
    required this.table,
  });

  final int startLine;
  final int endLine;
  final MarkdownTable table;
}

class MarkdownTableDetector {
  const MarkdownTableDetector({required this.id, required this.detect});

  final String id;
  final MarkdownTableBlock? Function(List<String> lines, int startLine) detect;
}

class MarkdownTableFixer {
  const MarkdownTableFixer({required this.id, required this.apply});

  final String id;
  final MarkdownTable Function(MarkdownTable table) apply;
}

final _fenceOpen = RegExp(r'^( {0,3})(`{3,}|~{3,})(.*)$');
final _fenceClose = RegExp(r'^( {0,3})(`{3,}|~{3,})\s*$');
final _tableSeparator = RegExp(
  r'^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$',
);

/// Pad header, separator, and body to the max column count. Extra cells are kept.
///
/// No-op when there is no separator row (that is a different repair).
final MarkdownTableFixer normalizeColumnCountFixer = MarkdownTableFixer(
  id: 'normalize-column-count',
  apply: (table) {
    final separator = table.separator;
    if (separator == null) return table;

    var width = table.header.length;
    if (separator.length > width) width = separator.length;
    if (width < 1) width = 1;
    for (final row in table.rows) {
      if (row.length > width) width = row.length;
    }

    return MarkdownTable(
      header: _padCells(table.header, width),
      separator: _padAlignments(separator, width),
      rows: [for (final row in table.rows) _padCells(row, width)],
    );
  },
);

final MarkdownTableDetector gfmHeaderSeparatorDetector = MarkdownTableDetector(
  id: 'gfm-header-separator',
  detect: (lines, startLine) {
    if (startLine + 1 >= lines.length) return null;
    final headerLine = lines[startLine];
    final separatorLine = lines[startLine + 1];
    if (_matchFenceOpen(headerLine) != null ||
        _matchFenceOpen(separatorLine) != null) {
      return null;
    }
    if (!_lineHasPipe(headerLine) || !isTableSeparator(separatorLine)) {
      return null;
    }

    var endLine = startLine + 2;
    while (endLine < lines.length) {
      final line = lines[endLine];
      if (line.trim().isEmpty) break;
      if (_matchFenceOpen(line) != null || !_lineHasPipe(line)) break;
      endLine += 1;
    }

    final header = splitTableRow(headerLine);
    final separator = _parseSeparatorAlignments(separatorLine);
    if (header.isEmpty || separator.isEmpty) return null;

    final rows = <List<String>>[
      for (var i = startLine + 2; i < endLine; i += 1) splitTableRow(lines[i]),
    ];

    return MarkdownTableBlock(
      startLine: startLine,
      endLine: endLine,
      table: MarkdownTable(header: header, separator: separator, rows: rows),
    );
  },
);

final List<MarkdownTableDetector> defaultTableDetectors = [
  gfmHeaderSeparatorDetector,
];

final List<MarkdownTableFixer> defaultTableFixers = [normalizeColumnCountFixer];

MarkdownRepair createMarkdownTableRepair({
  List<MarkdownTableDetector>? detectors,
  List<MarkdownTableFixer>? fixers,
}) {
  final resolvedDetectors = detectors ?? defaultTableDetectors;
  final resolvedFixers = fixers ?? defaultTableFixers;
  return MarkdownRepair(
    id: 'markdown-table',
    apply: (markdown) =>
        _rewriteMarkdownTables(markdown, resolvedDetectors, resolvedFixers),
  );
}

/// Default pipeline: GFM tables with a header+separator, column-count only.
///
/// Not in v1: missing separator, blockquote/list tables, unclosed pipes /
/// whitespace unless a column-count rewrite already emits canonical GFM.
final List<MarkdownRepair> defaultMarkdownRepairs = [
  createMarkdownTableRepair(),
];

String repairMarkdown(String markdown, {List<MarkdownRepair>? repairs}) {
  var text = markdown;
  for (final repair in repairs ?? defaultMarkdownRepairs) {
    text = repair.apply(text);
  }
  return text;
}

List<String> serializeMarkdownTable(MarkdownTable table) {
  final lines = <String>[_formatTableRow(table.header)];
  final separator = table.separator;
  if (separator != null) {
    lines.add(_formatSeparatorRow(separator));
  }
  for (final row in table.rows) {
    lines.add(_formatTableRow(row));
  }
  return lines;
}

List<String> splitTableRow(String line) {
  var inner = line.trim();
  if (inner.startsWith('|')) {
    inner = inner.substring(1);
  }
  if (inner.endsWith('|') && !_isEscapedPipeAt(inner, inner.length - 1)) {
    inner = inner.substring(0, inner.length - 1);
  }

  final cells = <String>[];
  final current = StringBuffer();
  var escaped = false;
  for (var i = 0; i < inner.length; i += 1) {
    final ch = inner[i];
    if (escaped) {
      current.write(ch);
      escaped = false;
      continue;
    }
    if (ch == r'\') {
      escaped = true;
      current.write(ch);
      continue;
    }
    if (ch == '|') {
      cells.add(current.toString().trim());
      current.clear();
      continue;
    }
    current.write(ch);
  }
  if (escaped) {
    current.write(r'\');
  }
  cells.add(current.toString().trim());
  return cells;
}

bool isTableSeparator(String line) {
  final trimmed = line.trim();
  if (!trimmed.contains('|') || !trimmed.contains('-')) return false;
  return _tableSeparator.hasMatch(trimmed);
}

String _rewriteMarkdownTables(
  String markdown,
  List<MarkdownTableDetector> detectors,
  List<MarkdownTableFixer> fixers,
) {
  if (markdown.isEmpty) return markdown;

  final split = _splitMarkdownLines(markdown);
  final out = <String>[];
  var i = 0;
  String? fence;

  while (i < split.lines.length) {
    final line = split.lines[i];

    if (fence != null) {
      out.add(line);
      if (_isClosingFence(line, fence)) {
        fence = null;
      }
      i += 1;
      continue;
    }

    final open = _matchFenceOpen(line);
    if (open != null) {
      fence = open;
      out.add(line);
      i += 1;
      continue;
    }

    final block = _detectTable(split.lines, i, detectors);
    if (block != null) {
      final fixed = _applyFixers(block.table, fixers);
      if (_sameTable(block.table, fixed)) {
        out.addAll(split.lines.sublist(block.startLine, block.endLine));
      } else {
        out.addAll(serializeMarkdownTable(fixed));
      }
      i = block.endLine;
      continue;
    }

    out.add(line);
    i += 1;
  }

  var result = out.join(split.newline);
  if (split.endsWithNewline) {
    result += split.newline;
  }
  return result;
}

MarkdownTableBlock? _detectTable(
  List<String> lines,
  int startLine,
  List<MarkdownTableDetector> detectors,
) {
  for (final detector in detectors) {
    final block = detector.detect(lines, startLine);
    if (block != null) return block;
  }
  return null;
}

MarkdownTable _applyFixers(
  MarkdownTable table,
  List<MarkdownTableFixer> fixers,
) {
  var current = table;
  for (final fixer in fixers) {
    current = fixer.apply(current);
  }
  return current;
}

bool _sameTable(MarkdownTable a, MarkdownTable b) {
  if (!_sameStringRow(a.header, b.header)) return false;
  if (!_sameSeparator(a.separator, b.separator)) return false;
  if (a.rows.length != b.rows.length) return false;
  for (var i = 0; i < a.rows.length; i += 1) {
    if (!_sameStringRow(a.rows[i], b.rows[i])) return false;
  }
  return true;
}

bool _sameStringRow(List<String> a, List<String> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i += 1) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

bool _sameSeparator(
  List<MarkdownTableAlignment>? a,
  List<MarkdownTableAlignment>? b,
) {
  if (a == null || b == null) return a == b;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i += 1) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

List<MarkdownTableAlignment> _parseSeparatorAlignments(String line) {
  return [for (final cell in splitTableRow(line)) _alignmentFromCell(cell)];
}

MarkdownTableAlignment _alignmentFromCell(String cell) {
  final trimmed = cell.trim();
  final left = trimmed.startsWith(':');
  final right = trimmed.endsWith(':');
  if (left && right) return MarkdownTableAlignment.center;
  if (left) return MarkdownTableAlignment.left;
  if (right) return MarkdownTableAlignment.right;
  return MarkdownTableAlignment.none;
}

String _formatTableRow(List<String> cells) => '| ${cells.join(' | ')} |';

String _formatSeparatorRow(List<MarkdownTableAlignment> alignments) {
  return '| ${alignments.map(_formatAlignmentCell).join(' | ')} |';
}

String _formatAlignmentCell(MarkdownTableAlignment alignment) {
  switch (alignment) {
    case MarkdownTableAlignment.left:
      return ':---';
    case MarkdownTableAlignment.right:
      return '---:';
    case MarkdownTableAlignment.center:
      return ':---:';
    case MarkdownTableAlignment.none:
      return '---';
  }
}

bool _lineHasPipe(String line) => line.contains('|');

bool _isEscapedPipeAt(String text, int index) {
  var slashes = 0;
  for (var i = index - 1; i >= 0 && text[i] == r'\'; i -= 1) {
    slashes += 1;
  }
  return slashes.isOdd;
}

String? _matchFenceOpen(String line) {
  return _fenceOpen.firstMatch(line)?.group(2);
}

bool _isClosingFence(String line, String openMarker) {
  final closer = _fenceClose.firstMatch(line)?.group(2);
  if (closer == null || closer.isEmpty) return false;
  return closer[0] == openMarker[0] && closer.length >= openMarker.length;
}

({List<String> lines, String newline, bool endsWithNewline})
_splitMarkdownLines(String text) {
  final newline = text.contains('\r\n')
      ? '\r\n'
      : text.contains('\r')
      ? '\r'
      : '\n';
  final endsWithNewline = text.endsWith('\n') || text.endsWith('\r');
  var body = text;
  if (endsWithNewline) {
    body = body.replaceFirst(RegExp(r'\r?\n$'), '');
    body = body.replaceFirst(RegExp(r'\r$'), '');
  }
  return (
    lines: body.split(RegExp(r'\r\n|\n|\r')),
    newline: newline,
    endsWithNewline: endsWithNewline,
  );
}

List<String> _padCells(List<String> cells, int width) {
  if (cells.length >= width) return List<String>.from(cells);
  return [...cells, ...List.filled(width - cells.length, '')];
}

List<MarkdownTableAlignment> _padAlignments(
  List<MarkdownTableAlignment> alignments,
  int width,
) {
  if (alignments.length >= width) {
    return List<MarkdownTableAlignment>.from(alignments);
  }
  return [
    ...alignments,
    ...List.filled(width - alignments.length, MarkdownTableAlignment.none),
  ];
}
