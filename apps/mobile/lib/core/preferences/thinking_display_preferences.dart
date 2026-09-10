/// Thinking on the Feed has exactly two presentation effects (aligned with
/// desktop `thinking-display-preferences.ts`):
///
/// 1. Tip (`reasoningStage`) — Summary lifecycle: shimmer label, tip only,
///    removed when tools/正文 supersede. Used by OpenAI summary always, and by
///    raw thinking when mode is [ThinkingDisplayMode.ephemeral] (阅后即焚).
/// 2. Card (`thinking`) — Collapsible thinking tile. Used when mode is
///    [ThinkingDisplayMode.collapsed] / [ThinkingDisplayMode.expanded].
enum ThinkingDisplayMode {
  ephemeral,
  collapsed,
  expanded;

  static const storageKey = 'eco.thinking-display-preferences';

  static const all = ThinkingDisplayMode.values;

  static ThinkingDisplayMode? tryParse(String? raw) {
    return switch (raw) {
      'ephemeral' => ThinkingDisplayMode.ephemeral,
      'collapsed' => ThinkingDisplayMode.collapsed,
      'expanded' => ThinkingDisplayMode.expanded,
      _ => null,
    };
  }

  String get storageValue => name;

  /// Tip path (Summary machinery), not a retained thinking card.
  bool get usesEphemeralTip => this == ThinkingDisplayMode.ephemeral;

  /// Default expand state when the card path is used.
  bool get defaultExpanded => this == ThinkingDisplayMode.expanded;
}

const defaultThinkingDisplayMode = ThinkingDisplayMode.ephemeral;

ThinkingDisplayMode normalizeThinkingDisplayMode(Object? value) {
  if (value is ThinkingDisplayMode) return value;
  if (value is String) {
    return ThinkingDisplayMode.tryParse(value) ?? defaultThinkingDisplayMode;
  }
  if (value is Map) {
    final mode = ThinkingDisplayMode.tryParse(value['mode']?.toString());
    if (mode != null) return mode;
    // Migrate pre-mode boolean: preserve explicit collapsed/expanded.
    final legacy = value['thinkingContentDefaultExpanded'];
    if (legacy is bool) {
      return legacy
          ? ThinkingDisplayMode.expanded
          : ThinkingDisplayMode.collapsed;
    }
  }
  return defaultThinkingDisplayMode;
}
