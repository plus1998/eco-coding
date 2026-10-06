List<String> buildRunCommand(
  String packageManager,
  String script,
  String? args,
) {
  final trimmedArgs = args?.trim();
  final tokens = trimmedArgs != null && trimmedArgs.isNotEmpty
      ? trimmedArgs
            .split(RegExp(r'\s+'))
            .where((token) => token.isNotEmpty)
            .toList()
      : <String>[];
  switch (packageManager) {
    case 'bun':
      return tokens.isNotEmpty
          ? ['bun', 'run', script, ...tokens]
          : ['bun', 'run', script];
    case 'pnpm':
      if (tokens.isEmpty) {
        return ['pnpm', 'run', script];
      }
      return tokens.first == '--'
          ? ['pnpm', 'run', script, ...tokens]
          : ['pnpm', 'run', script, '--', ...tokens];
    case 'yarn':
      if (tokens.isEmpty) {
        return ['yarn', 'run', script];
      }
      return tokens.first == '--'
          ? ['yarn', 'run', script, ...tokens]
          : ['yarn', 'run', script, '--', ...tokens];
    default:
      if (tokens.isEmpty) {
        return ['npm', 'run', script];
      }
      return tokens.first == '--'
          ? ['npm', 'run', script, ...tokens]
          : ['npm', 'run', script, '--', ...tokens];
  }
}

String formatRunCommand(
  String packageManager,
  String script,
  String? args, [
  String? prefix,
]) {
  return joinPrefixedCommand(
    prefix,
    buildRunCommand(packageManager, script, args),
  );
}

/// Join a leading shell command (nvm switch, env exports) with the argv.
String joinPrefixedCommand(String? prefix, List<String> command) {
  final normalizedPrefix = normalizeCommandPrefix(prefix);
  final body = command.join(' ');
  return normalizedPrefix.isEmpty ? body : '$normalizedPrefix && $body';
}

/// Leading command as authored by the user; a trailing connector is dropped
/// because we always insert `&&`.
String normalizeCommandPrefix(String? prefix) {
  return (prefix?.trim() ?? '')
      .replaceAll(RegExp(r'(?:&&|\|\||[;&])\s*$'), '')
      .trim();
}
