import '../../l10n/generated/app_localizations.dart';

String formatRelativeTime(String iso, AppLocalizations l10n, [DateTime? now]) {
  final then = DateTime.tryParse(iso);
  if (then == null) return '';

  final reference = now ?? DateTime.now();
  final diffMs = reference.difference(then).inMilliseconds;
  if (diffMs < 0) return l10n.relativeTimeJustNow;

  final minutes = diffMs ~/ 60000;
  if (minutes < 1) return l10n.relativeTimeJustNow;
  if (minutes < 60) return l10n.relativeTimeMinutes(minutes);

  final hours = minutes ~/ 60;
  if (hours < 24) return l10n.relativeTimeHours(hours);

  final days = hours ~/ 24;
  if (days < 7) return l10n.relativeTimeDays(days);

  final weeks = days ~/ 7;
  if (weeks < 5) return l10n.relativeTimeWeeks(weeks);

  final months = days ~/ 30;
  if (months < 12) return l10n.relativeTimeMonths(months);

  return l10n.relativeTimeYears(days ~/ 365);
}
