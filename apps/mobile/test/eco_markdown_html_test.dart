import 'package:eco_mobile/core/theme/eco_theme.dart';
import 'package:eco_mobile/core/utils/html_fence.dart';
import 'package:eco_mobile/core/widgets/eco_html_block.dart';
import 'package:eco_mobile/core/widgets/eco_markdown.dart';
import 'package:eco_mobile/core/widgets/eco_mermaid_block.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:markdown/markdown.dart' as md;

void main() {
  setUp(() {
    EcoMermaidBlock.useWebView = false;
    EcoHtmlBlock.useWebView = false;
  });

  tearDown(() {
    EcoMermaidBlock.useWebView = true;
    EcoHtmlBlock.useWebView = true;
  });

  test('isHtmlCodeClass matches language-html and language-htm', () {
    expect(isHtmlCodeClass('language-html'), isTrue);
    expect(isHtmlCodeClass('language-htm'), isTrue);
    expect(isHtmlCodeClass('language-HTML'), isTrue);
    expect(isHtmlCodeClass('language-ts'), isFalse);
    expect(isHtmlCodeClass(null), isFalse);
  });

  test('extractHtmlDocumentTitle reads title tag', () {
    expect(
      extractHtmlDocumentTitle('<html><title>Demo</title></html>'),
      'Demo',
    );
    expect(extractHtmlDocumentTitle('<div>no title</div>'), isNull);
  });

  test('wrapHtmlForPreview wraps fragments in a document shell', () {
    final wrapped = wrapHtmlForPreview('<h1>Hi</h1>');
    expect(wrapped.toLowerCase(), contains('<html>'));
    expect(wrapped, contains('<h1>Hi</h1>'));
    expect(wrapped, contains('width=device-width'));
    final fullDoc = wrapHtmlForPreview('<!DOCTYPE html><html><body>x</body></html>');
    expect(fullDoc, contains('x'));
    expect(fullDoc, contains('width=device-width'));
  });

  test('isHtmlPreElement detects fenced html blocks', () {
    final nodes = md.Document(encodeHtml: false).parse('''
```html
<html><title>Demo</title><body>Hi</body></html>
```
''');
    final pre = nodes.whereType<md.Element>().firstWhere((e) => e.tag == 'pre');
    expect(isHtmlPreElement(pre), isTrue);
  });

  testWidgets('EcoMarkdown renders EcoHtmlBlock for html fences', (tester) async {
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
```html
<html><title>Demo Page</title><body><h1>Hello</h1></body></html>
```
''',
            ),
          ),
        ),
      ),
    );

    expect(find.byType(EcoHtmlBlock), findsOneWidget);
    expect(find.text('Demo Page'), findsOneWidget);
    expect(find.textContaining('<h1>Hello</h1>'), findsNothing);
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

    expect(find.byType(EcoHtmlBlock), findsNothing);
    expect(find.textContaining('const x = 1'), findsOneWidget);
  });
}
