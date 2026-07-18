import 'dart:async';

import 'package:flutter/widgets.dart';

import '../utils/stream_text.dart';

typedef PacedStreamTextBuilder =
    Widget Function(BuildContext context, String displayText, bool revealing);

class PacedStreamText extends StatefulWidget {
  const PacedStreamText({
    super.key,
    required this.text,
    required this.streaming,
    required this.builder,
  });

  final String text;
  final bool streaming;
  final PacedStreamTextBuilder builder;

  @override
  State<PacedStreamText> createState() => _PacedStreamTextState();
}

class _PacedStreamTextState extends State<PacedStreamText> {
  late String _displayText;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _displayText = widget.text;
  }

  @override
  void didUpdateWidget(covariant PacedStreamText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_displayText.isEmpty && widget.text.isNotEmpty) {
      _timer?.cancel();
      _timer = null;
      _displayText = widget.text;
      return;
    }
    if (!widget.text.startsWith(_displayText)) {
      _timer?.cancel();
      _timer = null;
      _displayText = widget.text;
      return;
    }
    _scheduleNextReveal();
  }

  void _scheduleNextReveal() {
    if (_timer != null || _displayText == widget.text) return;
    _timer = Timer(pacedStreamInterval, () {
      _timer = null;
      if (!mounted) return;
      final nextText = revealPacedStreamText(
        _displayText,
        widget.text,
        streaming: widget.streaming,
      );
      if (nextText != _displayText) {
        setState(() => _displayText = nextText);
      }
      _scheduleNextReveal();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return widget.builder(context, _displayText, _displayText != widget.text);
  }
}
