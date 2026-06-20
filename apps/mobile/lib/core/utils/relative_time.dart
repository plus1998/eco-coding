String formatRelativeTime(String iso, [DateTime? now]) {
  final then = DateTime.tryParse(iso);
  if (then == null) return '';

  final reference = now ?? DateTime.now();
  final diffMs = reference.difference(then).inMilliseconds;
  if (diffMs < 0) return '刚刚';

  final minutes = diffMs ~/ 60000;
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return '$minutes 分钟';

  final hours = minutes ~/ 60;
  if (hours < 24) return '$hours 小时';

  final days = hours ~/ 24;
  if (days < 7) return '$days 天';

  final weeks = days ~/ 7;
  if (weeks < 5) return '$weeks 周';

  final months = days ~/ 30;
  if (months < 12) return '$months 月';

  return '${days ~/ 365} 年';
}
