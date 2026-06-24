import 'dart:convert';

import 'package:flutter/material.dart';

import '../theme/eco_theme.dart';

enum FileChangePreviewLineKind { add, remove, context }

class FileChangePreviewLine {
  const FileChangePreviewLine({required this.kind, required this.text});

  final FileChangePreviewLineKind kind;
  final String text;
}

class ThreadRunFileChangeMetadata {
  const ThreadRunFileChangeMetadata({
    required this.path,
    required this.additions,
    required this.deletions,
    required this.previewLines,
  });

  final String path;
  final int additions;
  final int deletions;
  final List<FileChangePreviewLine> previewLines;
}

/// Muted diff colors for activity file-change cards.
class FileChangeDiffPalette {
  const FileChangeDiffPalette({
    required this.addStat,
    required this.removeStat,
    required this.addGutter,
    required this.removeGutter,
    required this.addBackground,
    required this.removeBackground,
  });

  final Color addStat;
  final Color removeStat;
  final Color addGutter;
  final Color removeGutter;
  final Color addBackground;
  final Color removeBackground;

  factory FileChangeDiffPalette.of(EcoColors eco) {
    return FileChangeDiffPalette(
      addStat: eco.success.withValues(alpha: 0.58),
      removeStat: eco.danger.withValues(alpha: 0.58),
      addGutter: eco.success.withValues(alpha: 0.28),
      removeGutter: eco.danger.withValues(alpha: 0.28),
      addBackground: eco.success.withValues(alpha: 0.05),
      removeBackground: eco.danger.withValues(alpha: 0.05),
    );
  }

  Color gutterFor(FileChangePreviewLineKind kind) => switch (kind) {
        FileChangePreviewLineKind.add => addGutter,
        FileChangePreviewLineKind.remove => removeGutter,
        FileChangePreviewLineKind.context => Colors.transparent,
      };

  Color backgroundFor(FileChangePreviewLineKind kind) => switch (kind) {
        FileChangePreviewLineKind.add => addBackground,
        FileChangePreviewLineKind.remove => removeBackground,
        FileChangePreviewLineKind.context => Colors.transparent,
      };
}

class FileChangeCardDisplay {
  const FileChangeCardDisplay({
    required this.fileName,
    required this.path,
    required this.additions,
    required this.deletions,
    required this.previewLines,
  });

  final String fileName;
  final String path;
  final int additions;
  final int deletions;
  final List<FileChangePreviewLine> previewLines;
}

const _fileChangeTools = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit'};

bool isFileChangeToolName(String toolName) => _fileChangeTools.contains(toolName);

ThreadRunFileChangeMetadata? resolveFileChangeFromToolInput(
  String toolName,
  Map<String, dynamic>? input,
) {
  if (!_fileChangeTools.contains(toolName) || input == null) {
    return null;
  }

  if (toolName == 'MultiEdit') {
    final edits = input['edits'];
    if (edits is List) {
      for (final edit in edits) {
        if (edit is! Map<String, dynamic>) continue;
        final resolved = _buildEditFileChange(
          _readString(edit['file_path']) ?? _readString(edit['path']),
          _readString(edit['old_string']),
          _readString(edit['new_string']),
        );
        if (resolved != null) return resolved;
      }
    }
    return null;
  }

  final filePath = _readString(input['file_path']) ??
      _readString(input['path']) ??
      _readString(input['notebook_path']);
  if (filePath == null) return null;

  if (toolName == 'Write') {
    return _buildWriteFileChange(filePath, _readString(input['content']) ?? '');
  }

  if (toolName == 'NotebookEdit') {
    return _buildWriteFileChange(
      filePath,
      _readString(input['new_source']) ?? _readString(input['source']) ?? '',
    );
  }

  return _buildEditFileChange(
    filePath,
    _readString(input['old_string']),
    _readString(input['new_string']),
  );
}

ThreadRunFileChangeMetadata? enrichFileChangeFromToolOutput(
  ThreadRunFileChangeMetadata? existing,
  Object? output,
) {
  final record = _parseToolOutputRecord(output);
  if (record == null) return existing;

  final filePath = _readString(record['filePath']) ??
      _readString(record['file_path']) ??
      _readString(record['notebook_path']) ??
      existing?.path;
  if (filePath == null) return existing;

  final gitDiff = record['gitDiff'];
  final structuredPatch = record['structuredPatch'];
  final fromPatch = structuredPatch is List
      ? _fileChangeFromStructuredPatch(structuredPatch)
      : null;

  final additions = gitDiff is Map
      ? (gitDiff['additions'] as num?)?.toInt() ?? fromPatch?.additions ?? existing?.additions ?? 0
      : fromPatch?.additions ?? existing?.additions ?? 0;
  final deletions = gitDiff is Map
      ? (gitDiff['deletions'] as num?)?.toInt() ?? fromPatch?.deletions ?? existing?.deletions ?? 0
      : fromPatch?.deletions ?? existing?.deletions ?? 0;
  final previewLines = fromPatch != null && fromPatch.previewLines.isNotEmpty
      ? fromPatch.previewLines
      : existing?.previewLines ?? const <FileChangePreviewLine>[];

  if (previewLines.isEmpty && additions == 0 && deletions == 0) {
    return existing;
  }

  return ThreadRunFileChangeMetadata(
    path: filePath,
    additions: additions,
    deletions: deletions,
    previewLines: previewLines,
  );
}

FileChangeCardDisplay? resolveFileChangeCardDisplay(
  ThreadRunFileChangeMetadata? metadata,
) {
  if (metadata == null || metadata.previewLines.isEmpty) return null;
  final normalizedPath = metadata.path.replaceAll('\\', '/');
  final fileName = normalizedPath.split('/').last;
  return FileChangeCardDisplay(
    fileName: fileName.isEmpty ? metadata.path : fileName,
    path: metadata.path,
    additions: metadata.additions,
    deletions: metadata.deletions,
    previewLines: metadata.previewLines,
  );
}

ThreadRunFileChangeMetadata? parseThreadRunFileChangeMetadata(Object? value) {
  if (value is! Map<String, dynamic>) return null;
  final path = _readString(value['path']);
  if (path == null) return null;
  final previewLines = _parsePreviewLines(value['previewLines']);
  if (previewLines.isEmpty) return null;
  return ThreadRunFileChangeMetadata(
    path: path,
    additions: (value['additions'] as num?)?.toInt() ?? 0,
    deletions: (value['deletions'] as num?)?.toInt() ?? 0,
    previewLines: previewLines,
  );
}

ThreadRunFileChangeMetadata? _buildEditFileChange(
  String? filePath,
  String? oldString,
  String? newString,
) {
  if (filePath == null) return null;
  final oldLines = _splitContentLines(oldString ?? '');
  final newLines = _splitContentLines(newString ?? '');
  final previewLines = <FileChangePreviewLine>[
    ...oldLines.map((text) => FileChangePreviewLine(kind: FileChangePreviewLineKind.remove, text: text)),
    ...newLines.map((text) => FileChangePreviewLine(kind: FileChangePreviewLineKind.add, text: text)),
  ];
  if (previewLines.isEmpty) return null;
  return ThreadRunFileChangeMetadata(
    path: filePath,
    additions: newLines.length,
    deletions: oldLines.length,
    previewLines: previewLines,
  );
}

ThreadRunFileChangeMetadata? _buildWriteFileChange(String filePath, String content) {
  final lines = _splitContentLines(content);
  if (lines.isEmpty) return null;
  return ThreadRunFileChangeMetadata(
    path: filePath,
    additions: lines.length,
    deletions: 0,
    previewLines: lines
        .map((text) => FileChangePreviewLine(kind: FileChangePreviewLineKind.add, text: text))
        .toList(),
  );
}

class _PatchSummary {
  const _PatchSummary({
    required this.additions,
    required this.deletions,
    required this.previewLines,
  });

  final int additions;
  final int deletions;
  final List<FileChangePreviewLine> previewLines;
}

_PatchSummary _fileChangeFromStructuredPatch(List<dynamic> patch) {
  final previewLines = <FileChangePreviewLine>[];
  var additions = 0;
  var deletions = 0;

  for (final hunk in patch) {
    if (hunk is! Map) continue;
    final lines = hunk['lines'];
    if (lines is! List) continue;
    for (final rawLine in lines) {
      if (rawLine is! String || rawLine.isEmpty) continue;
      final marker = rawLine[0];
      final text = rawLine.substring(1);
      switch (marker) {
        case '+':
          additions += 1;
          previewLines.add(FileChangePreviewLine(kind: FileChangePreviewLineKind.add, text: text));
        case '-':
          deletions += 1;
          previewLines.add(FileChangePreviewLine(kind: FileChangePreviewLineKind.remove, text: text));
        case ' ':
          previewLines.add(FileChangePreviewLine(kind: FileChangePreviewLineKind.context, text: text));
      }
    }
  }

  return _PatchSummary(
    additions: additions,
    deletions: deletions,
    previewLines: previewLines,
  );
}

Map<String, dynamic>? _parseToolOutputRecord(Object? output) {
  if (output is Map<String, dynamic>) return output;
  if (output is! String) return null;
  final trimmed = output.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    final parsed = _decodeJson(trimmed);
    return parsed is Map<String, dynamic> ? parsed : null;
  } catch (_) {
    return null;
  }
}

dynamic _decodeJson(String value) => jsonDecode(value);

List<FileChangePreviewLine> _parsePreviewLines(Object? value) {
  if (value is! List) return const [];
  final lines = <FileChangePreviewLine>[];
  for (final entry in value) {
    if (entry is! Map) continue;
    final text = entry['text'];
    final kind = entry['kind'];
    if (text is! String) continue;
    final parsedKind = switch (kind) {
      'add' => FileChangePreviewLineKind.add,
      'remove' => FileChangePreviewLineKind.remove,
      'context' => FileChangePreviewLineKind.context,
      _ => null,
    };
    if (parsedKind == null) continue;
    lines.add(FileChangePreviewLine(kind: parsedKind, text: text));
  }
  return lines;
}

List<String> _splitContentLines(String content) {
  if (content.isEmpty) return const [];
  return content.replaceAll('\r\n', '\n').split('\n');
}

String? _readString(Object? value) {
  if (value is! String || value.isEmpty) return null;
  return value;
}
