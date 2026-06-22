import 'package:flutter/material.dart';

/// Theme preference aligned with [apps/desktop/src/renderer/theme.ts].
enum AppThemePreference {
  system,
  dark,
  light;

  static const storageKey = 'eco.app-theme';

  static AppThemePreference? tryParse(String? raw) {
    return switch (raw) {
      'system' => AppThemePreference.system,
      'dark' => AppThemePreference.dark,
      'light' => AppThemePreference.light,
      _ => null,
    };
  }

  String get storageValue => name;

  ThemeMode get themeMode => switch (this) {
        AppThemePreference.system => ThemeMode.system,
        AppThemePreference.dark => ThemeMode.dark,
        AppThemePreference.light => ThemeMode.light,
      };

  String get label => switch (this) {
        AppThemePreference.system => '跟随',
        AppThemePreference.dark => '深色',
        AppThemePreference.light => '浅色',
      };
}
