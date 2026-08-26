import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../locale/app_localizations_ext.dart';
import '../providers/app_providers.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';

class ActivityFeedSpeakButton extends ConsumerWidget {
  const ActivityFeedSpeakButton({
    super.key,
    required this.entryId,
    required this.sourceText,
  });

  final String entryId;
  final String sourceText;

  Future<void> _handleTap(BuildContext context, WidgetRef ref) async {
    final tts = ref.read(ecoTtsServiceProvider);
    if (tts.isSpeakingEntry(entryId)) {
      await tts.stop();
      return;
    }

    final locale = Localizations.localeOf(context);
    final started = await tts.speak(
      entryId: entryId,
      sourceText: sourceText,
      locale: locale,
    );
    if (!started && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.ttsUnavailable)),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tts = ref.watch(ecoTtsServiceProvider);
    final speaking = tts.isSpeakingEntry(entryId);
    final eco = ecoColors(context);

    return IconButton(
      onPressed: () => _handleTap(context, ref),
      icon: Icon(
        speaking ? EcoIcons.stop : EcoIcons.volume2,
        size: 14,
      ),
      tooltip: speaking
          ? context.l10n.activityStopSpeaking
          : context.l10n.activitySpeakMessage,
      visualDensity: VisualDensity.compact,
      style: IconButton.styleFrom(
        foregroundColor: speaking
            ? eco.textSecondary
            : eco.textMuted.withValues(alpha: 0.7),
        minimumSize: const Size(28, 28),
        padding: const EdgeInsets.all(4),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
    );
  }
}
