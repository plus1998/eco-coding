import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../locale/app_locale_preference.dart';

final appLocaleBootstrapProvider = Provider<AppLocalePreference>(
  (ref) => AppLocalePreference.system,
);

final appLocalePreferenceProvider =
    NotifierProvider<AppLocalePreferenceNotifier, AppLocalePreference>(
      AppLocalePreferenceNotifier.new,
    );

class AppLocalePreferenceNotifier extends Notifier<AppLocalePreference> {
  @override
  AppLocalePreference build() => ref.watch(appLocaleBootstrapProvider);

  Future<void> setPreference(AppLocalePreference preference) async {
    state = preference;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      AppLocalePreference.storageKey,
      preference.storageValue,
    );
  }
}
