import 'package:markdown/markdown.dart' as md;

bool isMermaidCodeClass(String? className) {
  if (className == null || className.isEmpty) return false;
  for (final part in className.trim().split(RegExp(r'\s+'))) {
    if (part.toLowerCase() == 'language-mermaid') return true;
  }
  return false;
}

bool isMermaidPreElement(md.Element element) {
  if (element.tag != 'pre') return false;
  for (final child in element.children ?? const <md.Node>[]) {
    if (child is md.Element && child.tag == 'code') {
      return isMermaidCodeClass(child.attributes['class']);
    }
  }
  return false;
}

String extractFencedCodeText(md.Element element) {
  final buffer = StringBuffer();
  void walk(md.Node node) {
    if (node is md.Text) {
      buffer.write(node.text);
      return;
    }
    if (node is md.Element) {
      for (final child in node.children ?? const <md.Node>[]) {
        walk(child);
      }
    }
  }

  walk(element);
  return buffer.toString();
}
