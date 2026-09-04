import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:webview_flutter/webview_flutter.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import '../utils/mermaid_fence.dart';

/// Renders a Mermaid fence via local mermaid.js inside a WebView.
///
/// Set [EcoMermaidBlock.useWebView] to `false` in widget tests to avoid
/// platform WebView requirements.
class EcoMermaidBlock extends StatefulWidget {
  const EcoMermaidBlock({
    super.key,
    required this.source,
    this.errorTitle = 'Failed to render Mermaid diagram',
    this.embeddedInFence = false,
  });

  final String source;
  final String errorTitle;
  final bool embeddedInFence;

  /// When false, shows source text only (used by tests).
  static bool useWebView = true;

  @override
  State<EcoMermaidBlock> createState() => _EcoMermaidBlockState();
}

class _EcoMermaidBlockState extends State<EcoMermaidBlock> {
  WebViewController? _controller;
  double _height = 120;
  String? _error;
  bool _ready = false;
  bool _previewOpen = true;
  String? _lastTheme;
  String? _lastSource;

  @override
  void initState() {
    super.initState();
    if (EcoMermaidBlock.useWebView) {
      _initWebView();
    }
  }

  @override
  void didUpdateWidget(covariant EcoMermaidBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.source != widget.source) {
      _lastSource = null;
      _renderIfReady();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _renderIfReady();
  }

  Future<void> _initWebView() async {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..addJavaScriptChannel(
        'EcoMermaid',
        onMessageReceived: (message) {
          if (!mounted) return;
          try {
            final payload = jsonDecode(message.message) as Map<String, dynamic>;
            final ok = payload['ok'] == true;
            if (ok) {
              final height = (payload['height'] as num?)?.toDouble();
              setState(() {
                _error = null;
                if (height != null && height > 0) {
                  _height = height.clamp(48, 2400);
                }
              });
            } else {
              setState(() {
                _error = (payload['error'] as String?)?.trim().isNotEmpty == true
                    ? payload['error'] as String
                    : 'unknown error';
                _previewOpen = false;
              });
            }
          } catch (error) {
            setState(() {
              _error = error.toString();
              _previewOpen = false;
            });
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            _ready = true;
            _renderIfReady();
          },
        ),
      );

    try {
      await controller.loadFlutterAsset('assets/mermaid/host.html');
      if (!mounted) return;
      setState(() {
        _controller = controller;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _previewOpen = false;
      });
    }
  }

  String _themeKey(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark ? 'dark' : 'light';
  }

  void _renderIfReady() {
    if (!EcoMermaidBlock.useWebView || !_previewOpen) return;
    final controller = _controller;
    if (!_ready || controller == null || !mounted) return;
    final theme = _themeKey(context);
    final source = widget.source;
    if (theme == _lastTheme && source == _lastSource) return;
    _lastTheme = theme;
    _lastSource = source;
    final js = 'renderEcoMermaid(${jsonEncode(source)}, ${jsonEncode(theme)});';
    controller.runJavaScript(js);
  }

  Future<void> _openExpanded() async {
    if (!_previewOpen || _error != null || _controller == null) return;
    final theme = _themeKey(context);
    final eco = ecoColors(context);
    await showDialog<void>(
      context: context,
      barrierColor: eco.bgOverlay,
      builder: (dialogContext) {
        return _MermaidExpandDialog(
          source: widget.source,
          theme: theme,
          title: dialogContext.l10n.markdownMermaidExpand,
          closeLabel: dialogContext.l10n.commonClose,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final l10n = context.l10n;
    final showSource =
        !EcoMermaidBlock.useWebView || !_previewOpen || _error != null;
    final radius = widget.embeddedInFence ? 8.0 : 14.0;
    // Match desktop mermaid chrome: muted label + actions on a text-tinted
    // surface so light/dark both keep readable contrast (do not rely on
    // IconButtonTheme / ambient IconTheme from Markdown).
    final chromeColor = eco.textMuted.withValues(alpha: 0.78);
    final chromeDisabled = eco.textMuted.withValues(alpha: 0.32);
    final actionStyle = IconButton.styleFrom(
      foregroundColor: chromeColor,
      disabledForegroundColor: chromeDisabled,
      hoverColor: eco.navHover,
      highlightColor: eco.navHover,
      padding: EdgeInsets.zero,
      minimumSize: const Size(32, 32),
      maximumSize: const Size(32, 32),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        // Nested inside flutter_markdown codeblockDecoration when embedded —
        // keep transparent there so we don't double-tint over codeBg.
        color: widget.embeddedInFence
            ? Colors.transparent
            : eco.textHeading.withValues(alpha: 0.035),
        borderRadius: BorderRadius.circular(radius),
        border: widget.embeddedInFence
            ? null
            : Border.all(
                color: eco.textHeading.withValues(alpha: 0.08),
              ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 4, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'mermaid',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: chromeColor,
                          fontWeight: FontWeight.w400,
                          letterSpacing: 0.02,
                        ),
                  ),
                ),
                IconButton(
                  tooltip: l10n.markdownMermaidExpand,
                  style: actionStyle,
                  onPressed: showSource || _controller == null
                      ? null
                      : _openExpanded,
                  icon: Icon(
                    EcoIcons.expandFullscreen,
                    size: 16,
                    color: showSource || _controller == null
                        ? chromeDisabled
                        : chromeColor,
                  ),
                ),
                IconButton(
                  tooltip: _previewOpen
                      ? l10n.markdownMermaidClosePreview
                      : l10n.markdownMermaidOpenPreview,
                  style: actionStyle,
                  onPressed: () {
                    setState(() {
                      _previewOpen = !_previewOpen;
                      if (_previewOpen) _error = null;
                    });
                    if (_previewOpen) {
                      _lastSource = null;
                      _renderIfReady();
                    }
                  },
                  icon: Icon(
                    _previewOpen ? EcoIcons.previewOff : EcoIcons.previewOn,
                    size: 16,
                    color: chromeColor,
                  ),
                ),
              ],
            ),
          ),
          if (showSource)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null) ...[
                    Text(
                      '${widget.errorTitle}: $_error',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: eco.textMuted,
                          ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  SelectableText(
                    widget.source,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                          color: eco.textPrimary,
                        ),
                  ),
                ],
              ),
            )
          else if (_controller == null)
            SizedBox(
              height: _height,
              child: Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: chromeColor,
                  ),
                ),
              ),
            )
          else
            SizedBox(
              height: _height,
              width: double.infinity,
              child: WebViewWidget(controller: _controller!),
            ),
        ],
      ),
    );
  }
}

class _MermaidExpandDialog extends StatefulWidget {
  const _MermaidExpandDialog({
    required this.source,
    required this.theme,
    required this.title,
    required this.closeLabel,
  });

  final String source;
  final String theme;
  final String title;
  final String closeLabel;

  @override
  State<_MermaidExpandDialog> createState() => _MermaidExpandDialogState();
}

class _MermaidExpandDialogState extends State<_MermaidExpandDialog> {
  WebViewController? _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final stageBg = widget.theme == 'dark'
        ? const Color(0xFF1C1C1E)
        : const Color(0xFFFFFFFF);
    final controller = WebViewController();
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(stageBg)
      ..addJavaScriptChannel(
        'EcoMermaid',
        onMessageReceived: (message) {
          if (!mounted) return;
          try {
            final payload = jsonDecode(message.message) as Map<String, dynamic>;
            if (payload['ok'] == true) {
              setState(() => _error = null);
            } else {
              setState(() {
                _error = (payload['error'] as String?) ?? 'unknown error';
              });
            }
          } catch (error) {
            setState(() {
              _error = error.toString();
            });
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            // Zoomable: pinch/pan lives in host.html (PlatformView steals
            // InteractiveViewer gestures). Compact dialog relies on zoom.
            controller.runJavaScript(
              'renderEcoMermaid(${jsonEncode(widget.source)}, ${jsonEncode(widget.theme)}, {zoomable:true});',
            );
          },
        ),
      );

    try {
      await controller.loadFlutterAsset('assets/mermaid/host.html');
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
    final stageBg = widget.theme == 'dark'
        ? const Color(0xFF1C1C1E)
        : eco.cardSurface;
    final screen = MediaQuery.sizeOf(context);
    // Large enough to read most diagrams; pinch-zoom still available for detail.
    final dialogHeight = (screen.height * 0.88).clamp(420.0, screen.height - 48);
    return Dialog(
      backgroundColor: eco.bgElevated,
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 24),
      child: SizedBox(
        width: screen.width.clamp(0, 640),
        height: dialogHeight,
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
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                  IconButton(
                    tooltip: widget.closeLabel,
                    style: IconButton.styleFrom(
                      foregroundColor: eco.textMuted,
                      hoverColor: eco.navHover,
                      highlightColor: eco.navHover,
                    ),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(EcoIcons.close, color: eco.textMuted),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: stageBg,
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
                              child: ColoredBox(
                                color: stageBg,
                                child: WebViewWidget(controller: _controller!),
                              ),
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

/// flutter_markdown builder for fenced `code` with `language-mermaid`.
///
/// Registered on `code` (not `pre`): a custom `pre` builder leaves stale
/// `_inlines` in flutter_markdown 0.7.x when `visitText` returns null.
class MermaidCodeBuilder extends MarkdownElementBuilder {
  MermaidCodeBuilder({this.errorTitle = 'Failed to render Mermaid diagram'});

  final String errorTitle;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    if (!isMermaidCodeClass(element.attributes['class'])) return null;
    final source = element.textContent;
    if (source.trim().isEmpty) return null;
    return EcoMermaidBlock(
      source: source,
      errorTitle: errorTitle,
      embeddedInFence: true,
    );
  }
}
