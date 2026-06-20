import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../theme/eco_theme.dart';

class EcoMarkdown extends StatelessWidget {
  const EcoMarkdown({
    super.key,
    required this.text,
    this.compact = false,
  });

  final String text;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final eco = ecoThemeExtras(context);
    final base = Theme.of(context).textTheme.bodyMedium?.copyWith(
          height: compact ? 1.45 : 1.55,
          color: EcoColors.textHeading,
        );

    return MarkdownBody(
      data: text,
      selectable: true,
      shrinkWrap: true,
      styleSheet: MarkdownStyleSheet(
        p: base,
        h1: base?.copyWith(
          fontSize: (base.fontSize ?? 14) + 6,
          fontWeight: FontWeight.w600,
        ),
        h2: base?.copyWith(
          fontSize: (base.fontSize ?? 14) + 4,
          fontWeight: FontWeight.w600,
        ),
        h3: base?.copyWith(
          fontSize: (base.fontSize ?? 14) + 2,
          fontWeight: FontWeight.w600,
        ),
        h4: base?.copyWith(fontWeight: FontWeight.w600),
        strong: base?.copyWith(fontWeight: FontWeight.w600),
        em: base?.copyWith(fontStyle: FontStyle.italic),
        blockquote: base?.copyWith(color: eco.textSecondary),
        listBullet: base,
        code: base?.copyWith(
          fontFamily: 'monospace',
          fontSize: (base.fontSize ?? 14) - 1,
          color: EcoColors.accentText,
          backgroundColor: EcoColors.codeBg,
        ),
        codeblockDecoration: BoxDecoration(
          color: EcoColors.codeBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: eco.borderSubtle),
        ),
        codeblockPadding: const EdgeInsets.all(12),
        blockSpacing: compact ? 8 : 12,
        listIndent: 20,
        horizontalRuleDecoration: BoxDecoration(
          border: Border(top: BorderSide(color: eco.borderSubtle)),
        ),
        a: base?.copyWith(color: EcoColors.accentText),
      ),
    );
  }
}
