import 'dart:convert';

import 'package:adaptive_platform_ui/adaptive_platform_ui.dart'
    show AdaptiveButton;
import 'package:eco_mobile/app.dart' show EcoApp, appRouterProvider;
import 'package:eco_mobile/core/models/conversation_v2_models.dart'
    show ConversationV2SyncState;
import 'package:eco_mobile/core/models/thread_runtime_config.dart'
    show isThreadRuntimeConfigReady;
import 'package:eco_mobile/core/providers/app_providers.dart'
    show
        credentialsProvider,
        ecoCenterClientProvider,
        selectedDesktopIdProvider;
import 'package:eco_mobile/core/storage/credential_store.dart'
    show CredentialStore;
import 'package:eco_mobile/core/theme/eco_icons.dart' show EcoIcons;
import 'package:eco_mobile/features/home/setup_status.dart'
    show setupOverviewProvider;
import 'package:eco_mobile/features/threads/thread_providers.dart'
    show
        conversationV2CacheProvider,
        conversationV2SessionProvider,
        desktopRpcProvider,
        modelSettingsProvider,
        runtimeConfigProvider,
        threadSessionProvider;
import 'package:eco_mobile/main.dart' as app;
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter/material.dart'
    show InkWell, SnackBar, Text, TextField, ValueKey;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const threadId = String.fromEnvironment('ECO_V2_SMOKE_THREAD_ID');
  const marker = String.fromEnvironment('ECO_V2_SMOKE_MARKER');
  const mobileSendMarker = String.fromEnvironment('ECO_V2_MOBILE_SEND_MARKER');

  testWidgets('paired iOS client syncs V2 and sends one message back to desktop', (
    tester,
  ) async {
    expect(threadId, isNotEmpty, reason: '必须传入真实 DEV 会话 ID');
    expect(marker, isNotEmpty, reason: '必须传入本次冒烟的唯一标记');
    expect(mobileSendMarker, isNotEmpty, reason: '必须传入移动端发送的唯一标记');

    app.main();
    await _pumpUntil(
      tester,
      () => find.byType(EcoApp).evaluate().isNotEmpty,
      '等待移动端启动',
    );

    final scope = ProviderScope.containerOf(
      tester.element(find.byType(EcoApp)),
    );
    final router = scope.read(appRouterProvider);
    router.go('/connect');

    await _pumpUntil(
      tester,
      () => !scope.read(setupOverviewProvider).isBootstrapping,
      '等待移动端恢复已保存的配对凭据和 PC 绑定',
      timeout: const Duration(seconds: 90),
    );
    final overview = scope.read(setupOverviewProvider);
    final credentialsAsync = scope.read(credentialsProvider);
    final persistedCredentials = scope
        .read(ecoCenterClientProvider)
        .credentials;
    final directCredentials = await CredentialStore().load();
    final prefs = await SharedPreferences.getInstance();
    debugPrint(
      'iOS V2 smoke setup: route=${router.routeInformationProvider.value.uri.path}, '
      'bootstrapping=${overview.isBootstrapping}, '
      'setupComplete=${overview.setupComplete}, '
      'selectedDesktop=${overview.selectedDesktopId != null}, '
      'steps=${overview.steps.map((step) => '${step.id}:${step.state.name}').join(',')}',
    );
    debugPrint(
      'iOS V2 smoke credential flags: providerHasValue=${credentialsAsync.hasValue}, '
      'providerHasError=${credentialsAsync.hasError}, '
      'persistedProjectConfig=${persistedCredentials.hasProjectConfig}, '
      'persistedDeviceCredentials=${persistedCredentials.hasDeviceCredentials}, '
      'persistedUserSession=${persistedCredentials.hasUserSession}, '
      'persistedProvisioned=${persistedCredentials.isProvisioned}, '
      'persistedSelectedDesktop=${persistedCredentials.selectedDesktopId?.isNotEmpty == true}, '
      'asyncProjectConfig=${credentialsAsync.valueOrNull?.hasProjectConfig == true}, '
      'asyncDeviceCredentials=${credentialsAsync.valueOrNull?.hasDeviceCredentials == true}, '
      'asyncUserSession=${credentialsAsync.valueOrNull?.hasUserSession == true}, '
      'asyncProvisioned=${credentialsAsync.valueOrNull?.isProvisioned == true}',
    );
    debugPrint(
      'iOS V2 smoke direct-storage flags: '
      'prefsProjectUrl=${prefs.getString('supabase_url')?.isNotEmpty == true}, '
      'prefsSelectedDesktop=${prefs.getString('selected_desktop_id')?.isNotEmpty == true}, '
      'loadedProjectConfig=${directCredentials.hasProjectConfig}, '
      'loadedAnonKey=${directCredentials.anonKey?.isNotEmpty == true}, '
      'loadedDeviceCredentials=${directCredentials.hasDeviceCredentials}, '
      'loadedUserSession=${directCredentials.hasUserSession}',
    );
    expect(
      overview.setupComplete,
      isTrue,
      reason: '移动端未完成登录、设备注册或 PC 选择，不能进入会话验收',
    );

    final enterApp = find.text('进入应用');
    final enterButton = find.ancestor(
      of: enterApp,
      matching: find.byType(AdaptiveButton),
    );
    expect(enterButton, findsOneWidget);
    // iOS 26 renders this control as a native UiKitView and deliberately
    // places its Flutter label under IgnorePointer. Invoke the same public
    // callback from the integration harness; WidgetController.tap on the
    // label cannot exercise that native hit target.
    final onEnterApp = tester.widget<AdaptiveButton>(enterButton).onPressed;
    expect(onEnterApp, isNotNull);
    onEnterApp!();
    await _pumpUntil(
      tester,
      () => router.routeInformationProvider.value.uri.path == '/threads',
      '等待“进入应用”连接已配对 PC',
      timeout: const Duration(seconds: 90),
    );
    final center = scope.read(ecoCenterClientProvider);
    await _pumpUntil(
      tester,
      () =>
          center.status.state.name == 'connected' &&
          center.hasActiveBindingChannel &&
          !center.isPresenceOnlyMode,
      '等待 Supabase 绑定通道进入可发 RPC 状态',
      timeout: const Duration(seconds: 90),
    );
    final credentials = scope.read(credentialsProvider).valueOrNull;
    debugPrint(
      'iOS V2 smoke transport: state=${center.status.state.name}, '
      'binding=${center.hasActiveBindingChannel}, '
      'presenceOnly=${center.isPresenceOnlyMode}, '
      'selectedDesktop=${scope.read(selectedDesktopIdProvider) != null}, '
      'rpcProvider=${scope.read(desktopRpcProvider) != null}, '
      'principalPresent=${(credentials?.userId?.trim().isNotEmpty ?? false)}',
    );
    router.go('/threads/$threadId');

    var userMessageCount = 0;
    var completedAgentToolCount = 0;
    var syncState = ConversationV2SyncState.uninitialized;
    final promptInFeed = find.textContaining(marker);
    await _pumpUntil(
      tester,
      () {
        final state = scope.read(conversationV2SessionProvider(threadId));
        syncState = state.syncState;
        final userMessages = state.messages
            .where(
              (message) =>
                  message.role == 'user' &&
                  message.body.contains(marker) &&
                  !message.isDeleted,
            )
            .toList(growable: false);
        final completedAgentTools = state.tools.where((tool) {
          final payload =
              '${jsonEncode(tool.input)} ${jsonEncode(tool.output)}';
          return tool.agentId != null &&
              tool.status == 'completed' &&
              payload.contains(marker);
        });
        userMessageCount = userMessages.length;
        completedAgentToolCount = completedAgentTools.length;
        return syncState == ConversationV2SyncState.live &&
            userMessageCount == 1 &&
            completedAgentToolCount == 1 &&
            promptInFeed.evaluate().isNotEmpty;
      },
      '等待移动端 V2 消息、子代理工具和 Feed 同步',
      timeout: const Duration(seconds: 120),
    );

    expect(userMessageCount, 1, reason: 'V2 中必须只有一条匹配用户消息');
    expect(syncState, ConversationV2SyncState.live, reason: 'V2 同步必须进入 live');
    expect(completedAgentToolCount, 1, reason: 'V2 中必须恰好同步一条携带标记且已完成的子代理工具事件');
    expect(promptInFeed, findsWidgets, reason: 'Feed 必须展示该 V2 消息');

    final composer = find.byKey(const ValueKey('session-composer'));
    final input = find.descendant(
      of: composer,
      matching: find.byType(TextField),
    );
    expect(composer, findsOneWidget);
    expect(input, findsOneWidget);
    await tester.enterText(
      input,
      '只调用一次 Bash，原样执行：printf \'$mobileSendMarker\'。'
      '等待命令实际返回；成功后最终回复只能写实际输出。'
      '不要重试、委派或调用其他工具。无法调用 Bash 就明确说明并停止。',
    );
    final sendIcon = find.descendant(
      of: composer,
      matching: find.byIcon(EcoIcons.send),
    );
    final sendButton = find.ancestor(
      of: sendIcon,
      matching: find.byType(InkWell),
    );
    expect(sendIcon, findsOneWidget);
    expect(sendButton, findsOneWidget);
    final composerReadyDeadline = DateTime.now().add(
      const Duration(seconds: 30),
    );
    while (DateTime.now().isBefore(composerReadyDeadline) &&
        tester.widget<InkWell>(sendButton).onTap == null) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    final thread = scope.read(threadSessionProvider(threadId)).thread;
    final runtimeConfig = scope.read(runtimeConfigProvider);
    final modelSettings = scope.read(modelSettingsProvider);
    final runtimeReady =
        runtimeConfig != null &&
        isThreadRuntimeConfigReady(
          modelSettings.valueOrNull,
          runtimeConfig,
          coreKind: thread?.coreKind,
        );
    debugPrint(
      'iOS V2 smoke composer readiness: enabled=${tester.widget<InkWell>(sendButton).onTap != null}, '
      'threadStatus=${thread?.status}, core=${thread?.coreKind}, '
      'modelSettingsLoaded=${modelSettings.hasValue}, '
      'mainAgentConfigs=${modelSettings.valueOrNull?.mainAgentConfigs.length}, '
      'runtimeConfigPresent=${runtimeConfig != null}, '
      'runtimeSnapshot=${runtimeConfig?.resolvedOrchestrationSnapshot != null}, '
      'runtimeSelection=${runtimeConfig?.orchestrationSelection != null}, '
      'runtimeReady=$runtimeReady',
    );
    expect(
      tester.widget<InkWell>(sendButton).onTap,
      isNotNull,
      reason:
          '输入有效消息后发送按钮必须可用；threadStatus=${thread?.status}, '
          'core=${thread?.coreKind}, modelSettingsLoaded=${modelSettings.hasValue}, '
          'runtimeConfigPresent=${runtimeConfig != null}, runtimeReady=$runtimeReady',
    );
    await tester.tap(sendButton);

    var mobileUserMessageCount = 0;
    var mobileCompletedToolCount = 0;
    var mobileRunCompleted = false;
    final cache = scope.read(conversationV2CacheProvider);
    expect(cache, isNotNull, reason: '移动端 V2 durable cache 必须已启用');
    final acceptanceDeadline = DateTime.now().add(const Duration(seconds: 45));
    var pendingCommandCount = 0;
    while (DateTime.now().isBefore(acceptanceDeadline)) {
      await tester.pump(const Duration(milliseconds: 250));
      final state = scope.read(conversationV2SessionProvider(threadId));
      mobileUserMessageCount = state.messages
          .where(
            (message) =>
                message.role == 'user' &&
                message.body.contains(mobileSendMarker) &&
                !message.isDeleted,
          )
          .length;
      pendingCommandCount = (await cache!.pendingCommands(
        threadId,
      )).where((command) => command.text.contains(mobileSendMarker)).length;
      if (mobileUserMessageCount == 1 || pendingCommandCount > 0) break;
    }
    final afterAcceptance = scope.read(conversationV2SessionProvider(threadId));
    debugPrint(
      'iOS V2 smoke send acceptance: userMessages=$mobileUserMessageCount, '
      'pendingCommands=$pendingCommandCount, sync=${afterAcceptance.syncState.name}, '
      'connection=${center.status.state.name}, '
      'binding=${center.hasActiveBindingChannel}, '
      'rpcProvider=${scope.read(desktopRpcProvider) != null}, '
      'errors=${afterAcceptance.error == null ? 'none' : afterAcceptance.error.runtimeType}, '
      'snackbars=${_visibleSnackBarText(tester)}',
    );
    expect(
      mobileUserMessageCount == 1 || pendingCommandCount > 0,
      isTrue,
      reason:
          '45 秒内既没有 V2 user row，也没有 durable pending command；'
          '发送流程未进入 V2 controller。'
          ' connection=${center.status.state.name}, '
          'binding=${center.hasActiveBindingChannel}, '
          'rpcProvider=${scope.read(desktopRpcProvider) != null}, '
          'snackbars=${_visibleSnackBarText(tester)}',
    );

    final completionDeadline = DateTime.now().add(const Duration(seconds: 240));
    while (DateTime.now().isBefore(completionDeadline)) {
      await tester.pump(const Duration(milliseconds: 250));
      final state = scope.read(conversationV2SessionProvider(threadId));
      final matchingTools = state.tools.where((tool) {
        final payload = '${jsonEncode(tool.input)} ${jsonEncode(tool.output)}';
        return payload.contains(mobileSendMarker);
      });
      final completedTools = matchingTools
          .where((tool) => tool.status == 'completed')
          .toList(growable: false);
      mobileCompletedToolCount = completedTools.length;
      mobileRunCompleted = completedTools.any(
        (tool) => state.runs.any(
          (run) => run.runId == tool.runId && run.status == 'completed',
        ),
      );
      if (state.syncState == ConversationV2SyncState.live &&
          mobileUserMessageCount == 1 &&
          mobileCompletedToolCount == 1 &&
          mobileRunCompleted) {
        break;
      }
      mobileUserMessageCount = state.messages
          .where(
            (message) =>
                message.role == 'user' &&
                message.body.contains(mobileSendMarker) &&
                !message.isDeleted,
          )
          .length;
    }
    final finalState = scope.read(conversationV2SessionProvider(threadId));
    expect(mobileUserMessageCount, 1, reason: '移动端发送必须只生成一条 V2 user row');
    expect(mobileCompletedToolCount, 1, reason: '桌面必须只完成一条对应 Bash 工具调用');
    expect(
      mobileRunCompleted,
      isTrue,
      reason:
          '对应 V2 run 必须进入 completed；sync=${finalState.syncState.name}, '
          'connection=${center.status.state.name}, '
          'errors=${finalState.error == null ? 'none' : finalState.error.runtimeType}, '
          'snackbars=${_visibleSnackBarText(tester)}',
    );
    expect(
      find.textContaining(mobileSendMarker),
      findsWidgets,
      reason: '移动端 Feed 必须呈现自己发送并同步回来的 V2 消息',
    );
    scope.read(ecoCenterClientProvider).disconnect();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
  });
}

List<String> _visibleSnackBarText(WidgetTester tester) => tester
    .widgetList<Text>(
      find.descendant(of: find.byType(SnackBar), matching: find.byType(Text)),
    )
    .map((widget) => widget.data ?? '')
    .where((text) => text.isNotEmpty)
    .toList(growable: false);

Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() condition,
  String reason, {
  Duration timeout = const Duration(seconds: 45),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (condition()) return;
  }
  fail('超时：$reason');
}
