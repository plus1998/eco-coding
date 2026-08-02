import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:eco_mobile/core/models/thread_usage_models.dart';
import 'package:eco_mobile/core/theme/eco_icons.dart';
import 'package:eco_mobile/features/composer/composer_context_ring.dart';
import 'package:eco_mobile/features/composer/composer_controls.dart';
import 'package:eco_mobile/features/composer/session_composer.dart';
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
    mainAgentModelOverride: MainAgentModelOverride(
      providerId: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4',
    ),
  );
  const billing = ThreadBillingSnapshot(
    plannerTokenCostUsd: 0.2,
    ecoCostUsd: 0.1,
    savedUsd: 0,
    savedPct: 0,
    pricingResolved: true,
    plannerModelLabel: 'gpt-5.5 · OpenAI',
    inputTokens: 100,
    cacheReadTokens: 300,
    cacheCreationTokens: 100,
  );
  const modelProvider = ModelProviderView(
    id: 'provider-1',
    name: 'OpenAI',
    defaultModel: 'gpt-5.6-sol',
    enabled: true,
  );
  const templateModel = OrchestrationModelRef(
    providerId: 'provider-1',
    modelId: 'gpt-5.6-sol',
    thinkingEffort: 'high',
    candidateModelId: 'candidate-sol',
  );
  const resolvedSnapshot = ResolvedOrchestrationSnapshot(
    selection: OrchestrationSelection(
      mainAgentConfigId: 'main-1',
      mainPrompt: BuiltinMainAgentPromptSelection(),
      subagents: NoneSubagentSelection(),
    ),
    mainAgentConfigName: 'Coding',
    mainPromptDisplayName: 'Built in',
    mainAgent: MainAgentConfig(
      agentKey: 'main',
      name: 'Coding',
      systemPromptPreset: 'core_native',
      prompt: '',
      modelRef: templateModel,
      tools: ToolPolicy(),
    ),
    agents: [],
    strategy: OrchestrationStrategy(kind: 'autonomous'),
    resolvedAt: '2026-08-01T00:00:00.000Z',
  );
  const modelRuntimeConfig = ThreadRuntimeConfig(
    resolvedOrchestrationSnapshot: resolvedSnapshot,
    subagentEnabled: {},
    sessionMode: 'agent',
    bashReviewMode: 'always',
  );
  const modelSettings = ModelSettingsSnapshot(
    mainAgentConfigs: [],
    providers: [modelProvider],
  );
  const candidates = [
    CandidateModelView(
      id: 'candidate-sol',
      providerId: 'provider-1',
      modelId: 'gpt-5.6-sol',
      displayName: 'Solution',
      resolvedSupportsReasoning: true,
    ),
    CandidateModelView(
      id: 'candidate-fast',
      providerId: 'provider-1',
      modelId: 'gpt-5.6-fast',
      displayName: 'Fast',
      resolvedSupportsReasoning: true,
    ),
  ];

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
          threadStatus: 'idle',
          contextSnapshot: const ThreadContextSnapshot(
            occupied: 20,
            limit: 100,
            occupancyPct: 20,
            limitsResolved: true,
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(ComposerContextRing), findsOneWidget);

    await tester.tap(find.byType(ComposerContextRing));
    await tester.pumpAndSettle();

    expect(find.text('Context'), findsWidgets);
    expect(find.text('Billing'), findsWidgets);

    await tester.tap(find.text('Billing').last);
    await tester.pumpAndSettle();

    expect(find.text(r'$0.100'), findsOneWidget);
    expect(find.text('COST COMPARISON'), findsNothing);
    expect(find.text('Estimated at claude-sonnet-4 rates'), findsNothing);
    expect(find.text('gpt-5.5'), findsNothing);
    expect(find.text('Savings'), findsNothing);
    expect(find.text('Cache hit rate'), findsOneWidget);
    expect(find.text('60%'), findsOneWidget);
  });

  testWidgets('composer shows cost comparison only when savings are positive', (
    tester,
  ) async {
    const savedBilling = ThreadBillingSnapshot(
      plannerTokenCostUsd: 0.2,
      ecoCostUsd: 0.1,
      savedUsd: 0.1,
      savedPct: 50,
      pricingResolved: true,
      plannerModelLabel: 'gpt-5.5 · OpenAI',
    );
    await tester.pumpWidget(
      _TestApp(
        child: ComposerRouteSummary(
          runtimeConfig: runtimeConfig,
          threadId: 'thread-1',
          canEdit: true,
          onChanged: (_) {},
          billing: savedBilling,
          threadStatus: 'idle',
          contextSnapshot: const ThreadContextSnapshot(
            occupied: 20,
            limit: 100,
            occupancyPct: 20,
            limitsResolved: true,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byType(ComposerContextRing));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Billing').last);
    await tester.pumpAndSettle();

    expect(find.text('COST COMPARISON'), findsOneWidget);
    expect(find.text('Estimated at claude-sonnet-4 rates'), findsOneWidget);
    expect(find.text('Savings'), findsOneWidget);
  });

  testWidgets('composer hides context controls without a context snapshot', (
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

    expect(find.byType(ComposerContextRing), findsNothing);
  });

  testWidgets('composer hides the orchestration control while a thread runs', (
    tester,
  ) async {
    await tester.pumpWidget(
      _TestApp(
        child: ComposerRouteSummary(
          runtimeConfig: runtimeConfig,
          threadId: 'thread-1',
          canEdit: false,
          showRouteControl: false,
          onChanged: (_) {},
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(EcoIcons.orchestration), findsNothing);
  });

  testWidgets(
    'composer model label sits left of context and switches model and effort',
    (tester) async {
      final changes = <ThreadRuntimeConfigInput>[];
      await tester.pumpWidget(
        _TestApp(
          modelSettings: modelSettings,
          candidates: candidates,
          child: ComposerRouteSummary(
            runtimeConfig: modelRuntimeConfig,
            threadId: 'thread-1',
            canEdit: true,
            showRouteControl: false,
            contextSnapshot: const ThreadContextSnapshot(
              occupied: 20,
              limit: 100,
              occupancyPct: 20,
              limitsResolved: true,
            ),
            onChanged: changes.add,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final modelLabel = find.text('5.6 Sol');
      final contextRing = find.byType(ComposerContextRing);
      expect(modelLabel, findsOneWidget);
      expect(find.text('High'), findsOneWidget);
      expect(find.byIcon(EcoIcons.expandDown), findsNothing);
      expect(
        tester.getCenter(modelLabel).dx,
        lessThan(tester.getCenter(contextRing).dx),
      );

      await tester.tap(modelLabel);
      await tester.pumpAndSettle();
      expect(find.text('Model'), findsOneWidget);
      expect(find.text('Reasoning'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('composer-cascade-glass')),
        findsOneWidget,
      );

      await tester.tap(find.text('Model'));
      await tester.pumpAndSettle();
      expect(find.text('Solution'), findsOneWidget);
      expect(find.text('Fast'), findsOneWidget);

      await tester.tap(find.text('Fast'));
      await tester.pumpAndSettle();
      expect(changes, hasLength(1));
      expect(changes.single.mainAgentModelOverride?.modelId, 'gpt-5.6-fast');
      expect(changes.single.mainAgentModelOverride?.thinkingEffort, 'high');

      await tester.pumpWidget(
        _TestApp(
          modelSettings: modelSettings,
          candidates: candidates,
          child: ComposerRouteSummary(
            runtimeConfig: modelRuntimeConfig,
            threadId: 'thread-1',
            canEdit: true,
            showRouteControl: false,
            onChanged: changes.add,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(modelLabel);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reasoning'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Low'));
      await tester.pumpAndSettle();

      expect(changes, hasLength(2));
      expect(changes.last.mainAgentModelOverride?.modelId, 'gpt-5.6-sol');
      expect(changes.last.mainAgentModelOverride?.thinkingEffort, 'low');
    },
  );

  testWidgets(
    'session composer keeps model and context controls on narrow screens',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        _TestApp(
          modelSettings: modelSettings,
          candidates: candidates,
          child: SessionComposer(
            controller: controller,
            attachments: const [],
            runtimeConfig: modelRuntimeConfig,
            threadId: 'thread-1',
            isRunning: false,
            hasActivity: true,
            contextSnapshot: const ThreadContextSnapshot(
              occupied: 20,
              limit: 100,
              occupancyPct: 20,
              limitsResolved: true,
            ),
            onPickImage: () {},
            onRemoveAttachment: (_) {},
            onSend: () {},
            onStop: () {},
            onRuntimeConfigChanged: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('5.6 Sol'), findsOneWidget);
      expect(find.byType(ComposerContextRing), findsOneWidget);
    },
  );

  testWidgets(
    'context sheet dual titles switch pages and show main agent card',
    (tester) async {
      await tester.pumpWidget(
        _TestApp(
          modelSettings: modelSettings,
          candidates: candidates,
          child: ComposerRouteSummary(
            runtimeConfig: modelRuntimeConfig,
            threadId: 'thread-1',
            canEdit: true,
            showRouteControl: false,
            billing: billing,
            threadStatus: 'idle',
            contextSnapshot: const ThreadContextSnapshot(
              occupied: 42_000,
              limit: 200_000,
              occupancyPct: 21,
              limitsResolved: true,
              modelId: 'anthropic/claude-sonnet-4',
            ),
            onChanged: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(ComposerContextRing));
      await tester.pumpAndSettle();

      expect(find.text('Context'), findsWidgets);
      expect(find.text('Billing'), findsWidgets);
      expect(find.text('Coding'), findsOneWidget);
      expect(find.text('claude-sonnet-4'), findsOneWidget);
      expect(find.text('21% used'), findsOneWidget);

      await tester.tap(find.text('Billing').last);
      await tester.pumpAndSettle();

      expect(find.text(r'$0.100'), findsOneWidget);
      expect(find.text('Cache hit rate'), findsOneWidget);
      expect(find.text('Coding'), findsNothing);
      expect(find.text('21% used'), findsNothing);
    },
  );
}

class _TestApp extends StatelessWidget {
  const _TestApp({
    required this.child,
    this.modelSettings,
    this.candidates = const [],
  });

  final Widget child;
  final ModelSettingsSnapshot? modelSettings;
  final List<CandidateModelView> candidates;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        modelSettingsProvider.overrideWith((ref) async => modelSettings),
        candidateModelsProvider(
          'provider-1',
        ).overrideWith((ref) async => candidates),
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
