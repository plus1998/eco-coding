import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../theme/eco_theme.dart';
import '../utils/feed_text.dart';
import '../utils/markdown_repair.dart';
import 'eco_markdown_table.dart';
import 'feed_code_builder.dart';

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
    final repaired = repairMarkdown(sanitizeFeedText(text));
    final segments = splitEcoMarkdownSegments(repaired);
    if (segments.isEmpty) {
      return const SizedBox.shrink();
    }
    if (segments.length == 1 && segments.first is EcoMarkdownProseSegment) {
      return _buildProse(
        context,
        (segments.first as EcoMarkdownProseSegment).text,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final segment in segments)
          switch (segment) {
            EcoMarkdownProseSegment(:final text) => text.trim().isEmpty
                ? const SizedBox.shrink()
                : _buildProse(context, text),
            EcoMarkdownTableSegment(:final table) => EcoMarkdownTable(
                table: table,
                compact: compact,
                muted: muted,
                fontSizeScale: fontSizeScale,
              ),
          },
      ],
    );
  }

  Widget _buildProse(BuildContext context, String data) {
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
      data: data,
      selectable: selectable,
      shrinkWrap: true,
      builders: {
        'code': FeedCodeBuilder(),
      },
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
        codeblockDecoration: const BoxDecoration(),
        codeblockPadding: EdgeInsets.zero,
        // Fallback if a table leaks into prose (should be rare after split).
        tableColumnWidth: const IntrinsicColumnWidth(),
        tableHeadAlign: TextAlign.left,
        tableHead: base?.copyWith(
          fontWeight: FontWeight.w600,
          fontSize: (base.fontSize ?? 14) - 0.5,
          color: muted ? eco.textMuted : eco.textSecondary,
          height: 1.35,
        ),
        tableBody: base,
        tableBorder: TableBorder(
          top: BorderSide(color: eco.borderSubtle),
          bottom: BorderSide(color: eco.borderSubtle),
          left: BorderSide(color: eco.borderSubtle),
          right: BorderSide(color: eco.borderSubtle),
          horizontalInside: BorderSide(color: eco.borderSubtle),
          verticalInside: BorderSide(color: eco.borderSubtle),
        ),
        tableCellsPadding: const EdgeInsets.symmetric(
          horizontal: 10,
          vertical: 6,
        ),
        tablePadding: const EdgeInsets.only(bottom: 4),
        tableScrollbarThumbVisibility: true,
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
