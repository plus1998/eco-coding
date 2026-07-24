import 'package:flutter/widgets.dart';

enum AppLocalePreference {
  system,
  zhCN,
  enUS;

  static const storageKey = 'eco.locale';

  static AppLocalePreference? tryParse(String? raw) {
    return switch (raw) {
      'system' => AppLocalePreference.system,
      'zh-CN' => AppLocalePreference.zhCN,
      'en-US' => AppLocalePreference.enUS,
      _ => null,
    };
  }

  String get storageValue => switch (this) {
    AppLocalePreference.system => 'system',
    AppLocalePreference.zhCN => 'zh-CN',
    AppLocalePreference.enUS => 'en-US',
  };

  Locale? get locale => switch (this) {
    AppLocalePreference.system => null,
    AppLocalePreference.zhCN => const Locale('zh', 'CN'),
    AppLocalePreference.enUS => const Locale('en', 'US'),
  };
}
