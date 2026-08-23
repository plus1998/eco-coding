import 'package:flutter/material.dart';

import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import 'eco_grouped_list.dart';

/// One selectable model row in the unified provider → model cascade.
class ModelCascadeEntry {
  const ModelCascadeEntry({
    required this.key,
    required this.providerKey,
    required this.providerName,
    required this.modelId,
    required this.title,
    this.subtitle,
    this.badge,
  });

  final String key;
  final String providerKey;
  final String providerName;
  final String modelId;
  final String title;
  final String? subtitle;
  final String? badge;
}

class _ModelCascadeGroup {
  _ModelCascadeGroup(this.providerKey, this.providerName, this.entries);

  final String providerKey;
  final String providerName;
  final List<ModelCascadeEntry> entries;
}

/// Keep the provider → model hierarchy intact while filtering. A group
/// stays visible when its provider name matches or any model matches;
/// otherwise only the matching models are listed. The catalogue is never
/// rendered as a flat cross-provider list.
List<_ModelCascadeGroup> _groupModelCascadeEntries(
  List<ModelCascadeEntry> options,
  String query,
) {
  final needle = query.trim().toLowerCase();
  final groups = <_ModelCascadeGroup>[];
  final byProvider = <String, _ModelCascadeGroup>{};
  for (final entry in options) {
    var group = byProvider[entry.providerKey];
    if (group == null) {
      group = _ModelCascadeGroup(entry.providerKey, entry.providerName, []);
      byProvider[entry.providerKey] = group;
      groups.add(group);
    }
    group.entries.add(entry);
  }
  if (needle.isEmpty) {
    return groups;
  }
  final visible = <_ModelCascadeGroup>[];
  for (final group in groups) {
    final providerMatches = group.providerName
            .toLowerCase()
            .contains(needle) ||
        group.providerKey.toLowerCase().contains(needle);
    final matched = providerMatches
        ? group.entries
        : group.entries
            .where((entry) =>
                entry.title.toLowerCase().contains(needle) ||
                entry.modelId.toLowerCase().contains(needle))
            .toList();
    if (matched.isNotEmpty) {
      visible.add(_ModelCascadeGroup(group.providerKey, group.providerName, matched));
    }
  }
  return visible;
}

/// Unified model picker content: a search box over a provider-grouped model
/// list. Used by every "pick from all models" surface on mobile so the
/// hierarchy is consistent and the list is never flat.
class EcoModelCascadeList extends StatefulWidget {
  const EcoModelCascadeList({
    super.key,
    required this.options,
    this.selectedKey,
    this.onSelected,
    this.enabled = true,
    this.showSearch = true,
    this.leading,
  });

  final List<ModelCascadeEntry> options;
  final String? selectedKey;
  final ValueChanged<String?>? onSelected;
  final bool enabled;
  final bool showSearch;

  /// Optional rows rendered above the groups (e.g. "not configured" / "default").
  final List<Widget>? leading;

  @override
  State<EcoModelCascadeList> createState() => _EcoModelCascadeListState();
}

class _EcoModelCascadeListState extends State<EcoModelCascadeList> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final eco = ecoColors(context);
    final needle = _searchController.text.trim().toLowerCase();
    final groups = _groupModelCascadeEntries(widget.options, needle);

    final children = <Widget>[
      if (widget.showSearch)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            controller: _searchController,
            textInputAction: TextInputAction.search,
            style: Theme.of(context).textTheme.bodyLarge,
            decoration: InputDecoration(
              isDense: true,
              hintText: l10n.modelCascadeSearchHint,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 10,
              ),
              prefixIcon: const Icon(EcoIcons.search, size: 20),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: l10n.threadSearchClear,
                      icon: const Icon(EcoIcons.close, size: 18),
                      onPressed: () {
                        _searchController.clear();
                        setState(() {});
                      },
                    ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            onChanged: (_) => setState(() {}),
          ),
        ),
      if (widget.leading != null) ...widget.leading!,
      if (widget.options.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Text(
            l10n.modelCascadeEmpty,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: eco.textMuted),
          ),
        )
      else if (groups.isEmpty && needle.isNotEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Text(
            l10n.modelCascadeNoMatch,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: eco.textMuted),
          ),
        )
      else
        for (final group in groups)
          ..._buildGroup(
            group,
            expanded: needle.isNotEmpty || _groupContainsSelection(group),
          ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: children,
    );
  }

  bool _groupContainsSelection(_ModelCascadeGroup group) {
    final selectedKey = widget.selectedKey;
    if (selectedKey == null) return true;
    return group.entries.any((entry) => entry.key == selectedKey);
  }

  List<Widget> _buildGroup(
    _ModelCascadeGroup group, {
    required bool expanded,
  }) {
    final result = <Widget>[
      EcoGroupedSectionHeader(
        label: group.providerName,
        caption: '${group.entries.length}',
      ),
    ];
    if (!expanded) return result;
    for (var i = 0; i < group.entries.length; i++) {
      final entry = group.entries[i];
      final selected = entry.key == widget.selectedKey;
      result.add(EcoSheetModelTile(
        title: entry.title,
        subtitle: entry.subtitle,
        badge: entry.badge,
        selected: selected,
        enabled: widget.enabled,
        onTap: widget.enabled
            ? () => widget.onSelected?.call(entry.key)
            : null,
      ));
      result.add(EcoGroupedDivider(
        indent: 16,
        soft: i < group.entries.length - 1 || group.entries.length > 1,
      ));
    }
    return result;
  }
}

/// Model row inside the cascade (distinct from the generic option tile so it
/// keeps a tighter, list-like footprint).
class EcoSheetModelTile extends StatelessWidget {
  const EcoSheetModelTile({
    super.key,
    required this.title,
    this.subtitle,
    this.badge,
    this.selected = false,
    this.enabled = true,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final String? badge;
  final bool selected;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return EcoGroupedTile(
      onTap: enabled ? onTap : null,
      highlighted: selected,
      padding: const EdgeInsets.fromLTRB(16, 10, 14, 10),
      minHeight: 40,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        title,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight:
                              selected ? FontWeight.w600 : FontWeight.w400,
                          letterSpacing: -0.2,
                          color: enabled ? eco.textPrimary : eco.textMuted,
                        ),
                      ),
                    ),
                    if (badge != null) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: eco.accentSoft,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          badge!,
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: eco.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: eco.textMuted),
                  ),
              ],
            ),
          ),
          if (selected)
            Icon(
              EcoIcons.check,
              size: 20,
              color: eco.accent,
            ),
        ],
      ),
    );
  }
}
