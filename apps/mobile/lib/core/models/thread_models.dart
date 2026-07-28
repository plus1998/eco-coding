import '../utils/activity_display.dart';
import '../constants/session_mode.dart';
import 'agent_orchestration.dart';
import 'composer_mcp.dart';
import 'mcp_models.dart';
import 'thread_run_projection.dart';
import 'thread_usage_models.dart';

export 'agent_orchestration.dart';

const subagentRoles = ['explore', 'architect', 'coder', 'reviewer', 'tester'];

Map<String, bool> defaultSubagentAvailability() {
  return {for (final role in subagentRoles) role: true};
}

Map<String, bool> normalizeSubagentAvailability(Map<String, bool>? input) {
  final availability = defaultSubagentAvailability();
  if (input == null) return availability;
  for (final role in subagentRoles) {
    if (input.containsKey(role)) {
      availability[role] = input[role] ?? true;
    }
  }
  return availability;
}

typedef BashReviewMode = String;
const bashReviewModes = ['always', 'auto', 'allow_all'];

const mainAgentThinkingEfforts = {
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
};

class MainAgentModelOverride {
  const MainAgentModelOverride({
    required this.providerId,
    required this.modelId,
    this.thinkingEffort,
    this.candidateModelId,
  });

  factory MainAgentModelOverride.fromJson(Map<String, dynamic> json) {
    final providerId = _requiredMainAgentOverrideString(json, 'providerId');
    final modelId = _requiredMainAgentOverrideString(json, 'modelId');
    final thinkingEffort = json.containsKey('thinkingEffort')
        ? _requiredMainAgentOverrideString(json, 'thinkingEffort')
        : null;
    if (thinkingEffort != null &&
        !mainAgentThinkingEfforts.contains(thinkingEffort)) {
      throw FormatException(
        'Invalid mainAgentModelOverride.thinkingEffort: $thinkingEffort',
      );
    }
    final candidateModelId = json.containsKey('candidateModelId')
        ? _requiredMainAgentOverrideString(json, 'candidateModelId')
        : null;
    return MainAgentModelOverride(
      providerId: providerId,
      modelId: modelId,
      thinkingEffort: thinkingEffort,
      candidateModelId: candidateModelId,
    );
  }

  Map<String, dynamic> toJson() => {
    'providerId': providerId,
    'modelId': modelId,
    if (thinkingEffort != null) 'thinkingEffort': thinkingEffort,
    if (candidateModelId != null) 'candidateModelId': candidateModelId,
  };

  final String providerId;
  final String modelId;
  final String? thinkingEffort;
  final String? candidateModelId;
}

class ThreadRuntimeConfig {
  const ThreadRuntimeConfig({
    this.orchestrationSelection,
    this.resolvedOrchestrationSnapshot,
    required this.subagentEnabled,
    this.mcpServersEnabled,
    this.skillsEnabled,
    this.mainAgentModelOverride,
    required this.sessionMode,
    required this.bashReviewMode,
  });

  factory ThreadRuntimeConfig.fromJson(Map<String, dynamic> json) {
    for (final key in const [
      'routeProfileId',
      'agentProfileId',
      'mainAgentConfigId',
      'mainPrompt',
      'subagentOrchestrationId',
      'resolvedProfileSnapshot',
    ]) {
      if (json.containsKey(key)) {
        throw FormatException('Unsupported legacy thread runtime field: $key');
      }
    }
    final rawSubagents = json['subagentEnabled'];
    Map<String, bool>? parsedSubagents;
    if (rawSubagents is Map) {
      parsedSubagents = {
        for (final role in subagentRoles)
          role: rawSubagents[role] as bool? ?? true,
      };
    }
    final rawMcp = json['mcpServersEnabled'];
    Map<String, bool>? parsedMcp;
    if (rawMcp is Map) {
      parsedMcp = normalizeMcpServersEnabled(
        rawMcp.map((key, value) => MapEntry(key.toString(), value)),
      );
    }
    final rawSkills = json['skillsEnabled'];
    Map<String, bool>? parsedSkills;
    if (rawSkills is Map) {
      parsedSkills = _normalizeBooleanSettings(rawSkills);
    }
    MainAgentModelOverride? mainAgentModelOverride;
    if (json.containsKey('mainAgentModelOverride')) {
      mainAgentModelOverride = MainAgentModelOverride.fromJson(
        _requiredJsonObject(
          json['mainAgentModelOverride'],
          'mainAgentModelOverride',
        ),
      );
    }
    OrchestrationSelection? orchestrationSelection;
    if (json.containsKey('orchestrationSelection')) {
      orchestrationSelection = OrchestrationSelection.fromJson(
        _requiredJsonObject(
          json['orchestrationSelection'],
          'orchestrationSelection',
        ),
      );
    }
    ResolvedOrchestrationSnapshot? resolvedOrchestrationSnapshot;
    if (json.containsKey('resolvedOrchestrationSnapshot')) {
      resolvedOrchestrationSnapshot = ResolvedOrchestrationSnapshot.fromJson(
        _requiredJsonObject(
          json['resolvedOrchestrationSnapshot'],
          'resolvedOrchestrationSnapshot',
        ),
      );
    }
    final sessionMode = normalizeSessionMode(json['sessionMode'] as String?);
    return ThreadRuntimeConfig(
      orchestrationSelection: orchestrationSelection,
      resolvedOrchestrationSnapshot: resolvedOrchestrationSnapshot,
      subagentEnabled: normalizeSubagentAvailability(parsedSubagents),
      mcpServersEnabled: parsedMcp,
      skillsEnabled: parsedSkills,
      mainAgentModelOverride: mainAgentModelOverride,
      sessionMode: sessionMode,
      bashReviewMode: json['bashReviewMode'] as String? ?? 'always',
    );
  }

  Map<String, dynamic> toJson() => {
    if (orchestrationSelection != null)
      'orchestrationSelection': orchestrationSelection!.toJson(),
    if (resolvedOrchestrationSnapshot != null)
      'resolvedOrchestrationSnapshot':
          resolvedOrchestrationSnapshot!.toJson(),
    'subagentEnabled': subagentEnabled,
    if (mcpServersEnabled != null) 'mcpServersEnabled': mcpServersEnabled,
    if (skillsEnabled != null) 'skillsEnabled': skillsEnabled,
    if (mainAgentModelOverride != null)
      'mainAgentModelOverride': mainAgentModelOverride!.toJson(),
    'sessionMode': sessionMode,
    'bashReviewMode': bashReviewMode,
  };

  ThreadRuntimeConfig copyWith({
    OrchestrationSelection? orchestrationSelection,
    ResolvedOrchestrationSnapshot? resolvedOrchestrationSnapshot,
    bool clearOrchestrationSnapshot = false,
    Map<String, bool>? subagentEnabled,
    Map<String, bool>? mcpServersEnabled,
    Map<String, bool>? skillsEnabled,
    MainAgentModelOverride? mainAgentModelOverride,
    bool clearMainAgentModelOverride = false,
    SessionMode? sessionMode,
    String? bashReviewMode,
  }) {
    return ThreadRuntimeConfig(
      orchestrationSelection:
          orchestrationSelection ?? this.orchestrationSelection,
      resolvedOrchestrationSnapshot: clearOrchestrationSnapshot
          ? null
          : (resolvedOrchestrationSnapshot ??
                this.resolvedOrchestrationSnapshot),
      subagentEnabled: subagentEnabled ?? this.subagentEnabled,
      mcpServersEnabled: mcpServersEnabled ?? this.mcpServersEnabled,
      skillsEnabled: skillsEnabled ?? this.skillsEnabled,
      mainAgentModelOverride: clearMainAgentModelOverride
          ? null
          : (mainAgentModelOverride ?? this.mainAgentModelOverride),
      sessionMode: sessionMode ?? this.sessionMode,
      bashReviewMode: bashReviewMode ?? this.bashReviewMode,
    );
  }

  final OrchestrationSelection? orchestrationSelection;
  final ResolvedOrchestrationSnapshot? resolvedOrchestrationSnapshot;
  final Map<String, bool> subagentEnabled;
  final Map<String, bool>? mcpServersEnabled;
  final Map<String, bool>? skillsEnabled;
  final MainAgentModelOverride? mainAgentModelOverride;
  final SessionMode sessionMode;
  final String bashReviewMode;
}

String _requiredMainAgentOverrideString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid mainAgentModelOverride.$key');
  }
  return value.trim();
}

Map<String, bool>? _normalizeBooleanSettings(Map<dynamic, dynamic> value) {
  final result = <String, bool>{};
  for (final entry in value.entries) {
    final key = entry.key.toString().trim();
    if (key.isNotEmpty && entry.value is bool) {
      result[key] = entry.value as bool;
    }
  }
  return result.isEmpty ? null : result;
}

Map<String, dynamic> _requiredJsonObject(Object? value, String field) {
  if (value is! Map) {
    throw FormatException('Invalid $field');
  }
  final result = <String, dynamic>{};
  for (final entry in value.entries) {
    if (entry.key is! String) {
      throw FormatException('Invalid $field');
    }
    result[entry.key as String] = entry.value;
  }
  return result;
}

typedef ThreadRuntimeConfigInput = ThreadRuntimeConfig;

class WorkflowSettingsSnapshot {
  const WorkflowSettingsSnapshot({
    required this.sessionMode,
    this.defaultCoreKind,
    this.defaultOrchestrationSelection,
    this.mcpServersEnabled,
  });

  factory WorkflowSettingsSnapshot.fromJson(Map<String, dynamic> json) {
    final rawMcp = json['mcpServersEnabled'];
    Map<String, bool>? parsedMcp;
    if (rawMcp is Map) {
      parsedMcp = normalizeMcpServersEnabled(
        rawMcp.map((key, value) => MapEntry(key.toString(), value)),
      );
    }
    final sessionMode = normalizeSessionMode(json['sessionMode'] as String?);
    OrchestrationSelection? defaultOrchestrationSelection;
    if (json['defaultOrchestrationSelection'] is Map<String, dynamic>) {
      defaultOrchestrationSelection = OrchestrationSelection.fromJson(
        json['defaultOrchestrationSelection'] as Map<String, dynamic>,
      );
    }
    return WorkflowSettingsSnapshot(
      sessionMode: sessionMode,
      defaultCoreKind: json['defaultCoreKind'] as String?,
      defaultOrchestrationSelection: defaultOrchestrationSelection,
      mcpServersEnabled: parsedMcp,
    );
  }

  Map<String, dynamic> toJson() => {
    'sessionMode': sessionMode,
    'planModelEnabled': sessionMode == 'plan',
    if (defaultCoreKind != null) 'defaultCoreKind': defaultCoreKind,
    if (defaultOrchestrationSelection != null)
      'defaultOrchestrationSelection':
          defaultOrchestrationSelection!.toJson(),
    if (mcpServersEnabled != null) 'mcpServersEnabled': mcpServersEnabled,
  };

  final SessionMode sessionMode;
  final String? defaultCoreKind;
  final OrchestrationSelection? defaultOrchestrationSelection;
  final Map<String, bool>? mcpServersEnabled;
}

class PromptImageAttachment {
  const PromptImageAttachment({required this.mediaType, required this.data});

  factory PromptImageAttachment.fromJson(Map<String, dynamic> json) =>
      PromptImageAttachment(
        mediaType: json['mediaType'] as String? ?? 'image/jpeg',
        data: json['data'] as String? ?? '',
      );

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
    this.coreKind,
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
    coreKind: json['coreKind'] as String?,
    runtimeConfig: json['runtimeConfig'] != null
        ? ThreadRuntimeConfig.fromJson(
            json['runtimeConfig'] as Map<String, dynamic>,
          )
        : null,
  );

  ThreadSummary copyWith({
    String? title,
    String? prompt,
    String? workspacePath,
    String? status,
    String? createdAt,
    String? updatedAt,
    String? message,
    String? coreKind,
    ThreadRuntimeConfig? runtimeConfig,
  }) {
    return ThreadSummary(
      id: id,
      title: title ?? this.title,
      prompt: prompt ?? this.prompt,
      workspacePath: workspacePath ?? this.workspacePath,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      message: message ?? this.message,
      coreKind: coreKind ?? this.coreKind,
      runtimeConfig: runtimeConfig ?? this.runtimeConfig,
    );
  }

  final String id;
  final String title;
  final String prompt;
  final String workspacePath;
  final String status;
  final String createdAt;
  final String updatedAt;
  final String message;
  final String? coreKind;
  final ThreadRuntimeConfig? runtimeConfig;
}

class CoderTodoItem {
  const CoderTodoItem({
    required this.id,
    required this.threadId,
    required this.title,
    required this.detail,
    required this.status,
    required this.position,
    required this.updatedAt,
  });

  factory CoderTodoItem.fromJson(Map<String, dynamic> json) => CoderTodoItem(
    id: json['id'] as String? ?? '',
    threadId: json['threadId'] as String? ?? '',
    title: json['title'] as String? ?? '',
    detail: json['detail'] as String? ?? '',
    status: json['status'] as String? ?? 'pending',
    position: (json['position'] as num?)?.toInt() ?? 0,
    updatedAt: json['updatedAt'] as String? ?? '',
  );

  final String id;
  final String threadId;
  final String title;
  final String detail;
  final String status;
  final int position;
  final String updatedAt;
}

class ThreadApiErrorInfo {
  const ThreadApiErrorInfo({
    required this.message,
    this.statusCode,
    this.code,
    this.model,
  });

  factory ThreadApiErrorInfo.fromJson(Map<String, dynamic> json) =>
      ThreadApiErrorInfo(
        message: json['message'] as String? ?? '',
        statusCode: json['statusCode'] as int?,
        code: json['code'] as String?,
        model: json['model'] as String?,
      );

  final String message;
  final int? statusCode;
  final String? code;
  final String? model;
}

class ThreadActivityLine {
  const ThreadActivityLine({
    required this.id,
    required this.role,
    required this.message,
    this.stream,
    this.agentId,
    this.apiError,
  });

  factory ThreadActivityLine.fromJson(Map<String, dynamic> json) =>
      ThreadActivityLine(
        id: json['id'] as String? ?? '',
        role: json['role'] as String? ?? 'assistant',
        message: json['message'] as String? ?? '',
        stream: json['stream'] as bool?,
        agentId: json['agentId'] as String?,
        apiError: json['apiError'] is Map<String, dynamic>
            ? ThreadApiErrorInfo.fromJson(
                json['apiError'] as Map<String, dynamic>,
              )
            : null,
      );

  final String id;
  final String role;
  final String message;
  final bool? stream;
  final String? agentId;
  final ThreadApiErrorInfo? apiError;
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
  const ClarificationQuestionOption({
    required this.label,
    this.description,
    this.recommended,
  });

  factory ClarificationQuestionOption.fromJson(Map<String, dynamic> json) =>
      ClarificationQuestionOption(
        label: json['label'] as String? ?? '',
        description: json['description'] as String?,
        recommended: json['recommended'] as bool?,
      );

  final String label;
  final String? description;
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
            .map(
              (e) => ClarificationQuestionOption.fromJson(
                e as Map<String, dynamic>,
              ),
            )
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
            .map(
              (e) => ClarificationQuestion.fromJson(e as Map<String, dynamic>),
            )
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
    this.agentId,
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
        agentId: json['agentId'] as String?,
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
  final String? agentId;
}

class ThreadPendingFollowUp {
  const ThreadPendingFollowUp({
    required this.id,
    required this.threadId,
    required this.prompt,
    required this.status,
    required this.createdAt,
    this.priority = 'normal',
    this.queuePosition,
    this.attachments = const [],
  });

  factory ThreadPendingFollowUp.fromJson(Map<String, dynamic> json) =>
      ThreadPendingFollowUp(
        id: json['id'] as String? ?? '',
        threadId: json['threadId'] as String? ?? '',
        prompt: json['prompt'] as String? ?? '',
        status: json['status'] as String? ?? 'queued',
        createdAt: json['createdAt'] as String? ?? '',
        priority: json['priority'] as String? ?? 'normal',
        queuePosition: (json['queuePosition'] as num?)?.toInt(),
        attachments: (json['attachments'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(PromptImageAttachment.fromJson)
            .where((attachment) => attachment.data.isNotEmpty)
            .toList(),
      );

  final String id;
  final String threadId;
  final String prompt;
  final String status;
  final String createdAt;
  final String priority;
  final int? queuePosition;
  final List<PromptImageAttachment> attachments;
}

class ThreadSessionBootstrapResult {
  const ThreadSessionBootstrapResult({
    this.thread,
    this.followUps = const [],
    this.pendingPlan,
    this.pendingBash,
    this.pendingClarification,
    this.subagentSessions = const [],
    this.usage = const ThreadUsageSnapshotResult(),
  });

  factory ThreadSessionBootstrapResult.fromJson(Map<String, dynamic> json) {
    final followUpsRaw = json['followUps'] as List<dynamic>? ?? const [];
    final sessionsRaw = json['subagentSessions'] as List<dynamic>? ?? const [];
    final usageRaw = json['usage'];
    return ThreadSessionBootstrapResult(
      thread: json['thread'] is Map<String, dynamic>
          ? ThreadSummary.fromJson(json['thread'] as Map<String, dynamic>)
          : null,
      followUps: followUpsRaw
          .map(
            (entry) =>
                ThreadPendingFollowUp.fromJson(entry as Map<String, dynamic>),
          )
          .toList(),
      pendingPlan: json['pendingPlan'] is Map<String, dynamic>
          ? ThreadPendingPlan.fromJson(
              json['pendingPlan'] as Map<String, dynamic>,
            )
          : null,
      pendingBash: json['pendingBash'] is Map<String, dynamic>
          ? BashApprovalRequest.fromJson(
              json['pendingBash'] as Map<String, dynamic>,
            )
          : null,
      pendingClarification: json['pendingClarification'] is Map<String, dynamic>
          ? ClarificationRequest.fromJson(
              json['pendingClarification'] as Map<String, dynamic>,
            )
          : null,
      subagentSessions: sessionsRaw
          .map(
            (entry) => ThreadSubagentSessionTiming.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(),
      usage: usageRaw is Map<String, dynamic>
          ? ThreadUsageSnapshotResult.fromJson(usageRaw)
          : const ThreadUsageSnapshotResult(),
    );
  }

  final ThreadSummary? thread;
  final List<ThreadPendingFollowUp> followUps;
  final ThreadPendingPlan? pendingPlan;
  final BashApprovalRequest? pendingBash;
  final ClarificationRequest? pendingClarification;
  final List<ThreadSubagentSessionTiming> subagentSessions;
  final ThreadUsageSnapshotResult usage;
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
    this.billing,
    this.contextSnapshot,
    this.title,
    this.tool,
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
      billing: json['billing'] is Map<String, dynamic>
          ? ThreadBillingSnapshot.fromJson(
              json['billing'] as Map<String, dynamic>,
            )
          : null,
      contextSnapshot: json['context'] is Map<String, dynamic>
          ? ThreadContextSnapshot.fromJson(
              json['context'] as Map<String, dynamic>,
            )
          : null,
      title: json['title'] as String?,
      tool: json['tool'] is Map<String, dynamic>
          ? threadRunToolMetadataFromJson(json['tool'] as Map<String, dynamic>)
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
  final ThreadBillingSnapshot? billing;
  final ThreadContextSnapshot? contextSnapshot;
  final String? title;
  final ThreadRunToolMetadata? tool;
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

class WorkspaceDirectoryEntry {
  const WorkspaceDirectoryEntry({required this.name, required this.path});

  factory WorkspaceDirectoryEntry.fromJson(Map<String, dynamic> json) =>
      WorkspaceDirectoryEntry(
        name: json['name'] as String? ?? '',
        path: json['path'] as String? ?? '',
      );

  final String name;
  final String path;
}

class WorkspaceDirectoryListing {
  const WorkspaceDirectoryListing({
    required this.path,
    required this.directories,
    this.parentPath,
  });

  factory WorkspaceDirectoryListing.fromJson(
    Map<String, dynamic> json,
  ) => WorkspaceDirectoryListing(
    path: json['path'] as String? ?? '',
    parentPath: json['parentPath'] as String?,
    directories: (json['directories'] as List<dynamic>? ?? const [])
        .map(
          (entry) =>
              WorkspaceDirectoryEntry.fromJson(entry as Map<String, dynamic>),
        )
        .toList(),
  );

  final String path;
  final String? parentPath;
  final List<WorkspaceDirectoryEntry> directories;
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
    required this.mainAgentConfigs,
    this.mainAgentPrompts = const [],
    this.subagentOrchestrations = const [],
    this.providers = const [],
    this.mcpSettings,
  });

  factory ModelSettingsSnapshot.fromJson(Map<String, dynamic> json) {
    final rawMcpSettings = json['mcpSettings'];
    return ModelSettingsSnapshot(
      mainAgentConfigs: (json['mainAgentConfigs'] as List<dynamic>? ?? [])
          .map(
            (entry) => MainAgentConfigResource.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(growable: false),
      mainAgentPrompts: (json['mainAgentPrompts'] as List<dynamic>? ?? [])
          .map(
            (entry) => MainAgentPromptResource.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList(growable: false),
      subagentOrchestrations:
          (json['subagentOrchestrations'] as List<dynamic>? ?? [])
              .map(
                (entry) => SubagentOrchestrationResource.fromJson(
                  entry as Map<String, dynamic>,
                ),
              )
              .toList(growable: false),
      providers: (json['providers'] as List<dynamic>? ?? [])
          .map((e) => ModelProviderView.fromJson(e as Map<String, dynamic>))
          .toList(),
      mcpSettings: rawMcpSettings is Map<String, dynamic>
          ? McpSettingsSnapshot.fromJson(rawMcpSettings)
          : null,
    );
  }

  final List<MainAgentConfigResource> mainAgentConfigs;
  final List<MainAgentPromptResource> mainAgentPrompts;
  final List<SubagentOrchestrationResource> subagentOrchestrations;
  final List<ModelProviderView> providers;
  final McpSettingsSnapshot? mcpSettings;
}

class ModelProviderView {
  const ModelProviderView({
    required this.id,
    required this.name,
    required this.defaultModel,
    required this.enabled,
  });

  factory ModelProviderView.fromJson(Map<String, dynamic> json) =>
      ModelProviderView(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        defaultModel: json['defaultModel'] as String? ?? '',
        enabled: json['enabled'] as bool? ?? false,
      );

  final String id;
  final String name;
  final String defaultModel;
  final bool enabled;
}

class CandidateModelView {
  const CandidateModelView({
    required this.id,
    required this.providerId,
    required this.modelId,
    this.displayName,
    this.resolvedSupportsReasoning,
  });

  factory CandidateModelView.fromJson(Map<String, dynamic> json) =>
      CandidateModelView(
        id: json['id'] as String? ?? '',
        providerId: json['providerId'] as String? ?? '',
        modelId: json['modelId'] as String? ?? '',
        displayName: json['displayName'] as String?,
        resolvedSupportsReasoning: json['resolvedSupportsReasoning'] as bool?,
      );

  final String id;
  final String providerId;
  final String modelId;
  final String? displayName;
  final bool? resolvedSupportsReasoning;
}
