import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_usage_models.dart';
import 'package:eco_mobile/core/theme/eco_icons.dart';
import 'package:eco_mobile/features/composer/composer_controls.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const runtimeConfig = ThreadRuntimeConfig(
    subagentEnabled: {},
    sessionMode: 'agent',
    bashReviewMode: 'always',
  );
  const billing = ThreadBillingSnapshot(
    plannerTokenCostUsd: 0.2,
    ecoCostUsd: 0.1,
    savedUsd: 0.1,
    savedPct: 50,
    pricingResolved: true,
  );

  testWidgets('composer shows billing beside usage controls and opens sheet', (
    tester,
  ) async {
    await tester.pumpWidget(
      _TestApp(
        child: ComposerRouteSummary(
          runtimeConfig: runtimeConfig,
          threadId: 'thread-1',
          canEdit: true,
          onChanged: (_) {},
          billing: billing,
          showBilling: true,
          threadStatus: 'idle',
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(EcoIcons.usageCost), findsOneWidget);

    await tester.tap(find.byIcon(EcoIcons.usageCost));
    await tester.pumpAndSettle();

    expect(find.text('Billing'), findsOneWidget);
    expect(find.text(r'$0.100'), findsWidgets);
  });

  testWidgets('composer hides billing before the session has activity', (
    tester,
  ) async {
    await tester.pumpWidget(
      _TestApp(
        child: ComposerRouteSummary(
          runtimeConfig: runtimeConfig,
          threadId: 'thread-1',
          canEdit: true,
          onChanged: (_) {},
          billing: billing,
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(EcoIcons.usageCost), findsNothing);
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [modelSettingsProvider.overrideWith((ref) async => null)],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: Center(child: child)),
      ),
    );
  }
}
