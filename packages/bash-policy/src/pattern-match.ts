export function matchesAnyCommandPattern(command: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesCommandPattern(command, pattern));
}

function matchesCommandPattern(command: string, pattern: string): boolean {
  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) {
    return false;
  }
  if (trimmedPattern.includes("*")) {
    return matchesWildcardPattern(command, trimmedPattern);
  }
  return command === trimmedPattern || command.startsWith(`${trimmedPattern} `);
}

function matchesWildcardPattern(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
