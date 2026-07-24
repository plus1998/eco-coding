import 'session_mode.dart';
import '../../l10n/generated/app_localizations.dart';

class SessionModeUiOption {
  const SessionModeUiOption({
    required this.value,
    required this.title,
    required this.description,
  });

  final SessionMode value;
  final String title;
  final String description;
}

List<SessionModeUiOption> sessionModeUiOptions(AppLocalizations l10n) => [
  SessionModeUiOption(
    value: 'agent',
    title: 'Agent',
    description: l10n.sessionModeAgentDescription,
  ),
  SessionModeUiOption(
    value: 'plan',
    title: 'Plan',
    description: l10n.sessionModePlanDescription,
  ),
  SessionModeUiOption(
    value: 'ask',
    title: 'Ask',
    description: l10n.sessionModeAskDescription,
  ),
];

SessionModeUiOption sessionModeUi(SessionMode mode, AppLocalizations l10n) {
  return sessionModeUiOptions(l10n).firstWhere(
    (entry) => entry.value == mode,
    orElse: () => sessionModeUiOptions(l10n).first,
  );
}
