import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;

import '../locale/app_localizations_ext.dart';
import '../utils/html_fence.dart';
import '../utils/mermaid_fence.dart';
import 'eco_html_block.dart';
import 'eco_mermaid_block.dart';

/// Routes fenced code blocks to Mermaid / HTML widgets when language matches.
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
        embeddedInFence: true,
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
        embeddedInFence: true,
      );
    }

    return null;
  }
}
