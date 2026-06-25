export type AntiBypassMatch = {
  reason: string;
  matchedRule: string;
};

/** Invisible / format characters sometimes used to evade naive command parsers. */
const ZERO_WIDTH_CHAR = /[\u200b-\u200d\u2060\ufeff\u00ad]/u;

/** Zsh hash-command form (=program runs command by name lookup). */
const ZSH_EQUALS_COMMAND = /(?:^|[|&;]\s*)=[A-Za-z_][A-Za-z0-9_]*/u;

/** Heredoc delimiter without quotes or command substitution in the opener. */
const UNQUOTED_HEREDOC = /<<-?\s*(?!['"])(?:\$|[A-Za-z_])/u;

export function matchBashAntiBypass(command: string): AntiBypassMatch | null {
  if (command.includes("\r")) {
    return {
      reason: "Command contains carriage return (\\r), which may bypass shell parsers",
      matchedRule: "anti_bypass_carriage_return",
    };
  }

  if (ZERO_WIDTH_CHAR.test(command)) {
    return {
      reason: "Command contains zero-width or invisible characters",
      matchedRule: "anti_bypass_zero_width",
    };
  }

  if (ZSH_EQUALS_COMMAND.test(command)) {
    return {
      reason: "Zsh-style =command hash lookup is not allowed",
      matchedRule: "anti_bypass_zsh_equals_cmd",
    };
  }

  if (UNQUOTED_HEREDOC.test(command)) {
    return {
      reason: "Unquoted or dynamic heredoc delimiter is not allowed",
      matchedRule: "anti_bypass_heredoc",
    };
  }

  return null;
}
