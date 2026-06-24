import 'mcp_models.dart';

String sanitizeMcpServerName(String name) {
  final normalized = name
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9_-]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  return normalized.isEmpty ? 'mcp-server' : normalized;
}

List<String> listEnabledGlobalMcpServerKeys(List<McpServerConfigView> servers) {
  return servers
      .where((server) => server.enabled && server.name.trim().isNotEmpty)
      .map((server) => sanitizeMcpServerName(server.name))
      .toList(growable: false);
}

Map<String, bool> deriveMcpServersEnabled(
  List<String> availableServerKeys, {
  List<String> profileAssignedServers = const [],
  Map<String, bool>? existing,
  Map<String, bool>? remembered,
}) {
  final profileAssigned = profileAssignedServers
      .map(sanitizeMcpServerName)
      .toSet();
  final result = <String, bool>{};
  for (final key in availableServerKeys) {
    final sanitized = sanitizeMcpServerName(key);
    final existingValue = existing?[sanitized];
    if (existingValue is bool) {
      result[sanitized] = existingValue;
      continue;
    }
    final rememberedValue = remembered?[sanitized];
    if (rememberedValue is bool) {
      result[sanitized] = rememberedValue;
      continue;
    }
    result[sanitized] = profileAssigned.contains(sanitized);
  }
  return result;
}

List<String> resolveEnabledMcpServerKeys(Map<String, bool> settings) {
  return settings.entries
      .where((entry) => entry.value)
      .map((entry) => entry.key)
      .toList(growable: false);
}

int countEnabledMcpServers(Map<String, bool> settings) {
  return settings.values.where((enabled) => enabled).length;
}

Map<String, bool>? normalizeMcpServersEnabled(Map<String, dynamic>? input) {
  if (input == null || input.isEmpty) return null;
  final result = <String, bool>{};
  for (final entry in input.entries) {
    final key = entry.key.trim();
    final value = entry.value;
    if (key.isNotEmpty && value is bool) {
      result[sanitizeMcpServerName(key)] = value;
    }
  }
  return result.isEmpty ? null : result;
}
