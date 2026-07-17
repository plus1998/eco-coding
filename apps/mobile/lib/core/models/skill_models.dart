class SkillInfo {
  const SkillInfo({
    required this.name,
    required this.source,
    required this.skillFilePath,
    required this.layout,
    required this.sdkReady,
    this.settingsKey,
  });

  factory SkillInfo.fromJson(Map<String, dynamic> json) => SkillInfo(
    name: json['name'] as String? ?? '',
    source: json['source'] as String? ?? 'project',
    skillFilePath: json['skillFilePath'] as String? ?? '',
    settingsKey: json['settingsKey'] as String?,
    layout: json['layout'] as String? ?? 'claude',
    sdkReady: json['sdkReady'] as bool? ?? false,
  );

  String get settingsId => settingsKey ?? skillFilePath;

  final String name;
  final String source;
  final String skillFilePath;
  final String? settingsKey;
  final String layout;
  final bool sdkReady;
}

class SkillsListResult {
  const SkillsListResult({
    required this.userSkills,
    required this.projectSkills,
  });

  factory SkillsListResult.fromJson(Map<String, dynamic> json) =>
      SkillsListResult(
        userSkills: _parseSkills(json['userSkills']),
        projectSkills: _parseSkills(json['projectSkills']),
      );

  List<SkillInfo> get allSkills => [...projectSkills, ...userSkills];

  final List<SkillInfo> userSkills;
  final List<SkillInfo> projectSkills;
}

class ProjectSkillsSettingsSnapshot {
  const ProjectSkillsSettingsSnapshot({
    required this.workspacePath,
    required this.enabledByPath,
  });

  factory ProjectSkillsSettingsSnapshot.fromJson(Map<String, dynamic> json) =>
      ProjectSkillsSettingsSnapshot(
        workspacePath: json['workspacePath'] as String? ?? '',
        enabledByPath: _parseBooleanSettings(json['enabledByPath']),
      );

  Map<String, dynamic> toJson() => {
    'workspacePath': workspacePath,
    'enabledByPath': enabledByPath,
  };

  final String workspacePath;
  final Map<String, bool> enabledByPath;
}

List<SkillInfo> _parseSkills(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map<String, dynamic>>()
      .map(SkillInfo.fromJson)
      .toList(growable: false);
}

Map<String, bool> _parseBooleanSettings(Object? value) {
  if (value is! Map) return const {};
  return {
    for (final entry in value.entries)
      if (entry.key.toString().trim().isNotEmpty && entry.value is bool)
        entry.key.toString(): entry.value as bool,
  };
}
