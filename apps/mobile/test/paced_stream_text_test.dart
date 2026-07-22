import 'package:eco_mobile/core/widgets/paced_stream_text.dart';
import 'package:eco_mobile/core/utils/stream_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Widget app(String text, {required bool streaming}) {
    return MaterialApp(
      home: PacedStreamText(
        key: const ValueKey('stream'),
        text: text,
        streaming: streaming,
        builder: (context, displayText, revealing) =>
            Text(displayText, textDirection: TextDirection.ltr),
      ),
    );
  }

  testWidgets('shows the first batch immediately and paces later batches', (
    tester,
  ) async {
    await tester.pumpWidget(app('', streaming: true));
    await tester.pumpWidget(app('首批', streaming: true));
    expect(find.text('首批'), findsOneWidget);

    await tester.pumpWidget(app('首批这是第二批', streaming: true));
    expect(find.text('首批'), findsOneWidget);

    await tester.pump(pacedStreamInterval);
    expect(find.text('首批这'), findsOneWidget);

    await tester.pump(pacedStreamInterval);
    expect(find.text('首批这是'), findsOneWidget);
  });

  testWidgets('quickly drains remaining text when streaming finishes', (
    tester,
  ) async {
    await tester.pumpWidget(app('开始', streaming: true));
    await tester.pumpWidget(app('开始这是一段等待排空的最终文本', streaming: false));

    expect(find.text('开始'), findsOneWidget);
    for (var index = 0; index < 10; index++) {
      await tester.pump(pacedStreamInterval);
    }
    expect(find.text('开始这是一段等待排空的最终文本'), findsOneWidget);
  });

  testWidgets('ignores a stale shorter streaming snapshot', (tester) async {
    await tester.pumpWidget(app('已经显示的完整内容', streaming: true));
    expect(find.text('已经显示的完整内容'), findsOneWidget);

    await tester.pumpWidget(app('已经显示的', streaming: true));
    await tester.pump(pacedStreamInterval);

    expect(find.text('已经显示的完整内容'), findsOneWidget);
    expect(find.text('已经显示的'), findsNothing);
  });
}
