typedef SessionMode = String;

const sessionModes = ['agent', 'plan', 'ask'];

bool isSessionMode(String? value) {
  return value != null && sessionModes.contains(value);
}

SessionMode resolveSessionMode({String? sessionMode}) {
  return isSessionMode(sessionMode) ? sessionMode! : 'agent';
}

SessionMode normalizeSessionMode(String? value) {
  return isSessionMode(value) ? value! : 'agent';
}

bool isAskSessionMode({String? sessionMode}) =>
    resolveSessionMode(sessionMode: sessionMode) == 'ask';

bool isPlanSessionMode({String? sessionMode}) =>
    resolveSessionMode(sessionMode: sessionMode) == 'plan';
