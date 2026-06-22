import 'package:eco_mobile/core/theme/app_theme_preference.dart';
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
}
