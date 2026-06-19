import '../models/thread_models.dart';
import '../network/eco_center_client.dart';

class DesktopRpc {
  DesktopRpc(this._client, this.desktopDeviceId);

  final EcoCenterClient _client;
  final String desktopDeviceId;

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

  Future<ThreadSummary> startThread({
    required String workspacePath,
    required String prompt,
    required ThreadRuntimeConfigInput runtimeConfig,
    List<PromptImageAttachment>? attachments,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:start',
      [
        {
          'workspacePath': workspacePath,
          'prompt': prompt,
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

  Future<ThreadSummary> retryThread(String threadId) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:retry',
      [threadId],
    );
    return ThreadSummary.fromJson(result['thread'] as Map<String, dynamic>);
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

  Future<ThreadPendingPlan?> getPendingPlan(String threadId) async {
    final result = await _client.invoke<dynamic>(
      desktopDeviceId,
      'thread:get-pending-plan',
      [threadId],
    );
    if (result == null) return null;
    return ThreadPendingPlan.fromJson(result as Map<String, dynamic>);
  }

  Future<void> approvePlan(String threadId) async {
    await _client.invoke(
      desktopDeviceId,
      'thread:approve-plan',
      [
        {'threadId': threadId},
      ],
    );
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
  }) async {
    await _client.invoke(
      desktopDeviceId,
      'bash-approval:resolve',
      [
        {'toolUseId': toolUseId, 'decision': decision},
      ],
    );
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
    await _client.invoke(
      desktopDeviceId,
      'clarification:submit',
      [
        {'toolUseId': toolUseId, 'selections': selections},
      ],
    );
  }

  Future<void> dismissClarification(String toolUseId) async {
    await _client.invoke(
      desktopDeviceId,
      'clarification:dismiss',
      [toolUseId],
    );
  }

  Future<List<ThreadPendingFollowUp>> followUpList(String threadId) async {
    final result = await _client.invoke<List<dynamic>>(
      desktopDeviceId,
      'thread:follow-up-list',
      [threadId],
    );
    return result
        .map((e) => ThreadPendingFollowUp.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> followUpEnqueue({
    required String threadId,
    required String prompt,
  }) async {
    await _client.invoke(
      desktopDeviceId,
      'thread:follow-up-enqueue',
      [
        {'threadId': threadId, 'prompt': prompt},
      ],
    );
  }

  Future<void> followUpCancel({
    required String threadId,
    required String followUpId,
  }) async {
    await _client.invoke(
      desktopDeviceId,
      'thread:follow-up-cancel',
      [
        {'threadId': threadId, 'followUpId': followUpId},
      ],
    );
  }

  Future<ThreadSummary> updateRuntimeConfig({
    required String threadId,
    required ThreadRuntimeConfigInput runtimeConfig,
  }) async {
    final result = await _client.invoke<Map<String, dynamic>>(
      desktopDeviceId,
      'thread:update-runtime-config',
      [
        {
          'threadId': threadId,
          'runtimeConfig': runtimeConfig.toJson(),
        },
      ],
    );
    return ThreadSummary.fromJson(result['thread'] as Map<String, dynamic>);
  }

  Future<String> getCurrentWorkspace() async {
    return await _client.invoke<String>(
      desktopDeviceId,
      'workspace:get-current',
      [],
    );
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
}
