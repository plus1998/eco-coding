import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_theme_preference.dart';

final appThemeBootstrapProvider = Provider<AppThemePreference>(
  (ref) => AppThemePreference.system,
);

final appThemePreferenceProvider =
    NotifierProvider<AppThemePreferenceNotifier, AppThemePreference>(
  AppThemePreferenceNotifier.new,
);

class AppThemePreferenceNotifier extends Notifier<AppThemePreference> {
  @override
  AppThemePreference build() => ref.watch(appThemeBootstrapProvider);

  Future<void> setPreference(AppThemePreference preference) async {
    state = preference;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(AppThemePreference.storageKey, preference.storageValue);
  }
}
