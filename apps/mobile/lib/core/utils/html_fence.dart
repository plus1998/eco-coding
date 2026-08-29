import 'package:markdown/markdown.dart' as md;

bool isHtmlCodeClass(String? className) {
  if (className == null || className.isEmpty) return false;
  for (final part in className.trim().split(RegExp(r'\s+'))) {
    final token = part.toLowerCase();
    if (token == 'language-html' || token == 'language-htm') {
      return true;
    }
  }
  return false;
}

bool isHtmlPreElement(md.Element element) {
  if (element.tag != 'pre') return false;
  for (final child in element.children ?? const <md.Node>[]) {
    if (child is md.Element && child.tag == 'code') {
      return isHtmlCodeClass(child.attributes['class']);
    }
  }
  return false;
}

String? extractHtmlDocumentTitle(String html) {
  final match = RegExp(r'<title[^>]*>([^<]*)</title>', caseSensitive: false)
      .firstMatch(html);
  final title = match?.group(1)?.trim();
  if (title == null || title.isEmpty) return null;
  return title;
}

int countHtmlLines(String html) {
  if (html.isEmpty) return 0;
  return html.split(RegExp(r'\r?\n')).length;
}

String wrapHtmlForPreview(String html) {
  final trimmed = html.trim();
  if (trimmed.isEmpty) {
    return _previewHtmlDocument('<body></body>');
  }
  final lower = trimmed.toLowerCase();
  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    return _ensurePreviewViewport(trimmed);
  }
  return _previewHtmlDocument('<body>$trimmed</body>');
}

const _previewViewportMeta =
    '<meta name="viewport" content="width=device-width, initial-scale=1">';

String _previewHtmlDocument(String bodyHtml) {
  return '''
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
$_previewViewportMeta
<style>
  html, body { margin: 0; padding: 0; width: 100%; }
  body { min-height: 100%; }
  img, video, svg { max-width: 100%; height: auto; }
</style>
</head>
$bodyHtml
</html>
''';
}

String _ensurePreviewViewport(String html) {
  if (RegExp('<meta[^>]+name=[\'"]viewport[\'"]', caseSensitive: false)
      .hasMatch(html)) {
    return html;
  }
  final head = RegExp(r'<head(\s[^>]*)?>', caseSensitive: false).firstMatch(html);
  if (head != null) {
    final insertAt = head.end;
    return html.replaceRange(insertAt, insertAt, '\n$_previewViewportMeta\n');
  }
  final htmlTag = RegExp(r'<html(\s[^>]*)?>', caseSensitive: false).firstMatch(html);
  if (htmlTag != null) {
    final insertAt = htmlTag.end;
    return html.replaceRange(
      insertAt,
      insertAt,
      '\n<head>\n$_previewViewportMeta\n</head>',
    );
  }
  return html;
}
