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
    return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
  }
  final lower = trimmed.toLowerCase();
  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    return trimmed;
  }
  return '''
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
$trimmed
</body>
</html>
''';
}
