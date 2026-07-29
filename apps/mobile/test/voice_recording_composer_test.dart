import 'package:eco_mobile/core/theme/eco_theme.dart';
import 'package:eco_mobile/features/composer/voice_recording_composer.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders inline voice controls without narrow-screen overflow', (
    tester,
  ) async {
    var cancelCount = 0;
    var stopCount = 0;
    var sendCount = 0;

    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('zh'),
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildEcoLightTheme(),
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: VoiceRecordingComposer(
              audioLevel: 0.72,
              finishing: false,
              onCancel: () => cancelCount++,
              onStop: () => stopCount++,
              onSend: () => sendCount++,
            ),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));

    expect(tester.takeException(), isNull);
    expect(find.byType(CustomPaint), findsWidgets);

    await tester.tap(find.byTooltip('取消'));
    await tester.tap(find.byTooltip('停止语音输入'));
    await tester.tap(find.byTooltip('发送消息…'));

    expect(cancelCount, 1);
    expect(stopCount, 1);
    expect(sendCount, 1);
  });

  testWidgets('commits repeated live samples without dropping history', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      _VoiceComposerTestApp(
        child: VoiceRecordingComposer(
          audioLevel: 0.72,
          finishing: false,
          onCancel: () {},
          onStop: () {},
          onSend: () {},
        ),
      ),
    );
    for (var index = 0; index < 30; index++) {
      await tester.pump(const Duration(milliseconds: 75));
    }

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('voice-level-wave')), findsOneWidget);
  });
}

class _VoiceComposerTestApp extends StatelessWidget {
  const _VoiceComposerTestApp({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: const Locale('zh'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildEcoLightTheme(),
      home: Scaffold(
        body: Align(alignment: Alignment.bottomCenter, child: child),
      ),
    );
  }
}
