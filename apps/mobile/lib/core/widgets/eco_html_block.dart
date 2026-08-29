import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
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
          initialChildSize: 0.92,
          minChildSize: 0.5,
          maxChildSize: 0.96,
          builder: (context, scrollController) {
            return _HtmlPreviewSheet(
              source: source,
              title: previewTitle,
              pageTitle: _title,
              closeLabel: sheetContext.l10n.commonClose,
              scrollController: scrollController,
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
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
    required this.scrollController,
  });

  final String source;
  final String title;
  final String pageTitle;
  final String closeLabel;
  final ScrollController scrollController;

  @override
  State<_HtmlPreviewSheet> createState() => _HtmlPreviewSheetState();
}

class _HtmlPreviewSheetState extends State<_HtmlPreviewSheet> {
  WebViewController? _controller;
  String? _error;
  bool _initStarted = false;
  double? _contentHeight;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initStarted) return;
    _initStarted = true;
    _init();
  }

  Future<void> _init() async {
    final eco = ecoColors(context);
    final controller = WebViewController();
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(eco.bgMain)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (_) => NavigationDecision.prevent,
          onPageFinished: (_) => _measureContentHeight(controller),
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

  Future<void> _measureContentHeight(WebViewController controller) async {
    try {
      await controller.runJavaScript('''
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      ''');
      final result = await controller.runJavaScriptReturningResult(
        'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)',
      );
      final measured = switch (result) {
        num value => value.toDouble(),
        String value => double.tryParse(value) ?? 0,
        _ => 0.0,
      };
      if (!mounted || measured <= 0) return;
      final minHeight = MediaQuery.sizeOf(context).height * 0.5;
      setState(() => _contentHeight = measured < minHeight ? minHeight : measured);
    } catch (_) {
      if (!mounted) return;
      setState(() => _contentHeight = MediaQuery.sizeOf(context).height * 0.75);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return SafeArea(
      top: false,
      child: ColoredBox(
        color: eco.bgMain,
        child: CustomScrollView(
          controller: widget.scrollController,
          physics: const ClampingScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(
              child: Column(
                children: [
                  SizedBox(height: 12),
                  EcoSheetGrabber(),
                ],
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
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
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
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
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: eco.textMuted),
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
            ),
            if (_error != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: SelectableText(
                    _error!,
                    style: TextStyle(color: eco.textMuted),
                  ),
                ),
              )
            else if (_controller == null || _contentHeight == null)
              const SliverFillRemaining(
                child: Center(
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else
              SliverToBoxAdapter(
                child: SizedBox(
                  height: _contentHeight,
                  width: double.infinity,
                  child: WebViewWidget(
                    controller: _controller!,
                    gestureRecognizers:
                        const <Factory<OneSequenceGestureRecognizer>>{},
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
