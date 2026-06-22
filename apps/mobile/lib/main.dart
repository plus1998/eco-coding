import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/providers/app_theme_provider.dart';
import 'core/theme/app_theme_preference.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final stored = AppThemePreference.tryParse(
    prefs.getString(AppThemePreference.storageKey),
  );
  final initialTheme = stored ?? AppThemePreference.system;

  runApp(
    ProviderScope(
      overrides: [
        appThemeBootstrapProvider.overrideWithValue(initialTheme),
      ],
      child: const EcoApp(),
    ),
  );
}
