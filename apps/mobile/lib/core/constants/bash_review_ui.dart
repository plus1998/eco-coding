import '../../l10n/generated/app_localizations.dart';

class BashReviewUiOption {
  const BashReviewUiOption({
    required this.value,
    required this.title,
    required this.description,
  });

  final String value;
  final String title;
  final String description;
}

List<BashReviewUiOption> bashReviewUiOptions(AppLocalizations l10n) => [
  BashReviewUiOption(
    value: 'always',
    title: l10n.bashReviewAlways,
    description: l10n.bashReviewAlwaysDescription,
  ),
  BashReviewUiOption(
    value: 'auto',
    title: l10n.bashReviewAuto,
    description: l10n.bashReviewAutoDescription,
  ),
  BashReviewUiOption(
    value: 'allow_all',
    title: l10n.bashReviewAllowAll,
    description: l10n.bashReviewAllowAllDescription,
  ),
];

BashReviewUiOption bashReviewUi(String mode, AppLocalizations l10n) {
  return bashReviewUiOptions(l10n).firstWhere(
    (entry) => entry.value == mode,
    orElse: () => bashReviewUiOptions(l10n).first,
  );
}
