import 'package:flutter/material.dart';

import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_grouped_list.dart';

class SettingsDisclosureRow extends StatelessWidget {
  const SettingsDisclosureRow({
    super.key,
    required this.title,
    this.value,
    this.subtitle,
    this.icon,
    this.destructive = false,
    required this.onTap,
  });

  final String title;
  final String? value;
  final String? subtitle;
  final IconData? icon;
  final bool destructive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final color = destructive ? eco.danger : eco.textPrimary;
    final hasValue = value != null && value!.isNotEmpty;

    final titleColumn = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: color,
            fontSize: 17,
            letterSpacing: -0.2,
          ),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Text(
            subtitle!,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
          ),
        ],
      ],
    );

    final chevron = Icon(
      EcoIcons.chevronRight,
      size: 16,
      color: eco.textMuted.withValues(alpha: 0.7),
    );

    return EcoGroupedTile(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 22, color: destructive ? eco.danger : eco.accent),
            const SizedBox(width: 14),
          ],
          if (hasValue) ...[
            Expanded(flex: 5, child: titleColumn),
            const SizedBox(width: 12),
            Expanded(
              flex: 7,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Flexible(
                    child: Text(
                      value!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: eco.textMuted,
                        fontSize: 15,
                        letterSpacing: -0.1,
                        height: 1.2,
                      ),
                    ),
                  ),
                  if (!destructive) ...[const SizedBox(width: 4), chevron],
                ],
              ),
            ),
          ] else ...[
            Expanded(child: titleColumn),
            if (!destructive) ...[const SizedBox(width: 4), chevron],
          ],
        ],
      ),
    );
  }
}

class SettingsSwitchRow extends StatelessWidget {
  const SettingsSwitchRow({
    super.key,
    required this.title,
    this.subtitle,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      onTap: enabled ? () => onChanged(!value) : null,
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      child: Row(
        children: [
          Expanded(
            child: Opacity(
              opacity: enabled ? 1 : 0.5,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: eco.textPrimary,
                      fontSize: 17,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(color: eco.textMuted),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),
          Switch.adaptive(value: value, onChanged: enabled ? onChanged : null),
        ],
      ),
    );
  }
}

class SettingsRadioOption extends StatelessWidget {
  const SettingsRadioOption({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    required this.selected,
    this.enabled = true,
    required this.onTap,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      onTap: enabled ? onTap : null,
      highlighted: selected,
      padding: const EdgeInsets.fromLTRB(16, 12, 14, 12),
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                size: 22,
                color: selected ? eco.accent : eco.textMuted,
              ),
              const SizedBox(width: 14),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                      fontSize: 17,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: eco.textMuted,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (selected) ...[
              const SizedBox(width: 8),
              Icon(EcoIcons.check, size: 18, color: eco.accent),
            ],
          ],
        ),
      ),
    );
  }
}
