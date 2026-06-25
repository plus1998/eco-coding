typedef SessionMode = String;

const sessionModes = ['agent', 'plan', 'ask'];

bool isSessionMode(String? value) {
  return value != null && sessionModes.contains(value);
}

SessionMode resolveSessionMode({
  String? sessionMode,
  bool? planModeEnabled,
}) {
  if (isSessionMode(sessionMode)) {
    return sessionMode!;
  }
  return (planModeEnabled ?? false) ? 'plan' : 'agent';
}

bool sessionModeToPlanModeEnabled(SessionMode mode) => mode == 'plan';

SessionMode syncSessionModeFromPlanToggle(bool planModeEnabled) {
  return planModeEnabled ? 'plan' : 'agent';
}

MapEntry<SessionMode, bool> syncSessionModeFields({
  String? sessionMode,
  bool? planModeEnabled,
}) {
  final mode = resolveSessionMode(
    sessionMode: sessionMode,
    planModeEnabled: planModeEnabled,
  );
  return MapEntry(mode, sessionModeToPlanModeEnabled(mode));
}
