import 'package:eco_mobile/core/theme/app_theme_preference.dart';
import 'package:eco_mobile/core/widgets/app_theme_media_query.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppThemePreference', () {
    test('tryParse accepts desktop-aligned storage values', () {
      expect(AppThemePreference.tryParse('system'), AppThemePreference.system);
      expect(AppThemePreference.tryParse('dark'), AppThemePreference.dark);
      expect(AppThemePreference.tryParse('light'), AppThemePreference.light);
      expect(AppThemePreference.tryParse('invalid'), isNull);
    });

    test('themeMode maps to Flutter ThemeMode', () {
      expect(AppThemePreference.system.themeMode, ThemeMode.system);
      expect(AppThemePreference.dark.themeMode, ThemeMode.dark);
      expect(AppThemePreference.light.themeMode, ThemeMode.light);
    });

    test('storage key matches desktop', () {
      expect(AppThemePreference.storageKey, 'eco.app-theme');
    });
  });

  testWidgets('native adaptive controls follow the active dark app theme', (
    tester,
  ) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    Brightness? effectiveBrightness;

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.light),
        darkTheme: ThemeData(brightness: Brightness.dark),
        themeMode: ThemeMode.dark,
        home: AppThemeMediaQuery(
          child: Builder(
            builder: (context) {
              effectiveBrightness = MediaQuery.platformBrightnessOf(context);
              return const SizedBox();
            },
          ),
        ),
      ),
    );

    expect(effectiveBrightness, Brightness.dark);
  });

  testWidgets('native adaptive controls follow the active light app theme', (
    tester,
  ) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    Brightness? effectiveBrightness;

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.light),
        darkTheme: ThemeData(brightness: Brightness.dark),
        themeMode: ThemeMode.light,
        home: AppThemeMediaQuery(
          child: Builder(
            builder: (context) {
              effectiveBrightness = MediaQuery.platformBrightnessOf(context);
              return const SizedBox();
            },
          ),
        ),
      ),
    );

    expect(effectiveBrightness, Brightness.light);
  });
}
