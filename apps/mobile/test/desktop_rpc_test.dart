import 'package:eco_mobile/core/network/desktop_rpc.dart';
import 'package:eco_mobile/core/models/agent_orchestration.dart';
import 'package:eco_mobile/core/models/project_orchestration_settings.dart';
import 'package:eco_mobile/core/network/eco_center_client.dart';
import 'package:eco_mobile/core/storage/credential_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('getRunProjection encodes feed mode in a single string arg', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    final projection = await rpc.getRunProjection('thr_1', mode: 'feed');

    expect(client.desktopDeviceId, 'desktop_1');
    expect(client.channel, 'thread:run-projection-get');
    expect(client.args, ['feed:thr_1']);
    expect(projection?.threadId, 'thr_1');
  });

  test(
    'getRunProjection encodes feed afterSequence in the string arg',
    () async {
      final client = _RecordingEcoCenterClient();
      final rpc = DesktopRpc(client, 'desktop_1');

      await rpc.getRunProjection('thr:1', mode: 'feed', afterSequence: 42);

      expect(client.channel, 'thread:run-projection-get');
      expect(client.args, ['feed:thr%3A1?afterSequence=42']);
    },
  );

  test('getRunProjection encodes the incremental history revision', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    await rpc.getRunProjection(
      'thr:1',
      mode: 'feed',
      afterSequence: 42,
      historyRevision: 3,
    );

    expect(client.args, ['feed:thr%3A1?afterSequence=42&historyRevision=3']);
  });

  test('getRunProjectionDetail sends object request', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    final detail = await rpc.getRunProjectionDetail(
      threadId: 'thr_1',
      kind: 'agent',
      key: 'agent_1',
      afterSequence: 4,
      limit: 20,
    );

    expect(client.channel, 'thread:run-projection-detail-get');
    expect(client.args, [
      {
        'threadId': 'thr_1',
        'kind': 'agent',
        'key': 'agent_1',
        'afterSequence': 4,
        'limit': 20,
      },
    ]);
    expect(detail?.kind, 'agent');
    expect(detail?.key, 'agent_1');
  });

  test('getRunProjectionDetail sends earlier Feed page request', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    await rpc.getRunProjectionDetail(
      threadId: 'thr_1',
      kind: 'main',
      key: 'thr_1',
      beforeSequence: 101,
      tail: true,
      limit: 100,
      includeToolOutputPreview: false,
    );

    expect(client.channel, 'thread:run-projection-detail-get');
    expect(client.args, [
      {
        'threadId': 'thr_1',
        'kind': 'main',
        'key': 'thr_1',
        'beforeSequence': 101,
        'tail': true,
        'limit': 100,
      },
    ]);
  });

  test('getBackgroundTerminalTask parses task progress', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    final task = await rpc.getBackgroundTerminalTask('task_1');

    expect(client.channel, 'background-terminal:open');
    expect(client.args, [
      {'taskId': 'task_1'},
    ]);
    expect(task.status, 'running');
    expect(task.output, 'building...');
    expect(task.isActive, isTrue);
  });

  test('stopBackgroundTerminalTask sends task id', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    await rpc.stopBackgroundTerminalTask('task_1');

    expect(client.channel, 'background-terminal:stop');
    expect(client.args, [
      {'taskId': 'task_1'},
    ]);
  });

  test('listCommitModelOptions sends main agent config id', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    await rpc.listCommitModelOptions(mainAgentConfigId: 'main_1');

    expect(client.channel, 'git:list-commit-model-options');
    expect(client.args, [
      {'mainAgentConfigId': 'main_1'},
    ]);
  });

  test('generateCommitMessage sends main agent config id', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    await rpc.generateCommitMessage(
      workspacePath: '/repo',
      mainAgentConfigId: 'main_1',
      candidateModelId: 'candidate_1',
    );

    expect(client.channel, 'git:generate-commit-message');
    expect(client.args, [
      {
        'workspacePath': '/repo',
        'mainAgentConfigId': 'main_1',
        'includeUnstaged': true,
        'candidateModelId': 'candidate_1',
      },
    ]);
  });

  test('commitChanges sends main agent config id', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    await rpc.commitChanges(
      workspacePath: '/repo',
      mainAgentConfigId: 'main_1',
      includeUnstaged: false,
      message: 'feat: compose orchestration',
    );

    expect(client.channel, 'git:commit');
    expect(client.args, [
      {
        'workspacePath': '/repo',
        'mainAgentConfigId': 'main_1',
        'includeUnstaged': false,
        'message': 'feat: compose orchestration',
      },
    ]);
  });

  test('getProjectOrchestrationSettings sends workspace path', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');

    final settings = await rpc.getProjectOrchestrationSettings('/repo');

    expect(client.channel, 'project-orchestration-settings:get');
    expect(client.args, ['/repo']);
    expect(settings.workspacePath, '/repo');
    expect(settings.orchestrationSelection?.mainAgentConfigId, 'main_1');
  });

  test('saveProjectOrchestrationSettings sends complete selection', () async {
    final client = _RecordingEcoCenterClient();
    final rpc = DesktopRpc(client, 'desktop_1');
    const selection = OrchestrationSelection(
      mainAgentConfigId: 'main_1',
      mainPrompt: BuiltinMainAgentPromptSelection(),
      subagents: NoneSubagentSelection(),
    );

    await rpc.saveProjectOrchestrationSettings(
      const ProjectOrchestrationSettingsSnapshot(
        workspacePath: '/repo',
        orchestrationSelection: selection,
      ),
    );

    expect(client.channel, 'project-orchestration-settings:save');
    expect(client.args, [
      {'workspacePath': '/repo', 'orchestrationSelection': selection.toJson()},
    ]);
  });
}

class _RecordingEcoCenterClient extends EcoCenterClient {
  _RecordingEcoCenterClient() : super(store: CredentialStore());

  String? desktopDeviceId;
  String? channel;
  List<dynamic>? args;

  @override
  Future<T> invoke<T>(
    String desktopDeviceId,
    String channel,
    List<dynamic> args, {
    int? deadlineMs,
  }) async {
    this.desktopDeviceId = desktopDeviceId;
    this.channel = channel;
    this.args = args;
    if (channel == 'thread:run-projection-detail-get') {
      return {
            'threadId': 'thr_1',
            'kind': 'agent',
            'key': 'agent_1',
            'generatedAt': '2026-01-01T00:00:00.000Z',
            'timeline': [],
            'sourceEventCount': 1,
            'hasMore': false,
          }
          as T;
    }
    if (channel == 'background-terminal:open') {
      return {
            'taskId': 'task_1',
            'sessionId': 'session_1',
            'status': 'running',
            'command': ['npm', 'run', 'build'],
            'output': 'building...',
          }
          as T;
    }
    if (channel == 'background-terminal:stop') {
      return {'stopped': true} as T;
    }
    if (channel == 'git:list-commit-model-options') {
      return {'options': [], 'savedCandidateModelId': 'auto'} as T;
    }
    if (channel == 'git:generate-commit-message') {
      return {
            'message': 'feat: compose orchestration',
            'candidateModelId': 'candidate_1',
            'modelId': 'model_1',
            'providerName': 'Provider',
          }
          as T;
    }
    if (channel == 'git:commit') {
      return {
            'commitSha': 'abc123',
            'message': 'feat: compose orchestration',
            'generated': false,
          }
          as T;
    }
    if (channel.startsWith('project-orchestration-settings:')) {
      return {
            'workspacePath': '/repo',
            'orchestrationSelection': {
              'mainAgentConfigId': 'main_1',
              'mainPrompt': {'mode': 'builtin'},
              'subagents': {'mode': 'none'},
            },
          }
          as T;
    }
    return {
          'thread': {
            'threadId': 'thr_1',
            'status': 'running',
            'generatedAt': '2026-01-01T00:00:00.000Z',
          },
          'agents': [],
          'timeline': [],
          'requestSpans': [],
          'sourceEventCount': 1,
        }
        as T;
  }
}
