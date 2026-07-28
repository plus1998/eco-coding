import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/features/approvals/approval_sheets.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('clarification option preserves description from JSON', () {
    final option = ClarificationQuestionOption.fromJson({
      'label': 'Use workspace defaults',
      'description': 'Keeps the current project configuration.',
      'recommended': true,
    });

    expect(option.description, 'Keeps the current project configuration.');
    expect(option.recommended, isTrue);
  });

  testWidgets('clarification dock pages questions and submits selections', (
    tester,
  ) async {
    List<List<String>>? submitted;
    const request = ClarificationRequest(
      toolUseId: 'tool-1',
      threadId: 'thread-1',
      questions: [
        ClarificationQuestion(
          question: 'Choose an implementation',
          options: [
            ClarificationQuestionOption(
              label: 'Use workspace defaults (Recommended)',
              description: 'Keeps the current project configuration.',
              recommended: true,
            ),
            ClarificationQuestionOption(label: 'Use custom settings'),
          ],
        ),
        ClarificationQuestion(
          question: 'Choose a validation level',
          options: [
            ClarificationQuestionOption(label: 'Focused tests'),
            ClarificationQuestionOption(label: 'Full test suite'),
          ],
        ),
      ],
    );

    await tester.pumpWidget(
      _LocalizedTestApp(
        child: ClarificationDockPanel(
          request: request,
          busy: false,
          onSubmit: (selections) async {
            submitted = selections;
          },
          onDismiss: () async {},
        ),
      ),
    );

    expect(find.text('Choose an implementation'), findsOneWidget);
    expect(find.text('Recommended'), findsOneWidget);
    expect(
      find.text('Keeps the current project configuration.'),
      findsOneWidget,
    );
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.tap(find.text('Use custom settings'));
    await tester.pump();

    expect(find.text('Choose a validation level'), findsOneWidget);
    expect(find.text('2 / 2'), findsOneWidget);

    await tester.tap(find.text('Focused tests'));
    await tester.pump();
    await tester.tap(find.text('Submit'));
    await tester.pump();

    expect(submitted, [
      ['Use custom settings'],
      ['Focused tests'],
    ]);
  });

  testWidgets('multi-select question waits for completion', (tester) async {
    const request = ClarificationRequest(
      toolUseId: 'tool-2',
      threadId: 'thread-1',
      questions: [
        ClarificationQuestion(
          question: 'Select checks',
          multiSelect: true,
          options: [
            ClarificationQuestionOption(label: 'Analyze'),
            ClarificationQuestionOption(label: 'Test'),
          ],
        ),
        ClarificationQuestion(
          question: 'Confirm scope',
          options: [ClarificationQuestionOption(label: 'Current package')],
        ),
      ],
    );

    await tester.pumpWidget(
      _LocalizedTestApp(
        child: ClarificationDockPanel(
          request: request,
          busy: false,
          onSubmit: (_) async {},
          onDismiss: () async {},
        ),
      ),
    );

    expect(find.text('Complete selection'), findsOneWidget);
    final completeButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Complete selection'),
    );
    expect(completeButton.onPressed, isNull);

    await tester.tap(find.text('Analyze'));
    await tester.pump();

    final enabledButton = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Complete selection'),
    );
    expect(enabledButton.onPressed, isNotNull);

    await tester.tap(find.text('Complete selection'));
    await tester.pump();
    expect(find.text('Confirm scope'), findsOneWidget);
  });
}

class _LocalizedTestApp extends StatelessWidget {
  const _LocalizedTestApp({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Align(alignment: Alignment.bottomCenter, child: child),
      ),
    );
  }
}
