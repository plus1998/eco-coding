import 'dart:async';

import 'package:eco_mobile/features/threads/thread_attention_sheet.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows loading until attention items are available', (
    tester,
  ) async {
    final itemsCompleter = Completer<List<ThreadAttentionItem>>();
    late Future<ThreadAttentionItem?> sheetFuture;
    const item = ThreadAttentionItem(
      id: 'plan:thread-1',
      threadId: 'thread-1',
      title: '待处理会话',
      kind: ThreadAttentionKind.plan,
      updatedAt: '2026-01-01T00:00:00.000Z',
    );

    await tester.pumpWidget(
      _localizedMaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () {
                sheetFuture = showThreadAttentionSheet(
                  context: context,
                  itemsFuture: itemsCompleter.future,
                );
              },
              child: const Text('打开'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('打开'));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('待处理会话'), findsNothing);

    itemsCompleter.complete([item]);
    await tester.pumpAndSettle();

    expect(find.text('待处理会话'), findsOneWidget);
    await tester.tap(find.text('待处理会话'));
    await tester.pumpAndSettle();

    expect(await sheetFuture, same(item));
  });
}

Widget _localizedMaterialApp({required Widget home}) {
  return MaterialApp(
    locale: const Locale('zh', 'CN'),
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: home,
  );
}
