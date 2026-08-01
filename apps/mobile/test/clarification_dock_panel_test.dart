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

  testWidgets('clarification options shrink for short content', (tester) async {
    await tester.pumpWidget(
      _LocalizedTestApp(
        child: ClarificationDockPanel(
          request: const ClarificationRequest(
            toolUseId: 'tool-short',
            threadId: 'thread-1',
            questions: [
              ClarificationQuestion(
                question: 'Choose one',
                options: [ClarificationQuestionOption(label: 'Only option')],
              ),
            ],
          ),
          busy: false,
          onSubmit: (_) async {},
          onDismiss: () async {},
        ),
      ),
    );

    final optionsHeight = tester
        .getSize(find.byKey(const Key('clarification-options-scroll')))
        .height;
    expect(optionsHeight, lessThan(80));
  });

  testWidgets('clarification dock uses a borderless composer-style surface', (
    tester,
  ) async {
    await tester.pumpWidget(
      _LocalizedTestApp(
        child: ClarificationDockPanel(
          request: const ClarificationRequest(
            toolUseId: 'tool-surface',
            threadId: 'thread-1',
            questions: [
              ClarificationQuestion(
                question: 'Choose one',
                options: [ClarificationQuestionOption(label: 'Only option')],
              ),
            ],
          ),
          busy: false,
          onSubmit: (_) async {},
          onDismiss: () async {},
        ),
      ),
    );

    final surface = tester.widget<DecoratedBox>(
      find.byKey(const Key('clarification-dock-surface')),
    );
    final decoration = surface.decoration as BoxDecoration;

    expect(decoration.border, isNull);
    expect(decoration.borderRadius, BorderRadius.circular(24));
    expect(find.byType(BackdropFilter), findsOneWidget);
  });

  testWidgets('clarification options scroll within the viewport cap', (
    tester,
  ) async {
    await tester.pumpWidget(
      _LocalizedTestApp(
        child: ClarificationDockPanel(
          request: ClarificationRequest(
            toolUseId: 'tool-long',
            threadId: 'thread-1',
            questions: [
              ClarificationQuestion(
                question: 'Choose one',
                options: [
                  for (var index = 0; index < 12; index++)
                    ClarificationQuestionOption(label: 'Option $index'),
                ],
              ),
            ],
          ),
          busy: false,
          onSubmit: (_) async {},
          onDismiss: () async {},
        ),
      ),
    );

    final optionsHeight = tester
        .getSize(find.byKey(const Key('clarification-options-scroll')))
        .height;
    final contentHeight = tester
        .getSize(find.byKey(const Key('clarification-options-content')))
        .height;
    expect(optionsHeight, lessThanOrEqualTo(800 * 0.30));
    expect(contentHeight, greaterThan(optionsHeight));
  });

  testWidgets('clarification dock caps its height on a narrow viewport', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(360, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _LocalizedTestApp(
        child: ClarificationDockPanel(
          request: ClarificationRequest(
            toolUseId: 'tool-compact',
            threadId: 'thread-1',
            questions: [
              ClarificationQuestion(
                question:
                    'Mobile clients connecting directly to the service need a secure API key delivery flow. Which approach should be used?',
                header:
                    'Choose the approach that matches the project security requirements.',
                options: [
                  for (var index = 0; index < 5; index++)
                    ClarificationQuestionOption(
                      label: 'Option $index with a long descriptive title',
                      description:
                          'This explanatory text is intentionally long to verify that the option layout remains contained on a narrow screen.',
                      recommended: index == 0,
                    ),
                ],
              ),
            ],
          ),
          busy: false,
          onSubmit: (_) async {},
          onDismiss: () async {},
        ),
      ),
    );

    expect(
      tester.getSize(find.byKey(const Key('clarification-dock-panel'))).height,
      lessThanOrEqualTo(640 * 0.58),
    );
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
