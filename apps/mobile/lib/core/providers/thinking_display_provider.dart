import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../preferences/thinking_display_preferences.dart';

final thinkingDisplayBootstrapProvider = Provider<ThinkingDisplayMode>(
  (ref) => defaultThinkingDisplayMode,
);

final thinkingDisplayModeProvider =
    NotifierProvider<ThinkingDisplayModeNotifier, ThinkingDisplayMode>(
      ThinkingDisplayModeNotifier.new,
    );

class ThinkingDisplayModeNotifier extends Notifier<ThinkingDisplayMode> {
  @override
  ThinkingDisplayMode build() => ref.watch(thinkingDisplayBootstrapProvider);

  Future<void> setMode(ThinkingDisplayMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      ThinkingDisplayMode.storageKey,
      jsonEncode({'mode': mode.storageValue}),
    );
  }
}

ThinkingDisplayMode readStoredThinkingDisplayMode(SharedPreferences prefs) {
  final raw = prefs.getString(ThinkingDisplayMode.storageKey);
  if (raw == null || raw.trim().isEmpty) {
    return defaultThinkingDisplayMode;
  }
  try {
    return normalizeThinkingDisplayMode(jsonDecode(raw));
  } catch (_) {
    return ThinkingDisplayMode.tryParse(raw) ?? defaultThinkingDisplayMode;
  }
}
