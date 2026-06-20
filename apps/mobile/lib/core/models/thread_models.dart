import 'thread_run_projection.dart';

const subagentRoles = ['explore', 'architect', 'coder', 'reviewer', 'tester'];

Map<String, bool> defaultSubagentAvailability() {
  return {for (final role in subagentRoles) role: true};
}

Map<String, bool> normalizeSubagentAvailability(
  Map<String, bool>? input,
) {
  final availability = defaultSubagentAvailability();
  if (input == null) return availability;
  for (final role in subagentRoles) {
    if (role == 'explore') {
      availability[role] = true;
      continue;
    }
    if (input.containsKey(role)) {
      availability[role] = input[role] ?? true;
    }
  }
  return availability;
}

typedef BashReviewMode = String;
const bashReviewModes = ['always', 'auto', 'allow_all'];

class ThreadRuntimeConfig {
  const ThreadRuntimeConfig({
    required this.routeProfileId,
    this.agentProfileId,
    required this.subagentEnabled,
    required this.planModeEnabled,
    required this.bashReviewMode,
  });

  factory ThreadRuntimeConfig.fromJson(Map<String, dynamic> json) {
    final rawSubagents = json['subagentEnabled'];
    Map<String, bool>? parsedSubagents;
    if (rawSubagents is Map) {
      parsedSubagents = {
        for (final role in subagentRoles)
          role: rawSubagents[role] as bool? ?? true,
      };
    }
    return ThreadRuntimeConfig(
      routeProfileId: json['routeProfileId'] as String? ?? '',
      agentProfileId: json['agentProfileId'] as String?,
      subagentEnabled: normalizeSubagentAvailability(parsedSubagents),
      planModeEnabled: json['planModeEnabled'] as bool? ?? false,
      bashReviewMode: json['bashReviewMode'] as String? ?? 'always',
    );
  }

  Map<String, dynamic> toJson() => {
        'routeProfileId': routeProfileId,
        if (agentProfileId != null) 'agentProfileId': agentProfileId,
        'subagentEnabled': subagentEnabled,
        'planModeEnabled': planModeEnabled,
        'bashReviewMode': bashReviewMode,
      };

  final String routeProfileId;
  final String? agentProfileId;
  final Map<String, bool> subagentEnabled;
  final bool planModeEnabled;
  final String bashReviewMode;
}

typedef ThreadRuntimeConfigInput = ThreadRuntimeConfig;

class WorkflowSettingsSnapshot {
  const WorkflowSettingsSnapshot({required this.planModeEnabled});

  factory WorkflowSettingsSnapshot.fromJson(Map<String, dynamic> json) =>
      WorkflowSettingsSnapshot(
        planModeEnabled: json['planModeEnabled'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {'planModeEnabled': planModeEnabled};

  final bool planModeEnabled;
}

class PromptImageAttachment {
  const PromptImageAttachment({required this.mediaType, required this.data});

  Map<String, dynamic> toJson() => {'mediaType': mediaType, 'data': data};

  final String mediaType;
  final String data;
}

typedef ThreadStatus = String;

class ThreadSummary {
  const ThreadSummary({
    required this.id,
    required this.title,
    required this.prompt,
    required this.workspacePath,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.message,
    this.runtimeConfig,
  });

  factory ThreadSummary.fromJson(Map<String, dynamic> json) => ThreadSummary(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        prompt: json['prompt'] as String? ?? '',
        workspacePath: json['workspacePath'] as String? ?? '',
        status: json['status'] as String? ?? 'idle',
        createdAt: json['createdAt'] as String? ?? '',
        updatedAt: json['updatedAt'] as String? ?? '',
        message: json['message'] as String? ?? '',
        runtimeConfig: json['runtimeConfig'] != null
            ? ThreadRuntimeConfig.fromJson(
                json['runtimeConfig'] as Map<String, dynamic>,
              )
            : null,
      );

  final String id;
  final String title;
  final String prompt;
  final String workspacePath;
  final String status;
  final String createdAt;
  final String updatedAt;
  final String message;
  final ThreadRuntimeConfig? runtimeConfig;
}

class ThreadActivityLine {
  const ThreadActivityLine({
    required this.id,
    required this.role,
    required this.message,
    this.stream,
  });

  factory ThreadActivityLine.fromJson(Map<String, dynamic> json) =>
      ThreadActivityLine(
        id: json['id'] as String? ?? '',
        role: json['role'] as String? ?? 'assistant',
        message: json['message'] as String? ?? '',
        stream: json['stream'] as bool?,
      );

  final String id;
  final String role;
  final String message;
  final bool? stream;
}

class ThreadPendingPlan {
  const ThreadPendingPlan({
    required this.threadId,
    required this.userPrompt,
    required this.analysis,
    required this.plan,
    required this.workspacePath,
    required this.worktreePath,
    this.planFilePath,
  });

  factory ThreadPendingPlan.fromJson(Map<String, dynamic> json) =>
      ThreadPendingPlan(
        threadId: json['threadId'] as String? ?? '',
        userPrompt: json['userPrompt'] as String? ?? '',
        analysis: json['analysis'] as String? ?? '',
        plan: json['plan'] as String? ?? '',
        workspacePath: json['workspacePath'] as String? ?? '',
        worktreePath: json['worktreePath'] as String? ?? '',
        planFilePath: json['planFilePath'] as String?,
      );

  final String threadId;
  final String userPrompt;
  final String analysis;
  final String plan;
  final String workspacePath;
  final String worktreePath;
  final String? planFilePath;
}

class ClarificationQuestionOption {
  const ClarificationQuestionOption({required this.label, this.recommended});

  factory ClarificationQuestionOption.fromJson(Map<String, dynamic> json) =>
      ClarificationQuestionOption(
        label: json['label'] as String? ?? '',
        recommended: json['recommended'] as bool?,
      );

  final String label;
  final bool? recommended;
}

class ClarificationQuestion {
  const ClarificationQuestion({
    required this.question,
    this.header,
    required this.options,
    this.multiSelect,
  });

  factory ClarificationQuestion.fromJson(Map<String, dynamic> json) =>
      ClarificationQuestion(
        question: json['question'] as String? ?? '',
        header: json['header'] as String?,
        options: (json['options'] as List<dynamic>? ?? [])
            .map((e) => ClarificationQuestionOption.fromJson(
                  e as Map<String, dynamic>,
                ))
            .toList(),
        multiSelect: json['multiSelect'] as bool?,
      );

  final String question;
  final String? header;
  final List<ClarificationQuestionOption> options;
  final bool? multiSelect;
}

class ClarificationRequest {
  const ClarificationRequest({
    required this.toolUseId,
    required this.threadId,
    required this.questions,
  });

  factory ClarificationRequest.fromJson(Map<String, dynamic> json) =>
      ClarificationRequest(
        toolUseId: json['toolUseId'] as String? ?? '',
        threadId: json['threadId'] as String? ?? '',
        questions: (json['questions'] as List<dynamic>? ?? [])
            .map((e) => ClarificationQuestion.fromJson(
                  e as Map<String, dynamic>,
                ))
            .toList(),
      );

  final String toolUseId;
  final String threadId;
  final List<ClarificationQuestion> questions;
}

class BashApprovalRequest {
  const BashApprovalRequest({
    required this.toolUseId,
    required this.threadId,
    required this.command,
    required this.cwd,
    required this.reason,
    required this.riskScore,
    required this.riskLevel,
    this.description,
    this.filesystemTool,
    this.filesystemPath,
  });

  factory BashApprovalRequest.fromJson(Map<String, dynamic> json) =>
      BashApprovalRequest(
        toolUseId: json['toolUseId'] as String? ?? '',
        threadId: json['threadId'] as String? ?? '',
        command: json['command'] as String? ?? '',
        cwd: json['cwd'] as String? ?? '',
        reason: json['reason'] as String? ?? '',
        riskScore: (json['riskScore'] as num?)?.toInt() ?? 0,
        riskLevel: json['riskLevel'] as String? ?? 'medium',
        description: json['description'] as String?,
        filesystemTool: json['filesystemTool'] as String?,
        filesystemPath: json['filesystemPath'] as String?,
      );

  final String toolUseId;
  final String threadId;
  final String command;
  final String cwd;
  final String reason;
  final int riskScore;
  final String riskLevel;
  final String? description;
  final String? filesystemTool;
  final String? filesystemPath;
}

class ThreadPendingFollowUp {
  const ThreadPendingFollowUp({
    required this.id,
    required this.threadId,
    required this.prompt,
    required this.status,
    required this.createdAt,
  });

  factory ThreadPendingFollowUp.fromJson(Map<String, dynamic> json) =>
      ThreadPendingFollowUp(
        id: json['id'] as String? ?? '',
        threadId: json['threadId'] as String? ?? '',
        prompt: json['prompt'] as String? ?? '',
        status: json['status'] as String? ?? 'queued',
        createdAt: json['createdAt'] as String? ?? '',
      );

  final String id;
  final String threadId;
  final String prompt;
  final String status;
  final String createdAt;
}

class ThreadLiveEvent {
  const ThreadLiveEvent({
    required this.threadId,
    required this.type,
    required this.message,
    this.role,
    this.stream,
    this.activityLine,
    this.plan,
    this.clarification,
    this.bashApproval,
    this.followUp,
    this.runtimeConfig,
    this.projection,
    this.subagentSessions,
  });

  factory ThreadLiveEvent.fromJson(Map<String, dynamic> json) {
    final projectionRaw = json['projection'];
    final sessionsRaw = json['subagentSessions'];
    return ThreadLiveEvent(
        threadId: json['threadId'] as String? ?? '',
        type: json['type'] as String? ?? '',
        message: json['message'] as String? ?? '',
        role: json['role'] as String?,
        stream: json['stream'] as bool?,
        activityLine: json['activityLine'] != null
            ? ThreadActivityLine.fromJson(
                json['activityLine'] as Map<String, dynamic>,
              )
            : null,
        plan: json['plan'] != null
            ? ThreadPendingPlan.fromJson({
                ...json['plan'] as Map<String, dynamic>,
                'threadId': json['threadId'],
              })
            : null,
        clarification: json['clarification'] != null
            ? ClarificationRequest.fromJson(
                json['clarification'] as Map<String, dynamic>,
              )
            : null,
        bashApproval: json['bashApproval'] != null
            ? BashApprovalRequest.fromJson(
                json['bashApproval'] as Map<String, dynamic>,
              )
            : null,
        followUp: json['followUp'] != null
            ? ThreadPendingFollowUp.fromJson(
                json['followUp'] as Map<String, dynamic>,
              )
            : null,
        runtimeConfig: json['runtimeConfig'] != null
            ? ThreadRuntimeConfig.fromJson(
                json['runtimeConfig'] as Map<String, dynamic>,
              )
            : null,
        projection: projectionRaw is Map<String, dynamic>
            ? ThreadRunProjectionSnapshot.fromJson(projectionRaw)
            : null,
        subagentSessions: sessionsRaw is List
            ? sessionsRaw
                .map(
                  (entry) => ThreadSubagentSessionTiming.fromJson(
                    entry as Map<String, dynamic>,
                  ),
                )
                .toList()
            : null,
      );
  }

  final String threadId;
  final String type;
  final String message;
  final String? role;
  final bool? stream;
  final ThreadActivityLine? activityLine;
  final ThreadPendingPlan? plan;
  final ClarificationRequest? clarification;
  final BashApprovalRequest? bashApproval;
  final ThreadPendingFollowUp? followUp;
  final ThreadRuntimeConfig? runtimeConfig;
  final ThreadRunProjectionSnapshot? projection;
  final List<ThreadSubagentSessionTiming>? subagentSessions;
}

class WorkspaceInfo {
  const WorkspaceInfo({
    required this.path,
    required this.name,
    required this.isGitRepository,
    this.branch,
    this.dirtyFileCount = 0,
  });

  factory WorkspaceInfo.fromJson(Map<String, dynamic> json) => WorkspaceInfo(
        path: json['path'] as String? ?? '',
        name: json['name'] as String? ?? '',
        isGitRepository: json['isGitRepository'] as bool? ?? false,
        branch: json['branch'] as String?,
        dirtyFileCount: (json['dirtyFileCount'] as num?)?.toInt() ?? 0,
      );

  final String path;
  final String name;
  final bool isGitRepository;
  final String? branch;
  final int dirtyFileCount;
}

class OrchestrationAgentInstance {
  const OrchestrationAgentInstance({
    required this.agentKey,
    required this.enabled,
  });

  factory OrchestrationAgentInstance.fromJson(Map<String, dynamic> json) =>
      OrchestrationAgentInstance(
        agentKey: json['agentKey'] as String? ?? '',
        enabled: json['enabled'] as bool? ?? false,
      );

  final String agentKey;
  final bool enabled;
}

class OrchestrationProfile {
  const OrchestrationProfile({
    required this.id,
    required this.name,
    required this.agents,
  });

  factory OrchestrationProfile.fromJson(Map<String, dynamic> json) =>
      OrchestrationProfile(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? json['id'] as String? ?? '',
        agents: (json['agents'] as List<dynamic>? ?? [])
            .map(
              (e) => OrchestrationAgentInstance.fromJson(
                e as Map<String, dynamic>,
              ),
            )
            .toList(),
      );

  final String id;
  final String name;
  final List<OrchestrationAgentInstance> agents;
}

class RouteProfileSummary {
  const RouteProfileSummary({required this.id, required this.name});

  factory RouteProfileSummary.fromJson(Map<String, dynamic> json) =>
      RouteProfileSummary(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? json['id'] as String? ?? '',
      );

  final String id;
  final String name;
}

class ModelSettingsSnapshot {
  const ModelSettingsSnapshot({
    required this.orchestrationProfiles,
    required this.routeProfiles,
  });

  factory ModelSettingsSnapshot.fromJson(Map<String, dynamic> json) =>
      ModelSettingsSnapshot(
        orchestrationProfiles:
            (json['orchestrationProfiles'] as List<dynamic>? ?? [])
                .map((e) => OrchestrationProfile.fromJson(
                      e as Map<String, dynamic>,
                    ))
                .toList(),
        routeProfiles: (json['routeProfiles'] as List<dynamic>? ?? [])
            .map((e) => RouteProfileSummary.fromJson(
                  e as Map<String, dynamic>,
                ))
            .toList(),
      );

  final List<OrchestrationProfile> orchestrationProfiles;
  final List<RouteProfileSummary> routeProfiles;
}
