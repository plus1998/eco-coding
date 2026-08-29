import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import '../utils/html_fence.dart';

/// Feed card for fenced `html` blocks. Tap opens a simple in-app HTML preview.
///
/// Set [EcoHtmlBlock.useWebView] to `false` in widget tests to avoid platform
/// WebView requirements.
class EcoHtmlBlock extends StatelessWidget {
  const EcoHtmlBlock({
    super.key,
    required this.source,
    required this.cardTitleFallback,
    required this.previewTitle,
    required this.openPreviewLabel,
    required this.lineCountLabel,
  });

  final String source;
  final String cardTitleFallback;
  final String previewTitle;
  final String openPreviewLabel;
  final String Function(int count) lineCountLabel;

  static bool useWebView = true;

  String get _title => extractHtmlDocumentTitle(source) ?? cardTitleFallback;

  Future<void> _openPreview(BuildContext context) async {
    if (!EcoHtmlBlock.useWebView) return;
    final eco = ecoColors(context);
    await showDialog<void>(
      context: context,
      barrierColor: eco.bgOverlay,
      builder: (dialogContext) {
        return _HtmlPreviewDialog(
          source: source,
          title: previewTitle,
          closeLabel: dialogContext.l10n.commonClose,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final lineCount = countHtmlLines(source);

    return Semantics(
      button: true,
      label: '$openPreviewLabel: $_title',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: EcoHtmlBlock.useWebView ? () => _openPreview(context) : null,
          borderRadius: BorderRadius.circular(14),
          child: Ink(
            decoration: BoxDecoration(
              color: Color.alphaBlend(
                eco.textHeading.withValues(alpha: 0.035),
                eco.codeBg.withValues(alpha: 0.55),
              ),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: eco.textHeading.withValues(alpha: 0.08),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
              child: Row(
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: eco.textHeading.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(9),
                      child: Icon(
                        EcoIcons.network,
                        size: 18,
                        color: eco.textHeading.withValues(alpha: 0.72),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style:
                              Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: eco.textHeading,
                                  ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          lineCountLabel(lineCount),
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: eco.textMuted,
                                  ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    EcoIcons.goForward,
                    size: 16,
                    color: eco.textMuted.withValues(alpha: 0.55),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HtmlPreviewDialog extends StatefulWidget {
  const _HtmlPreviewDialog({
    required this.source,
    required this.title,
    required this.closeLabel,
  });

  final String source;
  final String title;
  final String closeLabel;

  @override
  State<_HtmlPreviewDialog> createState() => _HtmlPreviewDialogState();
}

class _HtmlPreviewDialogState extends State<_HtmlPreviewDialog> {
  WebViewController? _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.disabled)
      ..setBackgroundColor(Colors.transparent)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (_) => NavigationDecision.prevent,
          onWebResourceError: (error) {
            if (!mounted) return;
            setState(() {
              _error = error.description;
            });
          },
        ),
      );

    try {
      await controller.loadHtmlString(wrapHtmlForPreview(widget.source));
      if (!mounted) return;
      setState(() => _controller = controller);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Dialog(
      backgroundColor: eco.bgElevated,
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 900,
          maxHeight: MediaQuery.sizeOf(context).height * 0.9,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: eco.textHeading,
                          ),
                    ),
                  ),
                  IconButton(
                    tooltip: widget.closeLabel,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(EcoIcons.close, color: eco.textHeading),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: eco.cardSurface,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: eco.borderSubtle),
                  ),
                  child: _error != null
                      ? Padding(
                          padding: const EdgeInsets.all(16),
                          child: SelectableText(
                            _error!,
                            style: TextStyle(color: eco.textMuted),
                          ),
                        )
                      : _controller == null
                          ? Center(
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: eco.textMuted,
                              ),
                            )
                          : ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: WebViewWidget(controller: _controller!),
                            ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
