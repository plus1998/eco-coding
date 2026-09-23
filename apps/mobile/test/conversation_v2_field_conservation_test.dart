import 'dart:convert';
import 'dart:io';

import 'package:eco_mobile/core/models/conversation_v2_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('agent upsert is supported and conserves all lifecycle fields', () {
    final agent = <String, dynamic>{
      'agentId': 'instance',
      'conversationId': 'conversation',
      'role': 'subagent',
      'kind': 'worker',
      'status': 'completed',
      'runId': 'run',
      'parentAgentInstanceId': 'parent',
      'parentToolCallId': 'parent-tool',
      'startedAt': 'start',
      'endedAt': 'end',
      'mission': '',
      'taskName': 'task',
      'delegationSummary': 'summary',
      'delegationPrompt': 'prompt',
      'todoId': 'todo',
      'versionSeq': 2,
    };
    expect(conversationV2SupportedEffectTypes, contains('agent.upsert'));
    expect(ConversationV2Agent.fromJson(agent).toJson(), agent);
  });
  test('detail conserves every field including empty content and ref', () {
    final wire = <String, dynamic>{
      'itemId': 'item',
      'conversationId': 'conversation',
      'runId': 'run',
      'agentId': 'agent',
      'agentInstanceId': 'instance',
      'parentAgentInstanceId': 'parent-instance',
      'parentAgentId': 'parent-agent',
      'parentToolCallId': 'parent-tool',
      'toolCallId': 'tool',
      'type': 'tool.output',
      'createdSeq': 1,
      'versionSeq': 2,
      'content': '',
      'ref': '',
    };
    expect(ConversationV2Detail.fromJson(wire).toJson(), wire);
    expect(
      ConversationV2Detail.fromJson(jsonDecode(jsonEncode(wire))).toJson(),
      wire,
    );
    wire.remove('content');
    wire.remove('ref');
    expect(ConversationV2Detail.fromJson(wire).toJson(), wire);
  });
  final directory = Directory(
    '../desktop/test/fixtures/feed-parity/v2-bootstrap',
  );
  final files = directory
      .listSync()
      .whereType<File>()
      .where((file) => file.path.endsWith('.json'))
      .toList();

  test('field conservation uses every shared bootstrap fixture', () {
    expect(files, isNotEmpty);
  });

  for (final file in files) {
    test(
      '${file.uri.pathSegments.last}: cache serialization conserves wire fields',
      () {
        final wire =
            jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
        final decoders = <String, Map<String, dynamic> Function(dynamic)>{
          'messages': (row) =>
              ConversationV2Message.fromJson(row).copyWith().toJson(),
          'runs': (row) => ConversationV2Run.fromJson(row).toJson(),
          'tools': (row) => ConversationV2Tool.fromJson(row).toJson(),
          'agents': (row) => ConversationV2Agent.fromJson(row).toJson(),
        };
        for (final entry in decoders.entries) {
          for (final row in wire[entry.key] as List<dynamic>) {
            final encoded = entry.value(row);
            expect(encoded, row, reason: '${entry.key}: full wire object');
            expect(
              entry.value(jsonDecode(jsonEncode(encoded))),
              row,
              reason: '${entry.key}: durable cache round trip',
            );
          }
        }
      },
    );
  }
}
