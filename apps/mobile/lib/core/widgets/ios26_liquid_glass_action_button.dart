import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Large iOS 26 Liquid Glass action button backed by a native UIButton.
class IOS26LiquidGlassActionButton extends StatefulWidget {
  const IOS26LiquidGlassActionButton({
    super.key,
    required this.label,
    required this.sfSymbol,
    required this.foregroundColor,
    this.onPressed,
    this.height = 64,
  });

  final String label;
  final String sfSymbol;
  final Color foregroundColor;
  final VoidCallback? onPressed;
  final double height;

  @override
  State<IOS26LiquidGlassActionButton> createState() =>
      _IOS26LiquidGlassActionButtonState();
}

class _IOS26LiquidGlassActionButtonState
    extends State<IOS26LiquidGlassActionButton> {
  static int _nextId = 0;

  late final int _id;
  late final MethodChannel _channel;
  bool? _lastIsDark;

  @override
  void initState() {
    super.initState();
    _id = _nextId++;
    _channel = MethodChannel('eco_mobile/liquid_glass_action_button_$_id');
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncBrightnessIfNeeded();
  }

  @override
  void didUpdateWidget(covariant IOS26LiquidGlassActionButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.onPressed != widget.onPressed) {
      _channel.invokeMethod('setEnabled', {
        'enabled': widget.onPressed != null,
      });
    }
    if (oldWidget.foregroundColor != widget.foregroundColor) {
      _channel.invokeMethod('setColor', {
        'color': _colorToArgb(widget.foregroundColor),
      });
    }
  }

  @override
  void dispose() {
    _channel.setMethodCallHandler(null);
    super.dispose();
  }

  Future<void> _syncBrightnessIfNeeded() async {
    final isDark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    if (_lastIsDark == isDark) return;
    try {
      await _channel.invokeMethod('setBrightness', {'isDark': isDark});
      _lastIsDark = isDark;
    } catch (_) {
      // The native view may not be attached during the first build.
    }
  }

  Future<dynamic> _handleMethodCall(MethodCall call) async {
    if (call.method == 'pressed' && widget.onPressed != null) {
      widget.onPressed!();
    }
  }

  Map<String, dynamic> _creationParams() {
    return {
      'id': _id,
      'label': widget.label,
      'sfSymbol': widget.sfSymbol,
      'enabled': widget.onPressed != null,
      'isDark': MediaQuery.platformBrightnessOf(context) == Brightness.dark,
      'foregroundColor': _colorToArgb(widget.foregroundColor),
    };
  }

  int _colorToArgb(Color color) {
    return (((color.a * 255).round() & 0xFF) << 24) |
        (((color.r * 255).round() & 0xFF) << 16) |
        (((color.g * 255).round() & 0xFF) << 8) |
        ((color.b * 255).round() & 0xFF);
  }

  @override
  Widget build(BuildContext context) {
    if (!kIsWeb && Platform.isIOS) {
      return SizedBox(
        height: widget.height,
        child: UiKitView(
          viewType: 'eco_mobile/liquid_glass_action_button',
          creationParams: _creationParams(),
          creationParamsCodec: const StandardMessageCodec(),
        ),
      );
    }

    return SizedBox(
      height: widget.height,
      child: CupertinoButton(
        onPressed: widget.onPressed,
        padding: EdgeInsets.zero,
        borderRadius: BorderRadius.circular(widget.height / 2),
        color: CupertinoColors.tertiarySystemFill,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              widget.sfSymbol == 'arrow.right.circle'
                  ? CupertinoIcons.arrow_right_circle
                  : CupertinoIcons.qrcode,
              size: 22,
              color: widget.foregroundColor,
            ),
            const SizedBox(height: 3),
            Text(
              widget.label,
              style: TextStyle(
                color: widget.foregroundColor,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
