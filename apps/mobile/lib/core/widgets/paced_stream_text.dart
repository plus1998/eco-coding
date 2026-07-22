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
  late String _targetText;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _targetText = widget.text;
    _displayText = widget.streaming ? '' : _targetText;
    _scheduleNextReveal();
  }

  @override
  void didUpdateWidget(covariant PacedStreamText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_targetText.startsWith(widget.text)) {
      _scheduleNextReveal();
      return;
    }
    _targetText = mergeStreamText(_targetText, widget.text);
    _scheduleNextReveal();
  }

  void _scheduleNextReveal() {
    if (_timer != null || _displayText == _targetText) return;
    _timer = Timer(pacedStreamInterval, () {
      _timer = null;
      if (!mounted) return;
      final nextText = revealPacedStreamText(
        _displayText,
        _targetText,
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
    return widget.builder(context, _displayText, _displayText != _targetText);
  }
}
