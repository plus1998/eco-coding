import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/stream_text.dart';

void main() {
  test('mergeStreamText handles cumulative snapshots', () {
    expect(mergeStreamText('hel', 'lo'), 'hello');
    expect(mergeStreamText('No', 'No markdown'), 'No markdown');
  });

  test('shouldMergeThinkingBlocks merges overlapping chunks', () {
    expect(
      shouldMergeThinkingBlocks('first pass', 'first pass extended'),
      isTrue,
    );
    expect(
      mergeThinkingBlocks('first pass', 'first pass extended'),
      'first pass extended',
    );
  });

  test('thinkingPreviewLine strips markdown noise', () {
    expect(
      thinkingPreviewLine('**Bold** intro\n\nmore text'),
      'Bold intro more text',
    );
  });
}
