export function matchesAnyCommandPattern(command, patterns) {
    return patterns.some((pattern) => matchesCommandPattern(command, pattern));
}
function matchesCommandPattern(command, pattern) {
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
        return false;
    }
    if (trimmedPattern.includes("*")) {
        return matchesWildcardPattern(command, trimmedPattern);
    }
    return command === trimmedPattern || command.startsWith(`${trimmedPattern} `);
}
function matchesWildcardPattern(value, pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(value);
}
