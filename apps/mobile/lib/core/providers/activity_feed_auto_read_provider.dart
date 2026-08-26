import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const activityFeedAutoReadStorageKey = 'activity_feed_auto_read';

final activityFeedAutoReadBootstrapProvider = Provider<bool>((ref) => false);

final activityFeedAutoReadProvider =
    NotifierProvider<ActivityFeedAutoReadNotifier, bool>(
      ActivityFeedAutoReadNotifier.new,
    );

class ActivityFeedAutoReadNotifier extends Notifier<bool> {
  @override
  bool build() => ref.watch(activityFeedAutoReadBootstrapProvider);

  Future<void> setEnabled(bool enabled) async {
    state = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(activityFeedAutoReadStorageKey, enabled);
  }

  Future<void> toggle() => setEnabled(!state);
}
