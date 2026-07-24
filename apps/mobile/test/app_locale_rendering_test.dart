import 'package:eco_mobile/core/locale/app_localizations_ext.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders Chinese and switches live to English', (tester) async {
    await tester.pumpWidget(const _LocaleHarness());

    expect(find.text('设置'), findsOneWidget);
    expect(find.text('简体中文'), findsOneWidget);

    await tester.tap(find.byKey(const Key('switch-locale')));
    await tester.pumpAndSettle();

    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('设置'), findsNothing);
  });
}

class _LocaleHarness extends StatefulWidget {
  const _LocaleHarness();

  @override
  State<_LocaleHarness> createState() => _LocaleHarnessState();
}

class _LocaleHarnessState extends State<_LocaleHarness> {
  Locale _locale = const Locale('zh', 'CN');

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: _locale,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Builder(
        builder: (context) => Scaffold(
          body: Column(
            children: [
              Text(context.l10n.settingsTitle),
              Text(
                _locale.languageCode == 'zh'
                    ? context.l10n.settingsLanguageChinese
                    : context.l10n.settingsLanguageEnglish,
              ),
              TextButton(
                key: const Key('switch-locale'),
                onPressed: () {
                  setState(() => _locale = const Locale('en', 'US'));
                },
                child: const Text('switch'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
