import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/features/threads/thread_session_layout.dart';

void main() {
  testWidgets('floating composer height offsets feed controls', (tester) async {
    double? feedBottomInset;
    double? controlsBottomInset;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ThreadSessionConversationLayout(
            feedBuilder: (context, feedInset, controlsInset) {
              feedBottomInset = feedInset;
              controlsBottomInset = controlsInset;
              return const SizedBox.expand();
            },
            composer: const SizedBox(height: 80),
            floatingComposer: const SizedBox(height: 40),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(feedBottomInset, 80 + 40 + threadSessionComposerGap);
    expect(controlsBottomInset, 120);
  });

  testWidgets('foreground covers the full conversation viewport', (
    tester,
  ) async {
    const layoutKey = Key('layout');
    const foregroundKey = Key('foreground');

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ThreadSessionConversationLayout(
            key: layoutKey,
            feedBuilder: (context, feedBottomInset, controlsBottomInset) {
              return const SizedBox.expand();
            },
            composer: const SizedBox(height: 80),
            floatingComposer: const SizedBox(height: 40),
            foreground: const ColoredBox(
              key: foregroundKey,
              color: Colors.transparent,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
      tester.getSize(find.byKey(foregroundKey)),
      tester.getSize(find.byKey(layoutKey)),
    );
  });
}
