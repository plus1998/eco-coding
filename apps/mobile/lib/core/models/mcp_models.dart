class McpServerConfigView {
  const McpServerConfigView({
    required this.id,
    required this.name,
    required this.transport,
    required this.enabled,
  });

  factory McpServerConfigView.fromJson(Map<String, dynamic> json) =>
      McpServerConfigView(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        transport: json['transport'] as String? ?? 'stdio',
        enabled: json['enabled'] as bool? ?? false,
      );

  final String id;
  final String name;
  final String transport;
  final bool enabled;
}

class McpSettingsSnapshot {
  const McpSettingsSnapshot({required this.servers});

  factory McpSettingsSnapshot.fromJson(Map<String, dynamic> json) =>
      McpSettingsSnapshot(
        servers: (json['servers'] as List<dynamic>? ?? [])
            .map(
              (entry) => McpServerConfigView.fromJson(
                entry as Map<String, dynamic>,
              ),
            )
            .toList(),
      );

  final List<McpServerConfigView> servers;
}
