import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/acp_host_ui_features.dart';
import 'package:eco_mobile/core/models/thread_usage_models.dart';
import 'package:eco_mobile/features/composer/composer_context_ring.dart';
import 'package:eco_mobile/features/composer/composer_controls.dart';
import 'package:eco_mobile/features/threads/thread_providers.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const billing = ThreadBillingSnapshot(
    plannerTokenCostUsd: 0.2,
    ecoCostUsd: 0.1,
    savedUsd: 0,
    savedPct: 0,
    pricingResolved: true,
    inputTokens: 10,
    outputTokens: 4,
  );

  testWidgets('Composer hides billing ring when the preference is off', (
    tester,
  ) async {
    await tester.pumpWidget(
      _TestApp(
        showBilling: false,
        child: const ComposerRouteSummary(
          runtimeConfig: ThreadRuntimeConfig(
            subagentEnabled: {},
            sessionMode: 'agent',
            bashReviewMode: 'always',
          ),
          threadId: 'thread-1',
          canEdit: false,
          onChanged: _ignoreRuntimeConfigChange,
          billing: billing,
          hostUiFeatures: AcpHostUiFeatures(contextUsage: 'hide'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ComposerContextRing), findsNothing);
  });

  testWidgets('Composer shows billing ring by default', (tester) async {
    await tester.pumpWidget(
      _TestApp(
        child: const ComposerRouteSummary(
          runtimeConfig: ThreadRuntimeConfig(
            subagentEnabled: {},
            sessionMode: 'agent',
            bashReviewMode: 'always',
          ),
          threadId: 'thread-1',
          canEdit: false,
          onChanged: _ignoreRuntimeConfigChange,
          billing: billing,
          hostUiFeatures: AcpHostUiFeatures(contextUsage: 'hide'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ComposerContextRing), findsOneWidget);
  });
}

void _ignoreRuntimeConfigChange(ThreadRuntimeConfigInput _) {}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.child, this.showBilling = true});

  final Widget child;
  final bool showBilling;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        workflowSettingsProvider.overrideWith(
          (ref) async => WorkflowSettingsSnapshot(
            sessionMode: 'agent',
            showBilling: showBilling,
          ),
        ),
      ],
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
