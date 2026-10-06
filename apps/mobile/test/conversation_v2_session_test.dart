import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/conversation_v2_models.dart';
import 'package:eco_mobile/core/sync/conversation_v2_session.dart';

ConversationV2Detail detail({
  required String itemId,
  required String type,
  required int sequence,
  required String toolCallId,
  required Map<String, dynamic> payload,
}) => ConversationV2Detail(
  itemId: itemId,
  conversationId: 'thread_v2',
  runId: 'run_1',
  toolCallId: toolCallId,
  type: type,
  createdSeq: sequence,
  versionSeq: sequence,
  content: jsonEncode(payload),
);

void main() {
  test(
    'resolves V2 approval and clarification details into mobile requests',
    () {
      final pending = resolveConversationV2PendingInteractions('thread_v2', [
        detail(
          itemId: 'bash_requested',
          type: 'approval.requested',
          sequence: 1,
          toolCallId: 'bash_1',
          payload: {
            'liveType': 'bash_approval.requested',
            'bashApproval': {
              'toolUseId': 'bash_1',
              'command': 'bun test',
              'cwd': '/workspace',
              'reason': 'Run tests',
              'riskScore': 1,
              'riskLevel': 'low',
            },
          },
        ),
        detail(
          itemId: 'question_requested',
          type: 'clarification.requested',
          sequence: 2,
          toolCallId: 'question_1',
          payload: {
            'liveType': 'clarification.requested',
            'clarification': {
              'toolUseId': 'question_1',
              'questions': [
                {
                  'question': 'Which file?',
                  'options': [
                    {'label': 'app.dart'},
                  ],
                },
              ],
            },
          },
        ),
      ]);

      expect(pending.bash?.command, 'bun test');
      expect(pending.clarification?.questions.single.question, 'Which file?');
    },
  );

  test(
    'resolved V2 interaction details do not resurrect a legacy pending row',
    () {
      final pending = resolveConversationV2PendingInteractions('thread_v2', [
        detail(
          itemId: 'plan_requested',
          type: 'approval.requested',
          sequence: 1,
          toolCallId: 'plan_1',
          payload: {
            'liveType': 'plan_approval.requested',
            'plan': {
              'userPrompt': 'Build the feature',
              'analysis': 'Need a plan',
              'plan': '1. Implement it',
            },
            'planApproval': {
              'toolUseId': 'plan_1',
              'userPrompt': 'Build the feature',
              'analysis': 'Need a plan',
              'plan': '1. Implement it',
            },
          },
        ),
        detail(
          itemId: 'plan_resolved',
          type: 'approval.resolved',
          sequence: 2,
          toolCallId: 'plan_1',
          payload: {'liveType': 'plan_approval.approved'},
        ),
      ]);

      expect(pending.plan, isNull);
    },
  );
}
