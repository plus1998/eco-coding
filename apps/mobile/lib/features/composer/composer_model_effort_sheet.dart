import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:adaptive_platform_ui/adaptive_platform_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/git_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/models/thread_runtime_config.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';
import '../../core/widgets/eco_android_glass.dart';
import '../../core/widgets/eco_pressable.dart';
import '../../l10n/generated/app_localizations.dart';
import '../threads/thread_providers.dart';
import 'composer_controls.dart';

enum _CascadeBranch { model, effort, agent, auxiliary, vision }

/// Floating glass cascade: primary menu + side submenu (screenshot style).
Future<void> showComposerModelEffortSheet(
  BuildContext context,
  WidgetRef ref, {
  required GlobalKey anchorKey,
  required ThreadRuntimeConfigInput runtimeConfig,
  required String threadId,
  required ValueChanged<ThreadRuntimeConfigInput> onChanged,
  required ModelProviderView provider,
  required OrchestrationModelRef templateModel,
  String? coreKind,
  ValueChanged<String>? onCoreKindChanged,
}) {
  final box = anchorKey.currentContext?.findRenderObject() as RenderBox?;
  if (box == null || !box.hasSize) return Future<void>.value();

  final overlayState = Overlay.of(context);
  final overlayBox = overlayState.context.findRenderObject() as RenderBox;
  final anchorOrigin = box.localToGlobal(Offset.zero, ancestor: overlayBox);
  final anchorRect = anchorOrigin & box.size;
  final completer = Completer<void>();
  late OverlayEntry entry;

  void dismiss() {
    if (entry.mounted) entry.remove();
    if (!completer.isCompleted) completer.complete();
  }

  entry = OverlayEntry(
    builder: (overlayContext) {
      return _ComposerCascadeOverlay(
        anchorRect: anchorRect,
        runtimeConfig: runtimeConfig,
        threadId: threadId,
        onChanged: onChanged,
        provider: provider,
        templateModel: templateModel,
        coreKind: coreKind,
        onCoreKindChanged: onCoreKindChanged,
        onDismiss: dismiss,
      );
    },
  );

  overlayState.insert(entry);
  return completer.future;
}

class _ComposerCascadeOverlay extends ConsumerStatefulWidget {
  const _ComposerCascadeOverlay({
    required this.anchorRect,
    required this.runtimeConfig,
    required this.threadId,
    required this.onChanged,
    required this.provider,
    required this.templateModel,
    required this.onDismiss,
    this.coreKind,
    this.onCoreKindChanged,
  });

  final Rect anchorRect;
  final ThreadRuntimeConfigInput runtimeConfig;
  final String threadId;
  final ValueChanged<ThreadRuntimeConfigInput> onChanged;
  final ModelProviderView provider;
  final OrchestrationModelRef templateModel;
  final String? coreKind;
  final ValueChanged<String>? onCoreKindChanged;
  final VoidCallback onDismiss;

  @override
  ConsumerState<_ComposerCascadeOverlay> createState() =>
      _ComposerCascadeOverlayState();
}

class _ComposerCascadeOverlayState
    extends ConsumerState<_ComposerCascadeOverlay> {
  late ThreadRuntimeConfigInput _config;
  late String? _coreKind;
  /// Null until Model / Reasoning / Agent is tapped — then the side submenu appears.
  _CascadeBranch? _branch;
  /// Advanced is an inline disclosure, not a cascade branch.
  var _advancedExpanded = false;

  static const _primaryWidth = 208.0;
  static const _submenuWidthIdeal = 260.0;
  static const _panelGap = 8.0;
  static const _rowHeight = 44.0;
  static const _rowHeightWithSubtitle = 54.0;
  static const _radius = 16.0;
  static const _edgePad = 12.0;

  double get _primaryHeight {
    final rows = 3 + (_advancedExpanded ? 3 : 0);
    return rows * _rowHeight + (rows - 1) * 0.5;
  }

  @override
  void initState() {
    super.initState();
    _config = widget.runtimeConfig;
    _coreKind = widget.coreKind;
  }

  void _persist(MainAgentModelOverride? nextOverride, {bool dismiss = false}) {
    final next = nextOverride == null
        ? _config.copyWith(clearMainAgentModelOverride: true)
        : _config.copyWith(mainAgentModelOverride: nextOverride);
    setState(() => _config = next);
    persistRuntimeConfig(
      ref,
      threadId: widget.threadId,
      config: next,
      onChanged: widget.onChanged,
    );
    if (dismiss) widget.onDismiss();
  }

  void _selectCoreKind(String value) {
    if (_coreKind == value) return;
    setState(() => _coreKind = value);
    widget.onCoreKindChanged?.call(value);
  }

  void _persistConfig(ThreadRuntimeConfigInput next) {
    setState(() => _config = next);
    persistRuntimeConfig(
      ref,
      threadId: widget.threadId,
      config: next,
      onChanged: widget.onChanged,
    );
  }

  void _selectAuxiliary(CommitModelOptionView? option) {
    final selection = option == null
        ? null
        : AuxiliaryModelSelection(
            providerId: option.providerId,
            modelId: option.modelId,
            candidateModelId: option.candidateModelId,
          );
    var next = option == null
        ? _config.copyWith(clearAuxiliaryModel: true)
        : _config.copyWith(auxiliaryModel: selection);
    next = downgradeAuxiliaryDependentFeatures(next);
    _persistConfig(next);
    persistAuxiliaryModelWorkflowDefault(
      ref,
      selection: selection,
    ).catchError((_) {});
  }

  void _selectVision(CommitModelOptionView? option) {
    final selection = option == null
        ? null
        : VisionModelSelection(
            providerId: option.providerId,
            modelId: option.modelId,
            candidateModelId: option.candidateModelId,
          );
    final next = option == null
        ? _config.copyWith(clearVisionModel: true)
        : _config.copyWith(visionModel: selection);
    _persistConfig(next);
    persistVisionModelWorkflowDefault(
      ref,
      selection: selection,
    ).catchError((_) {});
  }

  String _coreKindLabel(AppLocalizations l10n) {
    return switch (_coreKind) {
      'codex' => 'Codex',
      'claude' => 'Claude Code',
      _ => l10n.commonUnavailable,
    };
  }

  String _modelSelectionLabel(AppLocalizations l10n, {required bool vision}) {
    if (vision) {
      final selection = _config.visionModel;
      if (selection == null) return l10n.composerNone;
      return composerModelDisplayName(selection.modelId);
    }
    final selection = _config.auxiliaryModel;
    if (selection == null) return l10n.composerNone;
    return composerModelDisplayName(selection.modelId);
  }

  void _setBranch(_CascadeBranch? branch) {
    setState(() => _branch = branch);
  }

  void _toggleAdvanced() {
    setState(() {
      _advancedExpanded = !_advancedExpanded;
      if (!_advancedExpanded &&
          (_branch == _CascadeBranch.agent ||
              _branch == _CascadeBranch.auxiliary ||
              _branch == _CascadeBranch.vision)) {
        _branch = null;
      }
    });
  }

  double _safeClamp(double value, double min, double max) {
    if (max < min) return min;
    return value.clamp(min, max);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final eco = ecoColors(context);
    final media = MediaQuery.of(context);
    final viewPadding = media.viewPadding;
    // Prefer live overlay size — captured size can be wrong before layout.
    final overlaySize = media.size;
    final anchor = widget.anchorRect;
    final branch = _branch;
    final showSubmenu = branch != null;

    final candidates = ref.watch(candidateModelsProvider(widget.provider.id));
    final options = buildComposerTemporaryModelOptions(
      provider: widget.provider,
      templateModel: widget.templateModel,
      candidates: candidates.valueOrNull ?? const [],
    );
    final modelOverride = _config.mainAgentModelOverride;
    final currentModel = resolveComposerTemporaryModel(
      options: options,
      override: modelOverride,
      templateModel: widget.templateModel,
    );
    final currentEffort =
        composerTemporaryModelEffort(modelOverride, widget.templateModel) ??
        'off';
    final effortLabel = composerThinkingEffortLabel(currentEffort, l10n);
    final modelName = composerModelDisplayName(currentModel.modelId);
    final reasoningUnavailable = currentModel.supportsReasoning == false;
    final templateSelected = composerTemporaryModelMatchesTemplate(
      currentModel,
      widget.templateModel,
    );

    final mainAgentConfigId =
        _config.orchestrationSelection?.mainAgentConfigId.trim() ?? '';
    final auxOptionsAsync = mainAgentConfigId.isEmpty
        ? null
        : ref.watch(auxiliaryModelOptionsProvider(mainAgentConfigId));

    final availableWidth =
        overlaySize.width - viewPadding.left - viewPadding.right - _edgePad * 2;
    final sideBySide =
        showSubmenu && availableWidth >= _primaryWidth + _panelGap + 160;
    final submenuWidth = sideBySide
        ? math.min(
            _submenuWidthIdeal,
            availableWidth - _primaryWidth - _panelGap,
          )
        : math.min(_submenuWidthIdeal, availableWidth);
    final cascadeWidth = !showSubmenu
        ? _primaryWidth
        : sideBySide
        ? _primaryWidth + _panelGap + submenuWidth
        : math.max(_primaryWidth, submenuWidth);

    final submenuItems = showSubmenu
        ? _buildSubmenuItems(
            l10n: l10n,
            options: options,
            modelOverride: modelOverride,
            currentModel: currentModel,
            currentEffort: currentEffort,
            templateSelected: templateSelected,
            reasoningUnavailable: reasoningUnavailable,
            candidatesLoading: candidates.isLoading,
            candidatesError: candidates.hasError,
            auxOptions: auxOptionsAsync,
          )
        : const <_SubmenuItem>[];

    final submenuHeight = showSubmenu
        ? math.min(
            overlaySize.height * 0.48,
            submenuItems.fold<double>(
                  8,
                  (sum, item) => sum + item.rowHeight,
                ),
          )
        : 0.0;

    final minLeft = viewPadding.left + _edgePad;
    final maxBottom = overlaySize.height - viewPadding.bottom - _edgePad;
    final minTop = viewPadding.top + _edgePad;

    // Anchor primary to its own height so opening a tall submenu never lifts it.
    final primaryMaxTop = maxBottom - _primaryHeight;
    var primaryTop = anchor.top - _primaryHeight - 10;
    if (primaryTop < minTop) {
      primaryTop = anchor.bottom + 10;
    }
    primaryTop = _safeClamp(primaryTop, minTop, primaryMaxTop);

    final maxLeft =
        overlaySize.width - cascadeWidth - viewPadding.right - _edgePad;
    final left = _safeClamp(
      anchor.right - cascadeWidth,
      minLeft,
      maxLeft,
    );

    // Side submenu: prefer matching primary's top; if that would go past the
    // screen bottom, slide the submenu up (primary stays put).
    var submenuTop = primaryTop;
    if (sideBySide && showSubmenu) {
      if (submenuTop + submenuHeight > maxBottom) {
        submenuTop = maxBottom - submenuHeight;
      }
      submenuTop = _safeClamp(submenuTop, minTop, maxBottom - submenuHeight);
    }

    final stackedHeight = showSubmenu && !sideBySide
        ? _primaryHeight + _panelGap + submenuHeight
        : _primaryHeight;
    var stackedTop = primaryTop;
    if (showSubmenu && !sideBySide) {
      stackedTop = primaryTop - _panelGap - submenuHeight;
      if (stackedTop < minTop) {
        stackedTop = primaryTop;
      }
      stackedTop = _safeClamp(
        stackedTop,
        minTop,
        maxBottom - stackedHeight,
      );
    }

    final primaryPanel = SizedBox(
      width: _primaryWidth,
      child: _buildPrimaryPanel(
        l10n: l10n,
        eco: eco,
        modelName: modelName,
        effortLabel: effortLabel,
      ),
    );

    final submenuPanel = showSubmenu
        ? SizedBox(
            width: sideBySide ? submenuWidth : math.min(_submenuWidthIdeal, availableWidth),
            child: _buildSubmenuPanel(
              items: submenuItems,
              maxHeight: submenuHeight,
            ),
          )
        : null;

    return Material(
      type: MaterialType.transparency,
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: widget.onDismiss,
              child: ColoredBox(
                color: eco.shadowScrim.withValues(alpha: 0.10),
              ),
            ),
          ),
          if (!showSubmenu)
            Positioned(
              left: left,
              top: primaryTop,
              width: _primaryWidth,
              child: primaryPanel,
            )
          else if (sideBySide) ...[
            Positioned(
              left: left,
              top: primaryTop,
              width: _primaryWidth,
              child: primaryPanel,
            ),
            Positioned(
              left: left + _primaryWidth + _panelGap,
              top: submenuTop,
              width: submenuWidth,
              child: submenuPanel!,
            ),
          ] else
            Positioned(
              left: left,
              top: stackedTop,
              width: cascadeWidth,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  submenuPanel!,
                  const SizedBox(height: _panelGap),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: primaryPanel,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildPrimaryPanel({
    required AppLocalizations l10n,
    required EcoColors eco,
    required String modelName,
    required String effortLabel,
  }) {
    final mainAgentConfigId =
        _config.orchestrationSelection?.mainAgentConfigId.trim() ?? '';
    final canPickAuxVision = mainAgentConfigId.isNotEmpty;

    return _GlassPanel(
      radius: _radius,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _PrimaryRow(
            label: l10n.composerModel,
            value: modelName,
            selected: _branch == _CascadeBranch.model,
            onTap: () {
              HapticFeedback.selectionClick();
              _setBranch(_CascadeBranch.model);
            },
          ),
          _Hairline(eco: eco),
          _PrimaryRow(
            label: l10n.composerReasoningIntensity,
            value: effortLabel,
            selected: _branch == _CascadeBranch.effort,
            onTap: () {
              HapticFeedback.selectionClick();
              _setBranch(_CascadeBranch.effort);
            },
          ),
          _Hairline(eco: eco),
          EcoPressable(
            scale: 0.98,
            onTap: () {
              HapticFeedback.selectionClick();
              _toggleAdvanced();
            },
            child: SizedBox(
              height: _rowHeight,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.composerAdvanced,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w400,
                          letterSpacing: -0.2,
                          color: eco.textMuted,
                        ),
                      ),
                    ),
                    Icon(
                      _advancedExpanded
                          ? EcoIcons.expandUp
                          : EcoIcons.expandDown,
                      size: 14,
                      color: eco.textMuted,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_advancedExpanded) ...[
            _Hairline(eco: eco),
            _PrimaryRow(
              label: l10n.composerAgent,
              value: _coreKindLabel(l10n),
              selected: _branch == _CascadeBranch.agent,
              enabled: _coreKind != null,
              onTap: () {
                if (_coreKind == null) return;
                HapticFeedback.selectionClick();
                _setBranch(_CascadeBranch.agent);
              },
            ),
            _Hairline(eco: eco),
            _PrimaryRow(
              label: l10n.composerAux,
              value: _modelSelectionLabel(l10n, vision: false),
              selected: _branch == _CascadeBranch.auxiliary,
              enabled: canPickAuxVision,
              onTap: () {
                if (!canPickAuxVision) return;
                HapticFeedback.selectionClick();
                _setBranch(_CascadeBranch.auxiliary);
              },
            ),
            _Hairline(eco: eco),
            _PrimaryRow(
              label: l10n.composerVision,
              value: _modelSelectionLabel(l10n, vision: true),
              selected: _branch == _CascadeBranch.vision,
              enabled: canPickAuxVision,
              onTap: () {
                if (!canPickAuxVision) return;
                HapticFeedback.selectionClick();
                _setBranch(_CascadeBranch.vision);
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSubmenuPanel({
    required List<_SubmenuItem> items,
    required double maxHeight,
  }) {
    return _GlassPanel(
      radius: _radius,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: ListView.builder(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 4),
          itemCount: items.length,
          itemBuilder: (context, index) => _SubmenuRow(item: items[index]),
        ),
      ),
    );
  }

  List<_SubmenuItem> _buildSubmenuItems({
    required AppLocalizations l10n,
    required List<ComposerTemporaryModelOption> options,
    required MainAgentModelOverride? modelOverride,
    required ComposerTemporaryModelOption currentModel,
    required String currentEffort,
    required bool templateSelected,
    required bool reasoningUnavailable,
    required bool candidatesLoading,
    required bool candidatesError,
    required AsyncValue<List<CommitModelOptionView>>? auxOptions,
  }) {
    if (_branch == _CascadeBranch.model) {
      return [
        _SubmenuItem(
          label: composerModelDisplayName(widget.templateModel.modelId),
          selected: templateSelected,
          onTap: () {
            HapticFeedback.selectionClick();
            _persist(
              buildComposerTemporaryModelOverride(
                model: ComposerTemporaryModelOption(
                  providerId: widget.templateModel.providerId,
                  modelId: widget.templateModel.modelId,
                  candidateModelId: widget.templateModel.candidateModelId,
                ),
                thinkingEffort: currentEffort,
                templateModel: widget.templateModel,
              ),
              dismiss: true,
            );
          },
        ),
        if (candidatesLoading)
          _SubmenuItem(
            label: l10n.commonLoading,
            selected: false,
            enabled: false,
            onTap: () {},
          )
        else if (candidatesError)
          _SubmenuItem(
            label: l10n.composerModelLoadFailed,
            selected: false,
            enabled: false,
            onTap: () {},
          )
        else
          for (final option in options.where(
            (o) =>
                !composerTemporaryModelMatchesTemplate(o, widget.templateModel),
          ))
            _SubmenuItem(
              label: option.displayName?.isNotEmpty == true
                  ? option.displayName!
                  : composerModelDisplayName(option.modelId),
              selected: composerTemporaryModelSelected(modelOverride, option),
              onTap: () {
                HapticFeedback.selectionClick();
                _persist(
                  buildComposerTemporaryModelOverride(
                    model: option,
                    thinkingEffort: option.supportsReasoning == false
                        ? 'off'
                        : currentEffort,
                    templateModel: widget.templateModel,
                  ),
                  dismiss: true,
                );
              },
            ),
      ];
    }

    if (_branch == _CascadeBranch.effort) {
      return [
        for (final option in composerThinkingEffortOptions(l10n))
          _SubmenuItem(
            label: option.label,
            selected: currentEffort == option.value,
            enabled: !reasoningUnavailable || option.value == 'off',
            onTap: () {
              if (reasoningUnavailable && option.value != 'off') return;
              HapticFeedback.selectionClick();
              _persist(
                buildComposerTemporaryModelOverride(
                  model: currentModel,
                  thinkingEffort: option.value,
                  templateModel: widget.templateModel,
                ),
              );
            },
          ),
      ];
    }

    if (_branch == _CascadeBranch.agent) {
      return [
        for (final option in composerCoreKindOptions)
          _SubmenuItem(
            label: option.label,
            selected: _coreKind == option.value,
            enabled: widget.onCoreKindChanged != null,
            onTap: () {
              if (widget.onCoreKindChanged == null) return;
              HapticFeedback.selectionClick();
              _selectCoreKind(option.value);
            },
          ),
      ];
    }

    final isVision = _branch == _CascadeBranch.vision;
    final selectedCandidateId = isVision
        ? _config.visionModel?.candidateModelId
        : _config.auxiliaryModel?.candidateModelId;

    return [
      _SubmenuItem(
        label: l10n.composerNone,
        selected: isVision
            ? _config.visionModel == null
            : _config.auxiliaryModel == null,
        onTap: () {
          HapticFeedback.selectionClick();
          if (isVision) {
            _selectVision(null);
          } else {
            _selectAuxiliary(null);
          }
        },
      ),
      if (auxOptions == null)
        _SubmenuItem(
          label: l10n.commonUnavailable,
          selected: false,
          enabled: false,
          onTap: () {},
        )
      else
        ...auxOptions.when(
          data: (items) => [
            for (final option in items)
              _SubmenuItem(
                label: composerModelDisplayName(option.modelId),
                subtitle: option.providerName.trim().isEmpty
                    ? null
                    : option.providerName.trim(),
                selected: selectedCandidateId == option.candidateModelId,
                onTap: () {
                  HapticFeedback.selectionClick();
                  if (isVision) {
                    _selectVision(option);
                  } else {
                    _selectAuxiliary(option);
                  }
                },
              ),
          ],
          loading: () => [
            _SubmenuItem(
              label: l10n.commonLoading,
              selected: false,
              enabled: false,
              onTap: () {},
            ),
          ],
          error: (_, _) => [
            _SubmenuItem(
              label: l10n.composerModelLoadFailed,
              selected: false,
              enabled: false,
              onTap: () {},
            ),
          ],
        ),
    ];
  }
}

class _SubmenuItem {
  const _SubmenuItem({
    required this.label,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.enabled = true,
  });

  final String label;
  final String? subtitle;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  double get rowHeight => subtitle == null
      ? _ComposerCascadeOverlayState._rowHeight
      : _ComposerCascadeOverlayState._rowHeightWithSubtitle;
}

class _GlassPanel extends StatelessWidget {
  const _GlassPanel({required this.child, required this.radius});

  final Widget child;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final borderRadius = BorderRadius.circular(radius);
    final panel = Material(type: MaterialType.transparency, child: child);

    final Widget surface;
    if (PlatformInfo.isIOS26OrHigher()) {
      // Native UIVisualEffectView — no custom white sheen.
      surface = AdaptiveBlurView(
        blurStyle: BlurStyle.systemThinMaterial,
        borderRadius: borderRadius,
        child: panel,
      );
    } else if (PlatformInfo.isAndroid) {
      surface = EcoAndroidGlassSurface(
        borderRadius: borderRadius,
        child: panel,
      );
    } else {
      surface = ClipRRect(
        borderRadius: borderRadius,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 40, sigmaY: 40),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: borderRadius,
              color: isDark
                  ? const Color(0xCC1C1C1E)
                  : const Color(0xE6F2F2F7),
              border: Border.all(
                color: isDark
                    ? Colors.white.withValues(alpha: 0.10)
                    : Colors.black.withValues(alpha: 0.06),
                width: 0.5,
              ),
            ),
            child: panel,
          ),
        ),
      );
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: borderRadius,
        boxShadow: [
          BoxShadow(
            color: eco.shadowScrim.withValues(alpha: isDark ? 0.40 : 0.12),
            blurRadius: 32,
            spreadRadius: -2,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: surface,
    );
  }
}

class _PrimaryRow extends StatelessWidget {
  const _PrimaryRow({
    required this.label,
    required this.value,
    required this.selected,
    required this.onTap,
    this.enabled = true,
  });

  final String label;
  final String value;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return EcoPressable(
      enabled: enabled,
      scale: 0.98,
      onTap: onTap,
      child: Opacity(
        opacity: enabled ? 1 : 0.45,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(6, 4, 6, 4),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            height: _ComposerCascadeOverlayState._rowHeight - 8,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: selected
                  ? (isDark
                        ? Colors.white.withValues(alpha: 0.12)
                        : Colors.black.withValues(alpha: 0.06))
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    letterSpacing: -0.25,
                    color: eco.textPrimary,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w400,
                      letterSpacing: -0.2,
                      color: eco.textMuted,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                Icon(EcoIcons.chevronRight, size: 16, color: eco.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SubmenuRow extends StatelessWidget {
  const _SubmenuRow({required this.item});

  final _SubmenuItem item;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final subtitle = item.subtitle?.trim();
    return EcoPressable(
      enabled: item.enabled,
      scale: 0.98,
      onTap: item.onTap,
      child: Opacity(
        opacity: item.enabled ? 1 : 0.45,
        child: SizedBox(
          height: item.rowHeight,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: item.selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                          letterSpacing: -0.25,
                          height: 1.15,
                          color: eco.textPrimary,
                        ),
                      ),
                      if (subtitle != null && subtitle.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w400,
                            letterSpacing: -0.1,
                            height: 1.1,
                            color: eco.textMuted,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (item.selected)
                  Icon(EcoIcons.check, size: 17, color: eco.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Hairline extends StatelessWidget {
  const _Hairline({required this.eco});

  final EcoColors eco;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(left: 14),
      child: Divider(
        height: 0.33,
        thickness: 0.33,
        color: eco.borderSubtle.withValues(alpha: isDark ? 0.28 : 0.22),
      ),
    );
  }
}

/// Shared resolver used by the toolbar control and the sheet.
ComposerTemporaryModelOption resolveComposerTemporaryModel({
  required List<ComposerTemporaryModelOption> options,
  required MainAgentModelOverride? override,
  required OrchestrationModelRef templateModel,
}) {
  if (override != null) {
    for (final option in options) {
      if (composerTemporaryModelSelected(override, option)) return option;
    }
    return ComposerTemporaryModelOption(
      providerId: override.providerId,
      modelId: override.modelId,
      candidateModelId: override.candidateModelId,
      supportsReasoning: null,
    );
  }
  for (final option in options) {
    if (composerTemporaryModelMatchesTemplate(option, templateModel)) {
      return option;
    }
  }
  return ComposerTemporaryModelOption(
    providerId: templateModel.providerId,
    modelId: templateModel.modelId,
    candidateModelId: templateModel.candidateModelId,
  );
}
