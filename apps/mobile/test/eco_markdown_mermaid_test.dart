import 'package:eco_mobile/core/theme/eco_theme.dart';
import 'package:eco_mobile/core/utils/mermaid_fence.dart';
import 'package:eco_mobile/core/widgets/eco_markdown.dart';
import 'package:eco_mobile/core/widgets/eco_markdown_table.dart';
import 'package:eco_mobile/core/widgets/eco_mermaid_block.dart';
import 'package:eco_mobile/core/theme/eco_icons.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdown/markdown.dart' as md;

void main() {
  setUp(() {
    EcoMermaidBlock.useWebView = false;
  });

  tearDown(() {
    EcoMermaidBlock.useWebView = true;
  });

  test('isMermaidCodeClass matches language-mermaid', () {
    expect(isMermaidCodeClass('language-mermaid'), isTrue);
    expect(isMermaidCodeClass('language-Mermaid'), isTrue);
    expect(isMermaidCodeClass('language-ts'), isFalse);
    expect(isMermaidCodeClass(null), isFalse);
  });

  test('isMermaidPreElement detects fenced mermaid blocks', () {
    final nodes = md.Document(encodeHtml: false).parse('''
```mermaid
graph TD
  A-->B
```
''');
    final pre = nodes.whereType<md.Element>().firstWhere((e) => e.tag == 'pre');
    expect(isMermaidPreElement(pre), isTrue);
    expect(extractFencedCodeText(pre), contains('A-->B'));
  });

  testWidgets('EcoMarkdown renders EcoMermaidBlock for mermaid fences', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: SingleChildScrollView(
            child: EcoMarkdown(
              text: '''
```mermaid
graph TD
  A-->B
```
''',
            ),
          ),
        ),
      ),
    );

    expect(find.byType(EcoMermaidBlock), findsOneWidget);
    expect(find.textContaining('A-->B'), findsOneWidget);
  });

  testWidgets('EcoMarkdown keeps normal code fences as text', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: SingleChildScrollView(
            child: EcoMarkdown(
              text: '''
```ts
const x = 1
```
''',
            ),
          ),
        ),
      ),
    );

    expect(find.byType(EcoMermaidBlock), findsNothing);
    expect(find.textContaining('const x = 1'), findsOneWidget);
  });

  testWidgets('EcoMarkdown wide tables scroll horizontally', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: SingleChildScrollView(
            child: EcoMarkdown(
              text: '''
| VeryLongHeaderAlpha | VeryLongHeaderBeta | VeryLongHeaderGamma | VeryLongHeaderDelta |
| --- | --- | --- | --- |
| a | b | c | d |
''',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('VeryLongHeaderAlpha'), findsOneWidget);
    expect(find.byType(EcoMarkdownTable), findsOneWidget);
    expect(find.byType(SingleChildScrollView), findsWidgets);
    expect(find.byType(Table), findsOneWidget);
  });

  testWidgets('EcoMarkdown table expand opens a dialog', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildEcoDarkTheme(),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: SingleChildScrollView(
            child: EcoMarkdown(
              text: '''
| Name | Value |
| --- | --- |
| alpha | 1 |
''',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(EcoMarkdownTable), findsOneWidget);
    final table = tester.getCenter(find.byType(EcoMarkdownTable));
    final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await gesture.addPointer(location: table);
    addTearDown(gesture.removePointer);
    await tester.pump();
    await gesture.moveTo(table);
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(EcoIcons.expandFullscreen));
    await tester.pumpAndSettle();
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('alpha'), findsWidgets);
  });
}
