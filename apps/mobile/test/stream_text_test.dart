import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/stream_text.dart';
import 'package:eco_mobile/core/utils/subagent_session_timing.dart';

void main() {
  test('revealPacedStreamText keeps grapheme clusters intact', () {
    expect(
      revealPacedStreamText('你', '你👍🏽e\u0301好', streaming: true),
      '你👍🏽',
    );
  });

  test('resolvePacedRevealCount accelerates with backlog', () {
    expect(resolvePacedRevealCount(12, streaming: true), 1);
    expect(resolvePacedRevealCount(30, streaming: true), 2);
    expect(resolvePacedRevealCount(80, streaming: true), 4);
    expect(resolvePacedRevealCount(140, streaming: true), 8);
    expect(resolvePacedRevealCount(60, streaming: false), 20);
  });

  test('revealPacedStreamText applies replacements immediately', () {
    expect(revealPacedStreamText('旧输出', '新输出', streaming: true), '新输出');
  });

  test('mergeStreamText handles cumulative snapshots', () {
    expect(mergeStreamText('hel', 'lo'), 'hello');
    expect(mergeStreamText('No', 'No markdown'), 'No markdown');
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
