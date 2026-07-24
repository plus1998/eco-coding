import '../models/thread_run_projection.dart';
import '../../l10n/generated/app_localizations.dart';

int computeSubagentSessionDurationMs(
  ThreadSubagentSessionTiming timing, {
  int? nowMs,
}) {
  final now = nowMs ?? DateTime.now().millisecondsSinceEpoch;
  final lastActiveMs = DateTime.tryParse(
    timing.lastActiveAt,
  )?.millisecondsSinceEpoch;
  final activeSegmentMs = timing.isActive && lastActiveMs != null
      ? (now - lastActiveMs).clamp(0, 1 << 31)
      : 0;
  return (timing.accumulatedMs + activeSegmentMs).clamp(0, 1 << 31);
}

String formatSubagentDuration(
  int ms, {
  required bool running,
  required AppLocalizations l10n,
}) {
  if (ms <= 0) return '';
  final label = formatDurationMs(ms);
  return running ? label : l10n.subagentElapsed(label);
}

String formatDurationMs(int ms) {
  final totalSeconds = (ms / 1000).clamp(0, double.infinity);
  if (totalSeconds < 60) {
    return '${totalSeconds.toStringAsFixed(1)}s';
  }
  final minutes = totalSeconds ~/ 60;
  final seconds = (totalSeconds % 60).floor();
  if (seconds > 0) {
    return '${minutes}m ${seconds}s';
  }
  return '${minutes}m';
}

String shortSubagentAgentId(String agentId) {
  if (agentId.length <= 8) return agentId;
  return agentId.substring(agentId.length - 8);
}
