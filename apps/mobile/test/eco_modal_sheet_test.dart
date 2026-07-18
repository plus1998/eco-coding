import 'package:eco_mobile/core/widgets/eco_modal_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows sheet snackbars above the modal route', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showEcoModalBottomSheet<void>(
                context: context,
                builder: (sheetContext) => Center(
                  child: TextButton(
                    onPressed: () => ScaffoldMessenger.of(
                      sheetContext,
                    ).showSnackBar(const SnackBar(content: Text('脚本执行失败'))),
                    child: const Text('触发错误'),
                  ),
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
    await tester.tap(find.text('触发错误'));
    await tester.pump();

    expect(find.text('触发错误'), findsOneWidget);
    expect(find.text('脚本执行失败'), findsOneWidget);
    expect(
      tester.widgetList<ScaffoldMessenger>(find.byType(ScaffoldMessenger)),
      hasLength(2),
    );
  });
}
