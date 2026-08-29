import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import '../utils/html_fence.dart';
import 'eco_action_sheet.dart';
import 'eco_modal_sheet.dart';

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
    await showEcoModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: ecoColors(context).bgMenu,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.78,
          minChildSize: 0.4,
          maxChildSize: 0.92,
          builder: (context, scrollController) {
            return _HtmlPreviewSheet(
              source: source,
              title: previewTitle,
              pageTitle: _title,
              closeLabel: sheetContext.l10n.commonClose,
            );
          },
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
          splashColor: eco.navHover,
          highlightColor: eco.navHover.withValues(alpha: 0.65),
          child: Ink(
            decoration: BoxDecoration(
              color: eco.cardSurface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: eco.cardSurfaceBorder),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
              child: Row(
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: eco.navHover,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(9),
                      child: Icon(
                        EcoIcons.network,
                        size: 18,
                        color: eco.accentText,
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
                    color: eco.textMuted,
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

class _HtmlPreviewSheet extends StatefulWidget {
  const _HtmlPreviewSheet({
    required this.source,
    required this.title,
    required this.pageTitle,
    required this.closeLabel,
  });

  final String source;
  final String title;
  final String pageTitle;
  final String closeLabel;

  @override
  State<_HtmlPreviewSheet> createState() => _HtmlPreviewSheetState();
}

class _HtmlPreviewSheetState extends State<_HtmlPreviewSheet> {
  WebViewController? _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final eco = ecoColors(context);
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.disabled)
      ..setBackgroundColor(eco.bgMain)
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
    return SafeArea(
      top: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          const EcoSheetGrabber(),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 4, 0),
            child: Row(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.title,
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                color: eco.textHeading,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                        if (widget.pageTitle.trim().isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            widget.pageTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: eco.textMuted,
                                ),
                          ),
                        ],
                      ],
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
          const SizedBox(height: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: eco.cardSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: eco.cardSurfaceBorder),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
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
                          : WebViewWidget(controller: _controller!),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
