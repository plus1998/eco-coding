// CSI / OSC / single-char ANSI escape sequences from terminal output.
final _ansiEscapePattern = RegExp(
  r'(?:\u001B\][^\u0007]*(?:\u0007|\u001B\\|\u009C))|(?:\u001B[@-Z\\-_])|(?:\u001B\[[0-?]*[ -/]*[@-~])',
);

String stripAnsi(String value) {
  return value.replaceAll(_ansiEscapePattern, '');
}
