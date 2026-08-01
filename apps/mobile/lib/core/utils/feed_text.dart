final _inlineWebCitation = RegExp(
  '\u{E200}cite(?:\u{E202}[^\u{E201}]+)+\u{E201}',
);

/// Removes provider-specific rich-text citations that Flutter Markdown cannot render.
String sanitizeFeedText(String text) {
  return text.replaceAll(_inlineWebCitation, '');
}
