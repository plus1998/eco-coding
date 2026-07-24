import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'thread_session_app_bar.dart';

/// Horizontal inset for the activity feed list content.
const threadSessionFeedHorizontalPadding = 12.0;

/// Breathing room between the last feed row and the composer dock.
const threadSessionComposerGap = 28.0;

typedef ThreadSessionFeedBuilder =
    Widget Function(
      BuildContext context,
      double feedBottomInset,
      double controlsBottomInset,
    );

/// Overlay shell: feed fills the viewport; only the main composer is measured as
/// hard occlusion. Satellites above it remain transparent floating content.
///
/// Top inset is applied on the feed viewport (not inside scroll padding) so content
/// never draws under the app bar, while [extendBodyBehindAppBar] keeps the frost.
class ThreadSessionConversationLayout extends StatefulWidget {
  const ThreadSessionConversationLayout({
    super.key,
    required this.feedBuilder,
    required this.composer,
    this.floatingComposer,
    this.foreground,
  });

  final ThreadSessionFeedBuilder feedBuilder;
  final Widget composer;
  final Widget? floatingComposer;
  final Widget? foreground;

  @override
  State<ThreadSessionConversationLayout> createState() =>
      _ThreadSessionConversationLayoutState();
}

class _ThreadSessionConversationLayoutState
    extends State<ThreadSessionConversationLayout> {
  double _composerHeight = 0;
  double _floatingComposerHeight = 0;

  void _handleComposerSize(Size size) {
    if (!mounted) return;
    final nextHeight = size.height;
    if ((nextHeight - _composerHeight).abs() < 0.5) return;
    setState(() => _composerHeight = nextHeight);
  }

  void _handleFloatingComposerSize(Size size) {
    if (!mounted) return;
    final nextHeight = size.height;
    if ((nextHeight - _floatingComposerHeight).abs() < 0.5) return;
    setState(() => _floatingComposerHeight = nextHeight);
  }

  @override
  Widget build(BuildContext context) {
    final floatingComposerHeight = widget.floatingComposer == null
        ? 0.0
        : _floatingComposerHeight;
    final feedBottomInset =
        _composerHeight + floatingComposerHeight + threadSessionComposerGap;
    final controlsBottomInset = _composerHeight + floatingComposerHeight;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(
          child: Padding(
            padding: EdgeInsets.only(top: sessionContentTopPadding(context)),
            child: widget.feedBuilder(
              context,
              feedBottomInset,
              controlsBottomInset,
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.floatingComposer != null)
                _MeasureSize(
                  onChange: _handleFloatingComposerSize,
                  child: widget.floatingComposer!,
                ),
              _MeasureSize(
                onChange: _handleComposerSize,
                child: widget.composer,
              ),
            ],
          ),
        ),
        if (widget.foreground != null)
          Positioned.fill(child: widget.foreground!),
      ],
    );
  }
}

class _MeasureSize extends SingleChildRenderObjectWidget {
  const _MeasureSize({required this.onChange, required super.child});

  final ValueChanged<Size> onChange;

  @override
  RenderObject createRenderObject(BuildContext context) {
    return _MeasureSizeRenderObject(onChange);
  }

  @override
  void updateRenderObject(
    BuildContext context,
    covariant _MeasureSizeRenderObject renderObject,
  ) {
    renderObject.onChange = onChange;
  }
}

class _MeasureSizeRenderObject extends RenderProxyBox {
  _MeasureSizeRenderObject(this.onChange);

  ValueChanged<Size> onChange;
  Size? _oldSize;

  @override
  void performLayout() {
    super.performLayout();
    final nextSize = size;
    if (_oldSize == nextSize) return;
    _oldSize = nextSize;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!attached) return;
      onChange(nextSize);
    });
  }
}
