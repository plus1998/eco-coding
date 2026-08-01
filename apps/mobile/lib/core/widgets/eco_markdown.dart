import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../theme/eco_theme.dart';
import '../utils/feed_text.dart';

class EcoMarkdown extends StatelessWidget {
  const EcoMarkdown({
    super.key,
    required this.text,
    this.compact = false,
    this.muted = false,
    this.selectable = true,
    this.fontSizeScale = 1,
  });

  final String text;
  final bool compact;
  final bool muted;
  final bool selectable;
  final double fontSizeScale;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final baseColor = muted
        ? eco.textMuted.withValues(alpha: 0.85)
        : eco.textHeading;
    final baseStyle = Theme.of(context).textTheme.bodyMedium;
    final base = baseStyle?.copyWith(
      fontSize: (baseStyle.fontSize ?? 13) * fontSizeScale,
      height: compact ? 1.45 : 1.55,
      color: baseColor,
    );

    return MarkdownBody(
      data: sanitizeFeedText(text),
      selectable: selectable,
      shrinkWrap: true,
      styleSheet: MarkdownStyleSheet(
        p: base,
        h1: base?.copyWith(
          fontSize: (base.fontSize ?? 14) + (muted ? 4 : 6),
          fontWeight: FontWeight.w600,
          color: baseColor,
        ),
        h2: base?.copyWith(
          fontSize: (base.fontSize ?? 14) + (muted ? 2 : 4),
          fontWeight: FontWeight.w600,
          color: baseColor,
        ),
        h3: base?.copyWith(
          fontSize: (base.fontSize ?? 14) + (muted ? 1 : 2),
          fontWeight: FontWeight.w600,
          color: baseColor,
        ),
        h4: base?.copyWith(fontWeight: FontWeight.w600, color: baseColor),
        strong: base?.copyWith(fontWeight: FontWeight.w600, color: baseColor),
        em: base?.copyWith(fontStyle: FontStyle.italic, color: baseColor),
        blockquote: base?.copyWith(
          color: muted ? eco.textMuted : eco.textSecondary,
        ),
        listBullet: base,
        code: base?.copyWith(
          fontFamily: 'monospace',
          fontSize: (base.fontSize ?? 14) - 1,
          color: muted ? eco.textSecondary : eco.accentText,
          backgroundColor: eco.codeBg,
        ),
        codeblockDecoration: BoxDecoration(
          color: eco.codeBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: eco.borderSubtle),
        ),
        codeblockPadding: const EdgeInsets.all(12),
        blockSpacing: compact ? 8 : 12,
        listIndent: 20,
        horizontalRuleDecoration: BoxDecoration(
          border: Border(top: BorderSide(color: eco.borderSubtle)),
        ),
        a: base?.copyWith(color: muted ? eco.textSecondary : eco.accentText),
      ),
    );
  }
}
