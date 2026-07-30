import 'agent_orchestration.dart';

class ProjectOrchestrationSettingsSnapshot {
  const ProjectOrchestrationSettingsSnapshot({
    required this.workspacePath,
    this.orchestrationSelection,
  });

  factory ProjectOrchestrationSettingsSnapshot.fromJson(
    Map<String, dynamic> json,
  ) {
    final rawSelection = json['orchestrationSelection'];
    return ProjectOrchestrationSettingsSnapshot(
      workspacePath: json['workspacePath'] as String? ?? '',
      orchestrationSelection: rawSelection is Map<String, dynamic>
          ? OrchestrationSelection.fromJson(rawSelection)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'workspacePath': workspacePath,
    if (orchestrationSelection != null)
      'orchestrationSelection': orchestrationSelection!.toJson(),
  };

  final String workspacePath;
  final OrchestrationSelection? orchestrationSelection;
}
