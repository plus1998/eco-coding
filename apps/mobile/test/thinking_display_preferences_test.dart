import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/preferences/thinking_display_preferences.dart';

void main() {
  test('thinking display preference defaults to ephemeral', () {
    expect(defaultThinkingDisplayMode, ThinkingDisplayMode.ephemeral);
    expect(normalizeThinkingDisplayMode(null), ThinkingDisplayMode.ephemeral);
    expect(normalizeThinkingDisplayMode({}), ThinkingDisplayMode.ephemeral);
    expect(
      normalizeThinkingDisplayMode({'mode': 'nope'}),
      ThinkingDisplayMode.ephemeral,
    );
  });

  test('thinking display preference accepts three modes', () {
    expect(
      normalizeThinkingDisplayMode({'mode': 'ephemeral'}),
      ThinkingDisplayMode.ephemeral,
    );
    expect(
      normalizeThinkingDisplayMode({'mode': 'collapsed'}),
      ThinkingDisplayMode.collapsed,
    );
    expect(
      normalizeThinkingDisplayMode({'mode': 'expanded'}),
      ThinkingDisplayMode.expanded,
    );
  });

  test('thinking display preference migrates legacy boolean', () {
    expect(
      normalizeThinkingDisplayMode({'thinkingContentDefaultExpanded': true}),
      ThinkingDisplayMode.expanded,
    );
    expect(
      normalizeThinkingDisplayMode({'thinkingContentDefaultExpanded': false}),
      ThinkingDisplayMode.collapsed,
    );
  });

  test('thinking mode helpers map to tip vs card effects', () {
    expect(ThinkingDisplayMode.ephemeral.usesEphemeralTip, isTrue);
    expect(ThinkingDisplayMode.collapsed.usesEphemeralTip, isFalse);
    expect(ThinkingDisplayMode.expanded.usesEphemeralTip, isFalse);
    expect(ThinkingDisplayMode.ephemeral.defaultExpanded, isFalse);
    expect(ThinkingDisplayMode.collapsed.defaultExpanded, isFalse);
    expect(ThinkingDisplayMode.expanded.defaultExpanded, isTrue);
  });
}
