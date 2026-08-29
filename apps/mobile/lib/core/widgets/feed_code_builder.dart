import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;

import '../locale/app_localizations_ext.dart';
import '../theme/eco_theme.dart';
import '../utils/html_fence.dart';
import '../utils/mermaid_fence.dart';
import 'eco_html_block.dart';
import 'eco_mermaid_block.dart';

/// Routes fenced code blocks. Special languages render custom cards; plain fences
/// keep code-block styling here because [EcoMarkdown] zeroes global codeblock chrome.
class FeedCodeBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final className = element.attributes['class'];
    final source = element.textContent;
    if (source.trim().isEmpty) return null;

    if (isMermaidCodeClass(className)) {
      return EcoMermaidBlock(
        source: source,
        errorTitle: context.l10n.markdownMermaidRenderError,
      );
    }

    if (isHtmlCodeClass(className)) {
      final l10n = context.l10n;
      return EcoHtmlBlock(
        source: source,
        cardTitleFallback: l10n.markdownHtmlCardTitle,
        previewTitle: l10n.markdownHtmlPreviewTitle,
        openPreviewLabel: l10n.markdownHtmlOpenPreview,
        lineCountLabel: l10n.markdownHtmlLineCount,
      );
    }

    final eco = ecoColors(context);
    final baseStyle = Theme.of(context).textTheme.bodyMedium;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: eco.codeBg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: eco.borderSubtle),
      ),
      child: SelectableText(
        source,
        style: baseStyle?.copyWith(
          fontFamily: 'monospace',
          fontSize: (baseStyle.fontSize ?? 13) - 1,
          color: eco.accentText,
          height: 1.45,
        ),
      ),
    );
  }
}
