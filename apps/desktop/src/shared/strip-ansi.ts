// CSI / OSC / single-char ANSI escape sequences from terminal output.
const ANSI_ESCAPE_PATTERN =
  /(?:\u001B\][^\u0007]*(?:\u0007|\u001B\u005C|\u009C))|(?:\u001B[@-Z\\-_])|(?:\u001B\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}
