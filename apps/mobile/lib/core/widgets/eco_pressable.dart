import 'package:flutter/material.dart';

/// Instant press feedback (pointer-down), critically damped settle — Apple §1 / §4.
class EcoPressable extends StatefulWidget {
  const EcoPressable({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.enabled = true,
    this.borderRadius,
    this.scale = 0.97,
    this.haptic = false,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool enabled;
  final BorderRadius? borderRadius;
  final double scale;
  final bool haptic;

  @override
  State<EcoPressable> createState() => _EcoPressableState();
}

class _EcoPressableState extends State<EcoPressable> {
  var _pressed = false;

  bool get _interactive =>
      widget.enabled && (widget.onTap != null || widget.onLongPress != null);

  void _setPressed(bool value) {
    if (!_interactive || _pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: _interactive ? (_) => _setPressed(true) : null,
      onTap: _interactive
          ? () {
              _setPressed(false);
              widget.onTap?.call();
            }
          : null,
      onTapCancel: _interactive ? () => _setPressed(false) : null,
      onLongPress: _interactive ? widget.onLongPress : null,
      child: AnimatedScale(
        scale: _pressed ? widget.scale : 1,
        duration: Duration(milliseconds: _pressed ? 80 : 220),
        curve: _pressed ? Curves.easeOut : Curves.easeOutCubic,
        child: widget.borderRadius == null
            ? widget.child
            : ClipRRect(
                borderRadius: widget.borderRadius!,
                child: widget.child,
              ),
      ),
    );
  }
}
