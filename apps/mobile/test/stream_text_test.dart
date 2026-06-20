import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/stream_text.dart';
import 'package:eco_mobile/core/utils/subagent_session_timing.dart';

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

  test('formatDurationMs omits decimal seconds after one minute', () {
    expect(formatDurationMs(103000), '1m 43s');
    expect(formatDurationMs(60000), '1m');
    expect(formatDurationMs(4500), '4.5s');
  });
}
