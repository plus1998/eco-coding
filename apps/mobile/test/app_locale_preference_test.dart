import 'package:eco_mobile/core/locale/app_locale_preference.dart';
import 'package:eco_mobile/core/providers/app_locale_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('AppLocalePreference', () {
    test('parses persisted values and rejects unknown values', () {
      expect(
        AppLocalePreference.tryParse('system'),
        AppLocalePreference.system,
      );
      expect(AppLocalePreference.tryParse('zh-CN'), AppLocalePreference.zhCN);
      expect(AppLocalePreference.tryParse('en-US'), AppLocalePreference.enUS);
      expect(AppLocalePreference.tryParse('zh_CN'), isNull);
      expect(AppLocalePreference.tryParse(null), isNull);
    });

    test('maps explicit preferences to Flutter locales', () {
      expect(AppLocalePreference.system.locale, isNull);
      expect(AppLocalePreference.zhCN.locale, const Locale('zh', 'CN'));
      expect(AppLocalePreference.enUS.locale, const Locale('en', 'US'));
    });

    test('uses stable persistence values', () {
      expect(AppLocalePreference.storageKey, 'eco.locale');
      expect(AppLocalePreference.system.storageValue, 'system');
      expect(AppLocalePreference.zhCN.storageValue, 'zh-CN');
      expect(AppLocalePreference.enUS.storageValue, 'en-US');
    });

    test('notifier switches immediately and persists the selection', () async {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer(
        overrides: [
          appLocaleBootstrapProvider.overrideWithValue(
            AppLocalePreference.system,
          ),
        ],
      );
      addTearDown(container.dispose);

      await container
          .read(appLocalePreferenceProvider.notifier)
          .setPreference(AppLocalePreference.enUS);

      expect(
        container.read(appLocalePreferenceProvider),
        AppLocalePreference.enUS,
      );
      final preferences = await SharedPreferences.getInstance();
      expect(preferences.getString(AppLocalePreference.storageKey), 'en-US');
    });
  });
}
