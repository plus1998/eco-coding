import 'package:flutter/scheduler.dart';
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

class _PacedStreamTextState extends State<PacedStreamText>
    with SingleTickerProviderStateMixin {
  late String _displayText;
  late String _targetText;
  late final Ticker _ticker;
  late Duration _lastTickTime;

  @override
  void initState() {
    super.initState();
    _targetText = widget.text;
    _displayText = _targetText;
    _lastTickTime = Duration.zero;
    _ticker = createTicker(_onTick);
    _scheduleTicker();
  }

  @override
  void didUpdateWidget(covariant PacedStreamText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_targetText != widget.text) {
      // Feed entries provide cumulative snapshots. Ignore a stale shorter
      // snapshot, but replace non-prefix repairs instead of concatenating them.
      if (!_targetText.startsWith(widget.text)) {
        _targetText = widget.text;
      }
    }
    if (!widget.streaming) {
      // 已定稿或不再是逐字目标：直接补齐全量。
      _ticker.stop();
      if (_displayText != _targetText) {
        _displayText = _targetText;
      }
      return;
    }
    _scheduleTicker();
  }

  void _onTick(Duration elapsed) {
    final delta = elapsed - _lastTickTime;
    if (delta < pacedStreamInterval) return;
    _lastTickTime = elapsed;
    final nextText = revealPacedStreamText(
      _displayText,
      _targetText,
      streaming: widget.streaming,
    );
    if (nextText != _displayText && mounted) {
      setState(() => _displayText = nextText);
    }
    if (_displayText == _targetText) {
      _ticker.stop();
    }
  }

  void _scheduleTicker() {
    if (_displayText == _targetText || _ticker.isActive) return;
    _lastTickTime = Duration.zero;
    _ticker.start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return widget.builder(context, _displayText, _displayText != _targetText);
  }
}
