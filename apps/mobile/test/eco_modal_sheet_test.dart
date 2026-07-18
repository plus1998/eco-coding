import 'package:eco_mobile/core/widgets/eco_modal_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('keeps modal sheet content at its requested height', (
    tester,
  ) async {
    const sheetKey = Key('sheet-content');
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showEcoModalBottomSheet<void>(
                context: context,
                builder: (_) => const SizedBox(
                  key: sheetKey,
                  height: 200,
                  child: Text('弹窗内容'),
                ),
              ),
              child: const Text('打开弹窗'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开弹窗'));
    await tester.pumpAndSettle();

    expect(tester.getSize(find.byKey(sheetKey)).height, 200);
    expect(
      find.descendant(
        of: find.byKey(sheetKey),
        matching: find.byType(Scaffold),
      ),
      findsNothing,
    );
  });
}
