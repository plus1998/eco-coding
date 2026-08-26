import 'package:flutter/material.dart';

import '../../l10n/generated/app_localizations.dart';
import '../locale/app_localizations_ext.dart';
import '../theme/eco_icons.dart';
import '../theme/eco_theme.dart';
import 'eco_grouped_list.dart';
import 'eco_pressable.dart';

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
    this.trailing,
  });

  final String key;
  final String providerKey;
  final String providerName;
  final String modelId;
  final String title;
  final String? subtitle;
  final String? badge;
  final Widget? trailing;
}

enum EcoModelCascadeLayout {
  /// Provider headers with expandable model lists (e.g. commit sheet).
  accordion,

  /// Left provider column + right model list (settings, composer).
  split,
}

class _ModelCascadeGroup {
  _ModelCascadeGroup(this.providerKey, this.providerName, this.entries);

  final String providerKey;
  final String providerName;
  final List<ModelCascadeEntry> entries;
}

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
      visible.add(
        _ModelCascadeGroup(group.providerKey, group.providerName, matched),
      );
    }
  }
  return visible;
}

String? _resolveActiveProviderKey(
  List<_ModelCascadeGroup> groups,
  String? selectedKey,
) {
  if (selectedKey != null) {
    for (final group in groups) {
      if (group.entries.any((entry) => entry.key == selectedKey)) {
        return group.providerKey;
      }
    }
  }
  return groups.isEmpty ? null : groups.first.providerKey;
}

/// Unified model picker: search + provider → model hierarchy.
class EcoModelCascadeList extends StatefulWidget {
  const EcoModelCascadeList({
    super.key,
    required this.options,
    this.selectedKey,
    this.onSelected,
    this.enabled = true,
    this.showSearch = true,
    this.leading,
    this.layout = EcoModelCascadeLayout.accordion,
    this.height,
  });

  final List<ModelCascadeEntry> options;
  final String? selectedKey;
  final ValueChanged<String?>? onSelected;
  final bool enabled;
  final bool showSearch;
  final List<Widget>? leading;
  final EcoModelCascadeLayout layout;

  /// Fixed height for the scrollable catalogue body (required for [split] in overlays).
  final double? height;

  @override
  State<EcoModelCascadeList> createState() => _EcoModelCascadeListState();
}

class _EcoModelCascadeListState extends State<EcoModelCascadeList> {
  final TextEditingController _searchController = TextEditingController();
  final Set<String> _expandedProviderKeys = {};
  String? _activeProviderKey;

  @override
  void initState() {
    super.initState();
    _syncProviderState();
  }

  @override
  void didUpdateWidget(EcoModelCascadeList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.options != widget.options ||
        oldWidget.selectedKey != widget.selectedKey ||
        oldWidget.layout != widget.layout) {
      _syncProviderState();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _syncProviderState() {
    _expandedProviderKeys
      ..clear()
      ..addAll(widget.options.map((entry) => entry.providerKey));
    final groups = _groupModelCascadeEntries(
      widget.options,
      _searchController.text,
    );
    final resolved = _resolveActiveProviderKey(groups, widget.selectedKey);
    _activeProviderKey = resolved;
  }

  void _toggleGroup(String providerKey) {
    setState(() {
      if (_expandedProviderKeys.contains(providerKey)) {
        _expandedProviderKeys.remove(providerKey);
      } else {
        _expandedProviderKeys.add(providerKey);
      }
    });
  }

  void _selectProvider(String providerKey) {
    setState(() => _activeProviderKey = providerKey);
  }

  Widget _buildSearchField(AppLocalizations l10n) {
    final eco = ecoColors(context);
    final fieldShape = OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide.none,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        ecoGroupedHorizontalInset,
        2,
        ecoGroupedHorizontalInset,
        0,
      ),
      child: TextField(
        controller: _searchController,
        textInputAction: TextInputAction.search,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
          letterSpacing: -0.15,
        ),
        decoration: InputDecoration(
          isDense: true,
          filled: true,
          fillColor: eco.composerPillBg,
          hintText: l10n.modelCascadeSearchHint,
          hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: eco.textMuted,
            letterSpacing: -0.1,
          ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 8,
            vertical: 10,
          ),
          prefixIcon: Icon(EcoIcons.search, size: 17, color: eco.textMuted),
          prefixIconConstraints:
              const BoxConstraints(minWidth: 40, minHeight: 36),
          suffixIcon: _searchController.text.isEmpty
              ? null
              : IconButton(
                  tooltip: l10n.threadSearchClear,
                  icon: Icon(EcoIcons.close, size: 16, color: eco.textMuted),
                  visualDensity: VisualDensity.compact,
                  onPressed: () {
                    _searchController.clear();
                    setState(_syncProviderState);
                  },
                ),
          border: fieldShape,
          enabledBorder: fieldShape,
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(
              color: eco.accent.withValues(alpha: 0.55),
              width: 1,
            ),
          ),
        ),
        onChanged: (_) => setState(_syncProviderState),
      ),
    );
  }

  Widget _buildStatusText(String text, EcoColors eco) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(color: eco.textMuted),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final eco = ecoColors(context);
    final needle = _searchController.text.trim().toLowerCase();
    final groups = _groupModelCascadeEntries(widget.options, needle);

    if (_activeProviderKey == null ||
        !groups.any((group) => group.providerKey == _activeProviderKey)) {
      _activeProviderKey = _resolveActiveProviderKey(groups, widget.selectedKey);
    }

    final catalogue = widget.options.isEmpty
        ? _buildStatusText(l10n.modelCascadeEmpty, eco)
        : groups.isEmpty && needle.isNotEmpty
            ? _buildStatusText(l10n.modelCascadeNoMatch, eco)
            : widget.layout == EcoModelCascadeLayout.split
                ? _buildSplitCatalogue(groups, eco)
                : _buildAccordionCatalogue(groups);

    final insetCatalogue = widget.layout == EcoModelCascadeLayout.split;
    final body = widget.height != null
        ? SizedBox(height: widget.height, child: catalogue)
        : catalogue;
    final insetBody = insetCatalogue
        ? Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: ecoGroupedHorizontalInset,
            ),
            child: body,
          )
        : body;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.showSearch) _buildSearchField(l10n),
        if (widget.showSearch && widget.options.isNotEmpty)
          const SizedBox(height: 12),
        if (widget.leading != null) ...widget.leading!,
        if (widget.leading != null && widget.options.isNotEmpty)
          const SizedBox(height: 8),
        insetBody,
      ],
    );
  }

  Widget _buildAccordionCatalogue(List<_ModelCascadeGroup> groups) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final group in groups)
          ..._buildAccordionGroup(
            group,
            expanded: needleExpanded(group) ||
                _expandedProviderKeys.contains(group.providerKey),
          ),
      ],
    );
  }

  bool needleExpanded(_ModelCascadeGroup group) {
    return _searchController.text.trim().isNotEmpty;
  }

  Widget _buildSplitCatalogue(List<_ModelCascadeGroup> groups, EcoColors eco) {
    final activeKey = _activeProviderKey;
    final activeGroup = groups.cast<_ModelCascadeGroup?>().firstWhere(
          (group) => group!.providerKey == activeKey,
          orElse: () => groups.isEmpty ? null : groups.first,
        );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: eco.cardSurface,
        border: Border.all(color: eco.borderSubtle.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 118,
              child: ColoredBox(
                color: eco.bgSidebar.withValues(alpha: 0.72),
                child: ListView.separated(
                  padding: EdgeInsets.zero,
                  itemCount: groups.length,
                  separatorBuilder: (_, _) => Divider(
                    height: 1,
                    thickness: 0.5,
                    color: eco.borderSubtle.withValues(alpha: 0.5),
                  ),
                  itemBuilder: (context, index) {
                    final group = groups[index];
                    final active = group.providerKey == activeKey;
                    return EcoPressable(
                      onTap: widget.enabled
                          ? () => _selectProvider(group.providerKey)
                          : null,
                      child: Container(
                        color: active
                            ? eco.navActive
                            : null,
                        padding: const EdgeInsets.fromLTRB(12, 11, 10, 11),
                        child: Text(
                          group.providerName,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(
                                fontWeight:
                                    active ? FontWeight.w600 : FontWeight.w500,
                                color: widget.enabled
                                    ? eco.textPrimary
                                    : eco.textMuted,
                                height: 1.15,
                                letterSpacing: -0.12,
                              ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
            VerticalDivider(
              width: 1,
              thickness: 0.5,
              color: eco.borderSubtle.withValues(alpha: 0.65),
            ),
            Expanded(
              child: activeGroup == null
                  ? _buildStatusText(context.l10n.modelCascadeEmpty, eco)
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      itemCount: activeGroup.entries.length,
                      separatorBuilder: (_, _) => EcoGroupedDivider(
                        indent: 12,
                        soft: true,
                      ),
                      itemBuilder: (context, index) {
                        final entry = activeGroup.entries[index];
                        return EcoSheetModelTile(
                          title: entry.title,
                          subtitle: entry.subtitle,
                          badge: entry.badge,
                          trailing: entry.trailing,
                          selected: entry.key == widget.selectedKey,
                          enabled: widget.enabled,
                          compact: true,
                          onTap: widget.enabled
                              ? () => widget.onSelected?.call(entry.key)
                              : null,
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildAccordionGroup(
    _ModelCascadeGroup group, {
    required bool expanded,
  }) {
    final result = <Widget>[
      EcoPressable(
        onTap: widget.enabled ? () => _toggleGroup(group.providerKey) : null,
        child: Row(
          children: [
            Expanded(
              child: EcoGroupedSectionHeader(
                label: group.providerName,
                caption: '${group.entries.length}',
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(right: ecoGroupedHorizontalInset),
              child: Icon(
                expanded ? EcoIcons.expandDown : EcoIcons.chevronRight,
                size: 16,
                color: ecoColors(context).textMuted,
              ),
            ),
          ],
        ),
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
        trailing: entry.trailing,
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

class EcoSheetModelTile extends StatelessWidget {
  const EcoSheetModelTile({
    super.key,
    required this.title,
    this.subtitle,
    this.badge,
    this.trailing,
    this.selected = false,
    this.enabled = true,
    this.compact = false,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final String? badge;
  final Widget? trailing;
  final bool selected;
  final bool enabled;
  final bool compact;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final verticalPad = compact ? 8.0 : 10.0;
    return EcoGroupedTile(
      onTap: enabled ? onTap : null,
      highlighted: selected,
      padding: EdgeInsets.fromLTRB(compact ? 12 : 16, verticalPad, 12, verticalPad),
      minHeight: compact ? 36 : 40,
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
                          fontSize: compact ? 14 : null,
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
          if (trailing != null) ...[
            const SizedBox(width: 8),
            trailing!,
          ],
          if (selected) ...[
            const SizedBox(width: 8),
            Icon(
              EcoIcons.check,
              size: compact ? 18 : 20,
              color: eco.accent,
            ),
          ],
        ],
      ),
    );
  }
}
