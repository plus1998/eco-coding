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

  test(
    'splitThinkingCarouselLines prefers newlines and sentence boundaries over camelCase',
    () {
      expect(
        splitThinkingCarouselLines(
          'Planning summary placement after tool outputs\nRefining summary and tool collapse logic',
        ),
        [
          'Planning summary placement after tool outputs',
          'Refining summary and tool collapse logic',
        ],
      );
      expect(splitThinkingCarouselLines('先定位事件合并。再检查 Feed 投影。'), [
        '先定位事件合并。',
        '再检查 Feed 投影。',
      ]);
      expect(splitThinkingCarouselLines('Done.Next stage starts'), [
        'Done.',
        'Next stage starts',
      ]);
      // No camelCase heuristic — glued TitleCase without punctuation stays one stage.
      expect(
        splitThinkingCarouselLines(
          'Planning summary placement after tool outputsRefining summary and tool collapse logic',
        ),
        [
          'Planning summary placement after tool outputsRefining summary and tool collapse logic',
        ],
      );
      expect(splitThinkingCarouselLines('HTTPServer remains one stage'), [
        'HTTPServer remains one stage',
      ]);
      expect(splitThinkingCarouselLines('Ship iPhone build next'), [
        'Ship iPhone build next',
      ]);
    },
  );

  test('reasoningSummaryLabel separates adjacent bold summary stage titles', () {
    expect(
      reasoningSummaryLabel(
        '**Planning ordered file reading****Confirming path**',
      ),
      'Planning ordered file reading\nConfirming path',
    );
    expect(
      reasoningSummaryLabel(
        '**Planning ordered file reading**\n**Confirming path**',
      ),
      'Planning ordered file reading\nConfirming path',
    );
  });

  test('formatDurationMs omits decimal seconds after one minute', () {
    expect(formatDurationMs(103000), '1m 43s');
    expect(formatDurationMs(60000), '1m');
    expect(formatDurationMs(4500), '4.5s');
  });
}
