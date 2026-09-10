import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:eco_mobile/core/locale/app_error_localizations.dart';
import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/features/home/unpair_pc_dialog.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';

Widget _app(Widget home) {
  return MaterialApp(
    locale: const Locale('zh'),
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

void main() {
  testWidgets('unpair password dialog cancels without a password', (tester) async {
    String? result = 'sentinel';
    await tester.pumpWidget(
      _app(
        Builder(
          builder: (context) {
            return Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showUnpairPcPasswordDialog(
                    context,
                    desktopName: 'Eco Win Dev',
                  );
                },
                child: const Text('open'),
              ),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.textContaining('从账号中删除 Eco Win Dev'), findsOneWidget);
    expect(find.byKey(const Key('unpair-pc-password-field')), findsOneWidget);

    await tester.tap(find.byKey(const Key('unpair-pc-cancel')));
    await tester.pumpAndSettle();
    expect(result, isNull);
  });

  testWidgets('unpair password dialog requires a non-empty password', (tester) async {
    await tester.pumpWidget(
      _app(
        Builder(
          builder: (context) {
            return Scaffold(
              body: TextButton(
                onPressed: () {
                  showUnpairPcPasswordDialog(context, desktopName: 'PC-A');
                },
                child: const Text('open'),
              ),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('unpair-pc-confirm')));
    await tester.pump();
    expect(find.text('请输入密码。'), findsOneWidget);
    expect(find.byKey(const Key('unpair-pc-password-field')), findsOneWidget);
  });

  testWidgets('unpair password dialog returns the entered password', (tester) async {
    String? result;
    await tester.pumpWidget(
      _app(
        Builder(
          builder: (context) {
            return Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showUnpairPcPasswordDialog(
                    context,
                    desktopName: 'PC-B',
                  );
                },
                child: const Text('open'),
              ),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('unpair-pc-password-field')),
      'secret-pass',
    );
    await tester.tap(find.byKey(const Key('unpair-pc-confirm')));
    await tester.pumpAndSettle();
    expect(result, 'secret-pass');
  });

  test('invalidCredentials localizes to authInvalidCredentials', () {
    final zh = lookupAppLocalizations(const Locale('zh'));
    final en = lookupAppLocalizations(const Locale('en'));
    final error = EcoCenterException.app(EcoCenterErrorKind.invalidCredentials);
    expect(localizedAppError(error, zh), zh.authInvalidCredentials);
    expect(localizedAppError(error, en), en.authInvalidCredentials);
    expect(zh.setupUnpairPcWrongPassword, contains('密码'));
    expect(en.setupUnpairPcWrongPassword.toLowerCase(), contains('password'));
  });

  testWidgets('unpair password dialog shows initialError', (tester) async {
    await tester.pumpWidget(
      _app(
        const Scaffold(
          body: UnpairPcPasswordDialog(
            desktopName: 'PC-C',
            initialError: '密码不正确，请重试。',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('密码不正确，请重试。'), findsOneWidget);
  });
}
