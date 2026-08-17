import 'dart:convert';

import '../models/acp_models.dart';
import '../models/image_view_models.dart';
import '../models/git_models.dart';
import '../models/asr_models.dart';
import '../models/mcp_models.dart';
import '../models/integration_models.dart';
import '../models/project_orchestration_settings.dart';
import '../models/skill_models.dart';
import '../models/thread_models.dart';
import '../models/thread_run_projection.dart';
import '../models/thread_usage_models.dart';
import '../network/eco_center_client.dart';

class DesktopRpc {
  DesktopRpc(this._client, this.desktopDeviceId);

  final EcoCenterClient _client;
  final String desktopDeviceId;

  Future<AsrStatus> getAsrStatus() async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'asr-settings:get-status',
      [],
    );
    return AsrStatus.fromJson(result);
  }

  Future<String> transcribeAsr({
    required String audioWavBase64,
    required String profileId,
  }) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'asr:transcribe',
      [
        {'audioWavBase64': audioWavBase64, 'profileId': profileId},
      ],
      deadlineMs: 240000,
    );
    return AsrTranscriptResponse.fromJson(
      result,
      apiMode: AsrApiMode.audioTranscriptions,
    ).text;
  }

  Future<ImageViewReadData> readImageView(String path) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'image-view:read',
      [
        {'path': path},
      ],
    );
    if (result is! Map<String, dynamic>) {
      throw const ImageViewReadException(
        ImageViewReadFailureCode.invalidResponse,
      );
    }
    if (result['ok'] != true) {
      throw ImageViewReadException(
        imageViewReadFailureCodeFromWire(result['code']),
      );
    }

    final dataBase64 = result['dataBase64'];
    final mimeType = result['mimeType'];
    final imagePath = result['path'];
    final fileName = result['fileName'];
    final bytes = result['bytes'];
    final width = result['width'];
    final height = result['height'];
    if (dataBase64 is! String ||
        mimeType is! String ||
        imagePath is! String ||
        fileName is! String ||
        bytes is! num ||
        width is! num ||
        height is! num) {
      throw const ImageViewReadException(
        ImageViewReadFailureCode.invalidResponse,
      );
    }

    try {
      final decoded = base64Decode(dataBase64);
      final byteLength = bytes.toInt();
      final imageWidth = width.toInt();
      final imageHeight = height.toInt();
      final supportedMimeType =
          mimeType == 'image/png' ||
          mimeType == 'image/jpeg' ||
          mimeType == 'image/gif' ||
          mimeType == 'image/webp';
      if (!supportedMimeType ||
          imagePath.trim().isEmpty ||
          fileName.trim().isEmpty ||
          decoded.isEmpty ||
          decoded.length != byteLength ||
          byteLength <= 0 ||
          imageWidth <= 0 ||
          imageHeight <= 0) {
        throw const ImageViewReadException(
          ImageViewReadFailureCode.invalidResponse,
        );
      }
      return ImageViewReadData(
        bytes: decoded,
        mimeType: mimeType,
        path: imagePath,
        fileName: fileName,
        byteLength: byteLength,
        width: imageWidth,
        height: imageHeight,
      );
    } on ImageViewReadException {
      rethrow;
    } on FormatException catch (error) {
      throw ImageViewReadException(
        ImageViewReadFailureCode.invalidResponse,
        detail: error.message,
      );
    }
  }

  Future<List<ThreadSummary>> listThreads() async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'thread:list',
      [],
    );
    return result
        .map((e) => ThreadSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ThreadSummary?> getThread(String threadId) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:get',
      [threadId],
    );
    if (result is! Map<String, dynamic>) return null;
    return ThreadSummary.fromJson(result);
  }

  Future<ThreadSessionBootstrapResult> sessionBootstrap(String threadId) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:session-bootstrap',
      [threadId],
    );
    return ThreadSessionBootstrapResult.fromJson(result);
  }

  Future<ThreadSummary> startThread({
    required String workspacePath,
    required String prompt,
    required ThreadRuntimeConfigInput runtimeConfig,
    String? coreKind,
    List<PromptImageAttachment>? attachments,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:start',
      [
        {
          'workspacePath': workspacePath,
          'prompt': prompt,
          'coreKind': ?coreKind,
          if (attachments != null && attachments.isNotEmpty)
            'attachments': attachments.map((a) => a.toJson()).toList(),
          'runtimeConfig': runtimeConfig.toJson(),
        },
      ],
    );
    return ThreadSummary.fromJson(result['thread'] as Map<String, dynamic>);
  }

  Future<ThreadSummary> continueThread({
    required String threadId,
    required String prompt,
    List<PromptImageAttachment>? attachments,
    ThreadRuntimeConfigInput? runtimeConfig,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:continue',
      [
        {
          'threadId': threadId,
          'prompt': prompt,
          if (attachments != null && attachments.isNotEmpty)
            'attachments': attachments.map((a) => a.toJson()).toList(),
          if (runtimeConfig != null) 'runtimeConfig': runtimeConfig.toJson(),
        },
      ],
    );
    return ThreadSummary.fromJson(result['thread'] as Map<String, dynamic>);
  }

  Future<void> cancelThread(String threadId) async {
    await _client.invoke(desktopDeviceId, 'thread:cancel', [threadId]);
  }

  Future<void> deleteThread(String threadId) async {
    await _client.invoke(desktopDeviceId, 'thread:delete', [threadId]);
  }

  Future<({bool ok, bool regenerated})> regenerateThreadTitle(
    String threadId,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:regenerate-title',
      [threadId],
    );
    return (
      ok: result['ok'] == true,
      regenerated: result['regenerated'] == true,
    );
  }

  Future<List<ThreadActivityLine>> activityList(String threadId) async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'thread:activity-list',
      [threadId],
    );
    return result
        .map((e) => ThreadActivityLine.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<ThreadUserMessageEditGetResult> getUserMessageEdit({
    required String threadId,
    required String activityLineId,
  }) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:user-message-edit-get',
      [
        {'threadId': threadId, 'activityLineId': activityLineId},
      ],
    );
    if (result is! Map<String, dynamic>) {
      throw StateError('Desktop returned an invalid user message edit result.');
    }
    return ThreadUserMessageEditGetResult.fromJson(result);
  }

  Future<ThreadSummary> rewriteThreadFromMessage({
    required String threadId,
    required String activityLineId,
    required String prompt,
    required List<PromptImageAttachment> attachments,
    required int expectedHistoryRevision,
    ThreadRuntimeConfigInput? runtimeConfig,
  }) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:rewrite-from-message',
      [
        {
          'threadId': threadId,
          'activityLineId': activityLineId,
          'prompt': prompt,
          'attachments': attachments
              .map((attachment) => attachment.toJson())
              .toList(),
          'expectedHistoryRevision': expectedHistoryRevision,
          if (runtimeConfig != null) 'runtimeConfig': runtimeConfig.toJson(),
        },
      ],
    );
    if (result is! Map<String, dynamic>) {
      throw StateError(
        'Desktop returned an invalid user message rewrite result.',
      );
    }
    final thread = result['thread'];
    if (thread is! Map<String, dynamic>) {
      throw StateError('Desktop returned no rewritten thread.');
    }
    return ThreadSummary.fromJson(thread);
  }

  Future<ThreadRunProjectionSnapshot?> getRunProjection(
    String threadId, {
    String mode = 'full',
    int? afterSequence,
    int? historyRevision,
  }) async {
    // Remote registry accepts a single string arg; encode feed mode in the string.
    final arg = _encodeRunProjectionArg(
      threadId,
      mode: mode,
      afterSequence: afterSequence,
      historyRevision: historyRevision,
    );
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:run-projection-get',
      [arg],
    );
    if (result is! Map<String, dynamic>) return null;
    return ThreadRunProjectionSnapshot.fromJson(
      result,
      includeToolOutputPreview: mode != 'feed',
    );
  }

  Future<ThreadRunProjectionDetailResult?> getRunProjectionDetail({
    required String threadId,
    required String kind,
    required String key,
    int? afterSequence,
    int? beforeSequence,
    bool tail = false,
    int? limit,
    bool includeToolOutputPreview = true,
  }) async {
    final request = <String, dynamic>{
      'threadId': threadId,
      'kind': kind,
      'key': key,
    };
    if (afterSequence != null) {
      request['afterSequence'] = afterSequence;
    }
    if (beforeSequence != null) {
      request['beforeSequence'] = beforeSequence;
    }
    if (tail) {
      request['tail'] = true;
    }
    if (limit != null) {
      request['limit'] = limit;
    }
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:run-projection-detail-get',
      [request],
    );
    if (result is! Map<String, dynamic>) return null;
    return ThreadRunProjectionDetailResult.fromJson(
      result,
      includeToolOutputPreview: includeToolOutputPreview,
    );
  }

  Future<ThreadUsageSnapshotResult> getThreadUsageSnapshot(
    String threadId,
  ) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:get-usage-snapshot',
      [threadId],
    );
    if (result is! Map<String, dynamic>) {
      return const ThreadUsageSnapshotResult();
    }
    return ThreadUsageSnapshotResult.fromJson(result);
  }

  Future<List<ThreadSubagentSessionTiming>> listSubagentSessions(
    String threadId,
  ) async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'thread:subagent-sessions-list',
      [threadId],
    );
    return result
        .map(
          (entry) => ThreadSubagentSessionTiming.fromJson(
            entry as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<ThreadPendingPlan?> getPendingPlan(String threadId) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:get-pending-plan',
      [threadId],
    );
    if (result == null) return null;
    return ThreadPendingPlan.fromJson(result as Map<String, dynamic>);
  }

  Future<ThreadPendingPlan?> getApprovedPlan(String threadId) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:get-approved-plan',
      [threadId],
    );
    if (result == null) return null;
    return ThreadPendingPlan.fromJson(result as Map<String, dynamic>);
  }

  Future<void> approvePlan(String threadId) async {
    await _client.invoke(desktopDeviceId, 'thread:approve-plan', [
      {'threadId': threadId},
    ]);
  }

  Future<void> dismissPlan(String threadId) async {
    await _client.invoke(desktopDeviceId, 'thread:dismiss-plan', [threadId]);
  }

  Future<BashApprovalRequest?> getPendingBashApproval(String threadId) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'bash-approval:get-pending',
      [threadId],
    );
    if (result == null) return null;
    return BashApprovalRequest.fromJson(result as Map<String, dynamic>);
  }

  Future<void> resolveBashApproval({
    required String toolUseId,
    required String decision,
    String? feedback,
  }) async {
    await _client.invoke(desktopDeviceId, 'bash-approval:resolve', [
      {
        'toolUseId': toolUseId,
        'decision': decision,
        if (feedback != null && feedback.trim().isNotEmpty)
          'feedback': feedback.trim(),
      },
    ]);
  }

  Future<ClarificationRequest?> getPendingClarification(String threadId) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'clarification:get-pending',
      [threadId],
    );
    if (result == null) return null;
    return ClarificationRequest.fromJson(result as Map<String, dynamic>);
  }

  Future<void> submitClarification({
    required String toolUseId,
    required List<List<String>> selections,
  }) async {
    await _client.invoke(desktopDeviceId, 'clarification:submit', [
      {'toolUseId': toolUseId, 'selections': selections},
    ]);
  }

  Future<void> dismissClarification(String toolUseId) async {
    await _client.invoke(desktopDeviceId, 'clarification:dismiss', [toolUseId]);
  }

  Future<List<ThreadPendingFollowUp>> followUpList(String threadId) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:follow-up-list',
      [threadId],
    );
    final followUps = result['followUps'] as List<dynamic>? ?? [];
    return followUps
        .map((e) => ThreadPendingFollowUp.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> followUpEnqueue({
    required String threadId,
    required String prompt,
    List<PromptImageAttachment>? attachments,
  }) async {
    await _client.invoke(desktopDeviceId, 'thread:follow-up-enqueue', [
      {
        'threadId': threadId,
        'prompt': prompt,
        if (attachments != null && attachments.isNotEmpty)
          'attachments': attachments
              .map((attachment) => attachment.toJson())
              .toList(),
      },
    ]);
  }

  Future<void> followUpCancel({
    required String threadId,
    required String followUpId,
  }) async {
    await _client.invoke(desktopDeviceId, 'thread:follow-up-cancel', [
      {'threadId': threadId, 'followUpId': followUpId},
    ]);
  }

  Future<void> followUpEscalate({
    required String threadId,
    required String followUpId,
  }) async {
    await _client.invoke(desktopDeviceId, 'thread:follow-up-escalate', [
      {'threadId': threadId, 'followUpId': followUpId},
    ]);
  }

  Future<List<ThreadPendingFollowUp>> followUpReorder({
    required String threadId,
    required List<String> followUpIds,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:follow-up-reorder',
      [
        {'threadId': threadId, 'followUpIds': followUpIds},
      ],
    );
    final followUps = result['followUps'] as List<dynamic>? ?? [];
    return followUps
        .map(
          (entry) =>
              ThreadPendingFollowUp.fromJson(entry as Map<String, dynamic>),
        )
        .toList();
  }

  Future<void> followUpUpdate({
    required String threadId,
    required String followUpId,
    required String prompt,
    List<PromptImageAttachment>? attachments,
  }) async {
    await _client.invoke(desktopDeviceId, 'thread:follow-up-update', [
      {
        'threadId': threadId,
        'followUpId': followUpId,
        'prompt': prompt,
        if (attachments != null && attachments.isNotEmpty)
          'attachments': attachments
              .map((attachment) => attachment.toJson())
              .toList(),
      },
    ]);
  }

  Future<ThreadSummary> updateRuntimeConfig({
    required String threadId,
    required ThreadRuntimeConfigInput runtimeConfig,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:update-runtime-config',
      [
        {'threadId': threadId, 'runtimeConfig': runtimeConfig.toJson()},
      ],
    );
    return ThreadSummary.fromJson(result['thread'] as Map<String, dynamic>);
  }

  Future<WorkspaceInfo?> getCurrentWorkspace() async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'workspace:get-current',
      [],
    );
    if (result == null) return null;
    return WorkspaceInfo.fromJson(result as Map<String, dynamic>);
  }

  Future<WorkspaceInfo> openWorkspacePath(String workspacePath) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workspace:open-path',
      [workspacePath],
    );
    return WorkspaceInfo.fromJson(result);
  }

  Future<String> getHomeProjectPath() async {
    return await _client.invoke<String>(
      desktopDeviceId,
      'workspace:get-home-path',
      [],
    );
  }

  Future<String> getUserHomePath() async {
    return await _client.invoke<String>(
      desktopDeviceId,
      'workspace:get-user-home-path',
      [],
    );
  }

  Future<WorkspaceDirectoryListing> listWorkspaceDirectories(
    String directoryPath,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workspace:list-directories',
      [directoryPath],
    );
    return WorkspaceDirectoryListing.fromJson(result);
  }

  Future<WorkspaceInfo> inspectWorkspace(String workspacePath) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workspace:inspect',
      [workspacePath],
    );
    return WorkspaceInfo.fromJson(result);
  }

  Future<ModelSettingsSnapshot> getModelSettings() async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'model-settings:get',
      [],
    );
    return ModelSettingsSnapshot.fromJson(result);
  }

  Future<List<CursorModelOption>> listCursorModels() async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'cursor:models-list',
      [],
    );
    return result
        .map(
          (entry) => CursorModelOption.fromJson(
            Map<String, dynamic>.from(entry as Map),
          ),
        )
        .toList(growable: false);
  }

  Future<List<CandidateModelView>> listCandidateModels(
    String providerId,
  ) async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'candidate-model:list',
      [providerId],
    );
    return result
        .map(
          (entry) => CandidateModelView.fromJson(entry as Map<String, dynamic>),
        )
        .toList();
  }

  Future<WorkflowSettingsSnapshot> getWorkflowSettings() async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workflow-settings:get',
      [],
    );
    return WorkflowSettingsSnapshot.fromJson(result);
  }

  Future<WorkflowSettingsSnapshot> saveWorkflowSettings(
    WorkflowSettingsSnapshot settings,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workflow-settings:save',
      [settings.toJson()],
    );
    return WorkflowSettingsSnapshot.fromJson(result);
  }

  Future<IntegrationAvailabilitySnapshot> getIntegrationAvailability() async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'integration-availability:get',
      [],
    );
    return IntegrationAvailabilitySnapshot.fromJson(result);
  }

  Future<ProjectIntegrationsSettingsSnapshot> getProjectIntegrationsSettings(
    String workspacePath,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'project-integrations-settings:get',
      [workspacePath],
    );
    return ProjectIntegrationsSettingsSnapshot.fromJson(result);
  }

  Future<ProjectIntegrationsSettingsSnapshot> saveProjectIntegrationsSettings(
    ProjectIntegrationsSettingsSnapshot settings,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'project-integrations-settings:save',
      [settings.toJson()],
    );
    return ProjectIntegrationsSettingsSnapshot.fromJson(result);
  }

  Future<ProjectOrchestrationSettingsSnapshot> getProjectOrchestrationSettings(
    String workspacePath,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'project-orchestration-settings:get',
      [workspacePath],
    );
    return ProjectOrchestrationSettingsSnapshot.fromJson(result);
  }

  Future<ProjectOrchestrationSettingsSnapshot> saveProjectOrchestrationSettings(
    ProjectOrchestrationSettingsSnapshot settings,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'project-orchestration-settings:save',
      [settings.toJson()],
    );
    return ProjectOrchestrationSettingsSnapshot.fromJson(result);
  }

  Future<McpSettingsSnapshot> getMcpSettings() async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'mcp-settings:get',
      [],
    );
    return McpSettingsSnapshot.fromJson(result);
  }

  Future<SkillsListResult> listSkills(String workspacePath) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'skills:list',
      [workspacePath],
    );
    return SkillsListResult.fromJson(result);
  }

  Future<ProjectSkillsSettingsSnapshot> getProjectSkillsSettings(
    String workspacePath,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'project-skills-settings:get',
      [workspacePath],
    );
    return ProjectSkillsSettingsSnapshot.fromJson(result);
  }

  Future<ProjectSkillsSettingsSnapshot> saveProjectSkillsSettings(
    ProjectSkillsSettingsSnapshot settings,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'project-skills-settings:save',
      [settings.toJson()],
    );
    return ProjectSkillsSettingsSnapshot.fromJson(result);
  }

  Future<GitWorkingTreeStatus> getGitStatus(String workspacePath) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:get-status',
      [workspacePath],
    );
    return GitWorkingTreeStatus.fromJson(result);
  }

  Future<WorkspaceDiffResult> getWorkspaceDiff(String workspacePath) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:get-workspace-diff',
      [workspacePath],
    );
    return WorkspaceDiffResult.fromJson(result);
  }

  Future<GitWorkingTreeStatus> checkoutGitBranch({
    required String workspacePath,
    required String branch,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:checkout-branch',
      [
        {'workspacePath': workspacePath, 'branch': branch},
      ],
    );
    return GitWorkingTreeStatus.fromJson(result);
  }

  Future<GitWorkingTreeStatus> createGitBranch({
    required String workspacePath,
    required String branch,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:create-branch',
      [
        {'workspacePath': workspacePath, 'branch': branch},
      ],
    );
    return GitWorkingTreeStatus.fromJson(result);
  }

  Future<GitListCommitModelOptionsResult> listCommitModelOptions({
    String? mainAgentConfigId,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:list-commit-model-options',
      [
        {
          if (mainAgentConfigId != null && mainAgentConfigId.trim().isNotEmpty)
            'mainAgentConfigId': mainAgentConfigId.trim(),
        },
      ],
    );
    return GitListCommitModelOptionsResult.fromJson(result);
  }

  Future<GitGenerateCommitMessageResult> generateCommitMessage({
    required String workspacePath,
    String? mainAgentConfigId,
    bool includeUnstaged = true,
    String? candidateModelId,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:generate-commit-message',
      [
        {
          'workspacePath': workspacePath,
          'includeUnstaged': includeUnstaged,
          if (mainAgentConfigId != null && mainAgentConfigId.trim().isNotEmpty)
            'mainAgentConfigId': mainAgentConfigId.trim(),
          if (candidateModelId != null && candidateModelId.isNotEmpty)
            'candidateModelId': candidateModelId,
        },
      ],
      deadlineMs: 120000,
    );
    return GitGenerateCommitMessageResult.fromJson(result);
  }

  Future<GitCommitResult> commitChanges({
    required String workspacePath,
    String? mainAgentConfigId,
    bool includeUnstaged = true,
    String? message,
    String? candidateModelId,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:commit',
      [
        {
          'workspacePath': workspacePath,
          'includeUnstaged': includeUnstaged,
          if (mainAgentConfigId != null && mainAgentConfigId.trim().isNotEmpty)
            'mainAgentConfigId': mainAgentConfigId.trim(),
          if (message != null && message.isNotEmpty) 'message': message,
          if (candidateModelId != null && candidateModelId.isNotEmpty)
            'candidateModelId': candidateModelId,
        },
      ],
      deadlineMs: 120000,
    );
    return GitCommitResult.fromJson(result);
  }

  Future<GitPushResult> pushChanges({
    required String workspacePath,
    String? branch,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:push',
      [
        {
          'workspacePath': workspacePath,
          if (branch != null && branch.isNotEmpty) 'branch': branch,
        },
      ],
      deadlineMs: 120000,
    );
    return GitPushResult.fromJson(result);
  }

  Future<GitPullResult> pullChanges({
    required String workspacePath,
    String? branch,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:pull',
      [
        {
          'workspacePath': workspacePath,
          if (branch != null && branch.isNotEmpty) 'branch': branch,
        },
      ],
      deadlineMs: 120000,
    );
    return GitPullResult.fromJson(result);
  }

  Future<GitFetchResult> fetchChanges({required String workspacePath}) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'git:fetch',
      [
        {'workspacePath': workspacePath},
      ],
      deadlineMs: 120000,
    );
    return GitFetchResult.fromJson(result);
  }

  Future<List<CoderTodoItem>> listThreadTodos(String threadId) async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'thread:todo-list',
      [threadId],
    );
    return result
        .map((entry) => CoderTodoItem.fromJson(entry as Map<String, dynamic>))
        .toList();
  }

  Future<PackageScriptsListResult> listPackageScripts(
    String workspacePath,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workspace:list-package-scripts',
      [workspacePath],
    );
    return PackageScriptsListResult.fromJson(result);
  }

  Future<Map<String, String>> savePackageScriptArgs({
    required String workspacePath,
    required String script,
    required String args,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workspace:save-package-script-args',
      [
        {'workspacePath': workspacePath, 'script': script, 'args': args},
      ],
    );
    final rawArgs = result['scriptArgs'];
    final scriptArgs = <String, String>{};
    if (rawArgs is Map) {
      for (final entry in rawArgs.entries) {
        final value = entry.value;
        if (value is String && value.trim().isNotEmpty) {
          scriptArgs[entry.key.toString()] = value.trim();
        }
      }
    }
    return scriptArgs;
  }

  Future<StartPackageScriptResult> startPackageScript({
    required String workspacePath,
    required String script,
    String? args,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'workspace:start-package-script',
      [
        {
          'workspacePath': workspacePath,
          'script': script,
          if (args != null && args.isNotEmpty) 'args': args,
        },
      ],
      deadlineMs: 120000,
    );
    return StartPackageScriptResult.fromJson(result);
  }

  Future<BackgroundTerminalTask> getBackgroundTerminalTask(
    String taskId,
  ) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'background-terminal:open',
      [
        {'taskId': taskId},
      ],
    );
    return BackgroundTerminalTask.fromJson(result);
  }

  Future<void> stopBackgroundTerminalTask(String taskId) async {
    await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'background-terminal:stop',
      [
        {'taskId': taskId},
      ],
    );
  }
}

String _encodeRunProjectionArg(
  String threadId, {
  required String mode,
  int? afterSequence,
  int? historyRevision,
}) {
  if (mode != 'feed') {
    return threadId;
  }
  if (afterSequence == null && historyRevision == null) {
    return 'feed:$threadId';
  }
  final encodedThreadId = Uri.encodeComponent(threadId);
  final query = <String>[
    if (afterSequence != null) 'afterSequence=$afterSequence',
    if (historyRevision != null) 'historyRevision=$historyRevision',
  ].join('&');
  return 'feed:$encodedThreadId?$query';
}
