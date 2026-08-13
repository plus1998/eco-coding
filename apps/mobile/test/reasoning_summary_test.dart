import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/thread_run_projection.dart';
import 'package:eco_mobile/core/utils/reasoning_summary.dart';

ThreadRunProjectionTimelineItem _item({
  required String id,
  required String eventType,
  String text = '',
  String? streamKey,
  Map<String, dynamic>? metadata,
  int sequence = 1,
}) {
  return ThreadRunProjectionTimelineItem(
    id: id,
    sequence: sequence,
    eventType: eventType,
    scope: 'main',
    role: eventType.startsWith('thinking.') ? 'thinking' : 'tool',
    text: text,
    at: '2026-01-01T00:00:0$sequence.000Z',
    streamKey: streamKey,
    metadata: metadata,
  );
}

void main() {
  test('isReasoningSummaryItem requires summary stamp and non-empty text', () {
    expect(
      isReasoningSummaryItem(
        _item(
          id: 'empty',
          eventType: 'thinking.final',
          metadata: const {'reasoningDisplay': 'summary'},
        ),
      ),
      isFalse,
    );
    expect(
      isReasoningSummaryItem(
        _item(
          id: 'raw',
          eventType: 'thinking.final',
          text: 'raw chain of thought',
          metadata: const {'reasoningDisplay': 'raw'},
        ),
      ),
      isFalse,
    );
    expect(
      isReasoningSummaryItem(
        _item(
          id: 'summary',
          eventType: 'thinking.final',
          text: '定位入口',
          metadata: const {'reasoningDisplay': 'summary'},
        ),
      ),
      isTrue,
    );
    expect(
      isReasoningSummaryItem(
        _item(
          id: 'method',
          eventType: 'thinking.delta',
          text: '检查测试',
          metadata: const {'codexMethod': 'item/reasoning/summaryTextDelta'},
        ),
      ),
      isTrue,
    );
  });

  test(
    'collapse keeps only the latest tip after the last superseding event',
    () {
      final collapsed = collapseEphemeralReasoningSummaryTimeline([
        _item(
          id: 'stage-1',
          eventType: 'thinking.final',
          text: '定位入口',
          streamKey: 'rs_1',
          metadata: const {'reasoningDisplay': 'summary'},
        ),
        _item(
          id: 'bash-1',
          eventType: 'tool.started',
          text: 'Tool: Bash · ls',
          sequence: 2,
        ),
        _item(
          id: 'stage-2',
          eventType: 'thinking.delta',
          text: '检查测试',
          streamKey: 'rs_2',
          sequence: 3,
          metadata: const {'reasoningDisplay': 'summary'},
        ),
      ]);

      expect(collapsed.map((item) => item.id), ['bash-1', 'stage-2']);
    },
  );

  test('empty terminal thinking does not supersede a reasoning summary', () {
    final collapsed = collapseEphemeralReasoningSummaryTimeline([
      _item(
        id: 'stage-1',
        eventType: 'thinking.final',
        text: '定位入口',
        streamKey: 'rs_1',
        metadata: const {'reasoningDisplay': 'summary'},
      ),
      _item(id: 'empty', eventType: 'thinking.final', sequence: 2),
    ]);

    expect(collapsed.map((item) => item.id), ['stage-1', 'empty']);
  });

  test('raw thinking supersedes a reasoning summary', () {
    final collapsed = collapseEphemeralReasoningSummaryTimeline([
      _item(
        id: 'stage-1',
        eventType: 'thinking.final',
        text: '定位入口',
        streamKey: 'rs_1',
        metadata: const {'reasoningDisplay': 'summary'},
      ),
      _item(
        id: 'raw-1',
        eventType: 'thinking.final',
        text: 'raw chain of thought',
        sequence: 2,
        metadata: const {'reasoningDisplay': 'raw'},
      ),
    ]);

    expect(collapsed.map((item) => item.id), ['raw-1']);
  });
}
