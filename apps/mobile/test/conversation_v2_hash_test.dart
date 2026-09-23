import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/conversation_v2_hash.dart';

void main() {
  test('matches the TypeScript V2 canonical JSON and hash vectors', () {
    expect(conversationV2StableJson({'b': 1, 'a': 'x'}), '{"a":"x","b":1}');
    expect(conversationV2StableHash({'b': 1, 'a': 'x'}), 'f7b213ed');
    expect(
      conversationV2StableHash({
        'type': 'message.append',
        'messageId': 'message_1',
        'baseContentVersion': 0,
        'nextContentVersion': 1,
        'delta': ' world',
        'versionSeq': 2,
      }),
      '136ec09d',
    );
    expect(
      conversationV2StableHash({'text': '😀', 'value': 1.0}),
      conversationV2StableHash({'value': 1, 'text': '😀'}),
    );
  });
}
