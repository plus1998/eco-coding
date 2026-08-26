import 'feed_text.dart';

/// Placeholder spoken when a fenced code block is omitted from TTS output.
const speechCodeBlockOmitted = '代码块已省略';

final _fencedCodeBlock = RegExp(
  r'```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~',
  multiLine: true,
);
final _inlineCode = RegExp(r'`([^`]+)`');
final _markdownLink = RegExp(r'\[([^\]]+)\]\([^)]+\)');
final _markdownImage = RegExp(r'!\[([^\]]*)\]\([^)]+\)');
final _headingPrefix = RegExp(r'^#{1,6}\s+', multiLine: true);
final _blockquotePrefix = RegExp(r'^>\s?', multiLine: true);
final _listMarker = RegExp(r'^[\s]*[-*+]\s+', multiLine: true);
final _orderedListMarker = RegExp(r'^[\s]*\d+\.\s+', multiLine: true);
final _boldItalic = RegExp(r'(\*\*|__|\*|_)(.*?)\1');
final _horizontalRule = RegExp(r'^[\s]*([-*_]\s?){3,}\s*$', multiLine: true);
final _htmlTag = RegExp(r'<[^>]+>');
final _multipleBlankLines = RegExp(r'\n{3,}');

/// Converts agent markdown into plain text suitable for system TTS.
String markdownToSpeechText(String markdown, {String codeBlockOmitted = speechCodeBlockOmitted}) {
  var text = sanitizeFeedText(markdown);
  if (text.trim().isEmpty) return '';

  text = text.replaceAll(_fencedCodeBlock, ' $codeBlockOmitted ');
  text = text.replaceAll(_markdownImage, '');
  text = text.replaceAllMapped(_markdownLink, (match) => match.group(1) ?? '');
  text = text.replaceAllMapped(_inlineCode, (match) => match.group(1) ?? '');
  text = text.replaceAll(_headingPrefix, '');
  text = text.replaceAll(_blockquotePrefix, '');
  text = text.replaceAll(_listMarker, '');
  text = text.replaceAll(_orderedListMarker, '');
  text = text.replaceAll(_horizontalRule, '\n');
  text = text.replaceAll(_htmlTag, '');

  while (_boldItalic.hasMatch(text)) {
    text = text.replaceAllMapped(_boldItalic, (match) => match.group(2) ?? '');
  }

  text = text
      .split('\n')
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .join('\n');
  text = text.replaceAll(_multipleBlankLines, '\n\n');
  return text.trim();
}
