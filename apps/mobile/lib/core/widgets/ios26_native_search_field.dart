import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Native iOS system [UISearchBar] platform view.
///
/// On iOS 26+ hosts a real `UISearchBar` so system materials apply.
/// Falls back to [CupertinoSearchTextField] when the platform view path
/// is unavailable.
class IOS26NativeSearchField extends StatefulWidget {
  const IOS26NativeSearchField({
    super.key,
    this.placeholder,
    this.autofocus = false,
    this.onChanged,
    this.onSubmitted,
    /// Prefer system bar height (~56). Style first over tight chrome matching.
    this.height = 56,
  });

  final String? placeholder;
  final bool autofocus;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final double height;

  /// Hosts a real `UISearchBar` on any iOS (style comes from the system).
  static bool get isSupported => !kIsWeb && Platform.isIOS;

  @override
  State<IOS26NativeSearchField> createState() => _IOS26NativeSearchFieldState();
}

class _IOS26NativeSearchFieldState extends State<IOS26NativeSearchField> {
  static int _nextId = 0;

  late final int _id;
  late final MethodChannel _channel;
  bool? _lastIsDark;
  String? _lastPlaceholder;

  @override
  void initState() {
    super.initState();
    _id = _nextId++;
    _channel = MethodChannel('eco_mobile/ios26_search_field_$_id');
    _channel.setMethodCallHandler(_handleMethodCall);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncBrightnessIfNeeded();
  }

  @override
  void didUpdateWidget(covariant IOS26NativeSearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.placeholder != widget.placeholder) {
      _syncPlaceholderIfNeeded(force: true);
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
      // Platform view may not be attached yet.
    }
  }

  Future<void> _syncPlaceholderIfNeeded({bool force = false}) async {
    final placeholder = widget.placeholder ?? '';
    if (!force && _lastPlaceholder == placeholder) return;
    try {
      await _channel.invokeMethod('setPlaceholder', {
        'placeholder': placeholder,
      });
      _lastPlaceholder = placeholder;
    } catch (_) {
      // Platform view may not be attached yet.
    }
  }

  Future<dynamic> _handleMethodCall(MethodCall call) async {
    switch (call.method) {
      case 'onChanged':
        final text = call.arguments as String? ?? '';
        widget.onChanged?.call(text);
      case 'onSubmitted':
        final text = call.arguments as String? ?? '';
        widget.onSubmitted?.call(text);
    }
  }

  Map<String, dynamic> _creationParams() {
    return {
      'id': _id,
      'placeholder': widget.placeholder ?? '',
      'autofocus': widget.autofocus,
      'isDark': MediaQuery.platformBrightnessOf(context) == Brightness.dark,
    };
  }

  @override
  Widget build(BuildContext context) {
    if (!IOS26NativeSearchField.isSupported) {
      return SizedBox(
        height: widget.height,
        child: CupertinoSearchTextField(
          placeholder: widget.placeholder,
          autofocus: widget.autofocus,
          onChanged: widget.onChanged,
          onSubmitted: widget.onSubmitted,
        ),
      );
    }

    return SizedBox(
      height: widget.height,
      child: UiKitView(
        viewType: 'eco_mobile/ios26_search_field',
        creationParams: _creationParams(),
        creationParamsCodec: const StandardMessageCodec(),
        gestureRecognizers: const {},
      ),
    );
  }
}
