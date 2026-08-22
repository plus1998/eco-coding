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
    // 已有内容直接全量展示：逐字效果只作用于存活期间新到达的文本，
    // 避免重建 / 重新进入页面时把整段已有内容重放一遍。
    _targetText = widget.text;
    _displayText = _targetText;
  }

  @override
  void didUpdateWidget(covariant PacedStreamText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_targetText.startsWith(widget.text)) {
      _targetText = mergeStreamText(_targetText, widget.text);
    }
    if (!widget.streaming) {
      // 已定稿或不再是逐字目标：直接补齐全量，不做慢速追赶。
      _timer?.cancel();
      _timer = null;
      if (_displayText != _targetText) {
        setState(() => _displayText = _targetText);
      }
      return;
    }
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
