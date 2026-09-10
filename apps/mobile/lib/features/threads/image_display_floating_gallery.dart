import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../core/models/image_display_models.dart';
import '../../core/models/image_view_models.dart';
import '../../core/theme/eco_theme.dart';
import '../composer/composer_stack_card.dart';

typedef ImageDisplayBytesLoader =
    Future<ImageViewReadData> Function(String artifactId);

/// Desktop-like floating gallery for `display_image` artifacts.
///
/// Collapsed: bubble with count on the trailing edge.
/// Expanded: frosted card with thumbnails; tap opens fullscreen lightbox.
class ImageDisplayFloatingGallery extends StatefulWidget {
  const ImageDisplayFloatingGallery({
    super.key,
    required this.artifacts,
    required this.loadBytes,
    this.controller,
    this.bottomInset = 0,
  });

  final List<ImageDisplayArtifact> artifacts;
  final ImageDisplayBytesLoader loadBytes;
  final ImageDisplayFloatingGalleryController? controller;
  final double bottomInset;

  @override
  State<ImageDisplayFloatingGallery> createState() =>
      _ImageDisplayFloatingGalleryState();
}

class ImageDisplayFloatingGalleryController extends ChangeNotifier {
  String? _focusArtifactId;
  var _expandToken = 0;

  String? get focusArtifactId => _focusArtifactId;
  int get expandToken => _expandToken;

  void reveal({String? artifactId}) {
    _focusArtifactId = artifactId;
    _expandToken += 1;
    notifyListeners();
  }

  void clearFocus() {
    if (_focusArtifactId == null) return;
    _focusArtifactId = null;
    notifyListeners();
  }
}

class _ImageDisplayFloatingGalleryState
    extends State<ImageDisplayFloatingGallery>
    with SingleTickerProviderStateMixin {
  var _expanded = true;
  var _pulse = false;
  String? _highlightId;
  int _lastSeenCount = 0;
  int _lastExpandToken = 0;
  late final AnimationController _pulseController;
  final Map<String, Future<ImageViewReadData>> _thumbFutures = {};

  @override
  void initState() {
    super.initState();
    _lastSeenCount = widget.artifacts.length;
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    widget.controller?.addListener(_onController);
  }

  @override
  void didUpdateWidget(covariant ImageDisplayFloatingGallery oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller?.removeListener(_onController);
      widget.controller?.addListener(_onController);
    }
    final nextCount = widget.artifacts.length;
    if (nextCount > _lastSeenCount) {
      _lastSeenCount = nextCount;
      _expanded = true;
      _triggerPulse();
      final newest = widget.artifacts.isEmpty ? null : widget.artifacts.last.id;
      _highlightId = newest;
    } else {
      _lastSeenCount = nextCount;
    }
    final liveIds = widget.artifacts.map((item) => item.id).toSet();
    _thumbFutures.removeWhere((id, _) => !liveIds.contains(id));
  }

  @override
  void dispose() {
    widget.controller?.removeListener(_onController);
    _pulseController.dispose();
    super.dispose();
  }

  void _onController() {
    final controller = widget.controller;
    if (controller == null) return;
    if (controller.expandToken != _lastExpandToken) {
      _lastExpandToken = controller.expandToken;
      setState(() {
        _expanded = true;
        _highlightId = controller.focusArtifactId;
      });
      _triggerPulse();
    }
  }

  void _triggerPulse() {
    setState(() => _pulse = true);
    unawaited(
      _pulseController.forward(from: 0).then((_) {
        if (!mounted) return;
        setState(() => _pulse = false);
      }),
    );
  }

  Future<ImageViewReadData> _thumbFuture(String artifactId) {
    return _thumbFutures.putIfAbsent(
      artifactId,
      () => widget.loadBytes(artifactId),
    );
  }

  Future<void> _openLightbox(ImageDisplayArtifact artifact) async {
    ImageViewReadData? image;
    try {
      image = await _thumbFuture(artifact.id);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.activityImageDisplayErrorReadFailed)),
      );
      return;
    }
    if (!mounted) return;
    final eco = ecoColors(context);
    await showDialog<void>(
      context: context,
      barrierColor: eco.bgOverlay,
      builder: (context) => Dialog.fullscreen(
        backgroundColor: eco.bgElevated,
        child: SafeArea(
          child: Stack(
            fit: StackFit.expand,
            children: [
              InteractiveViewer(
                minScale: 0.5,
                maxScale: 6,
                boundaryMargin: const EdgeInsets.all(48),
                child: Center(
                  child: ColoredBox(
                    color: eco.cardSurface,
                    child: Image.memory(
                      image!.bytes,
                      fit: BoxFit.contain,
                      filterQuality: FilterQuality.high,
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 8,
                left: 16,
                right: 64,
                child: Text(
                  artifact.displayTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: eco.textMuted),
                ),
              ),
              Positioned(
                top: 0,
                right: 0,
                child: IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.artifacts.isEmpty) return const SizedBox.shrink();

    final eco = ecoColors(context);
    final media = MediaQuery.of(context);
    final top = media.padding.top + kToolbarHeight + 12;
    final bottom = widget.bottomInset + 12;

    return Positioned(
      top: top,
      right: 12,
      bottom: bottom,
      width: _expanded ? 168 : null,
      child: Align(
        alignment: Alignment.topRight,
        child: AnimatedScale(
          scale: _pulse ? 1.06 : 1,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutBack,
          child: _expanded ? _buildExpanded(eco) : _buildCollapsed(eco),
        ),
      ),
    );
  }

  Widget _buildCollapsed(EcoColors eco) {
    final count = widget.artifacts.length;
    return Material(
      color: Colors.transparent,
      child: ComposerStackCard(
        frosted: true,
        stadium: true,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        onTap: () => setState(() => _expanded = true),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.photo_library_outlined, size: 18, color: eco.accent),
            const SizedBox(width: 6),
            Text(
              '$count',
              style: TextStyle(
                color: eco.composerPillText,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildExpanded(EcoColors eco) {
    final l10n = context.l10n;
    return ComposerStackCard(
      frosted: true,
      padding: EdgeInsets.zero,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 360),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 4, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.taskImageDisplayHistory,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: eco.textHeading,
                        fontWeight: FontWeight.w600,
                        fontSize: 12.5,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    tooltip: l10n.commonCollapse,
                    onPressed: () => setState(() => _expanded = false),
                    icon: Icon(Icons.remove, size: 16, color: eco.textMuted),
                  ),
                ],
              ),
            ),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                itemCount: widget.artifacts.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final artifact = widget.artifacts[index];
                  final highlighted = artifact.id == _highlightId;
                  return _ArtifactThumbRow(
                    artifact: artifact,
                    highlighted: highlighted,
                    future: _thumbFuture(artifact.id),
                    onTap: () => unawaited(_openLightbox(artifact)),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ArtifactThumbRow extends StatelessWidget {
  const _ArtifactThumbRow({
    required this.artifact,
    required this.future,
    required this.onTap,
    required this.highlighted,
  });

  final ImageDisplayArtifact artifact;
  final Future<ImageViewReadData> future;
  final VoidCallback onTap;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    return Material(
      color: highlighted ? eco.accentSoft : eco.cardSurface,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: AspectRatio(
                  aspectRatio: 1,
                  child: ColoredBox(
                    color: eco.bgElevated,
                    child: FutureBuilder<ImageViewReadData>(
                      future: future,
                      builder: (context, snapshot) {
                        if (snapshot.hasData) {
                          return Image.memory(
                            snapshot.data!.bytes,
                            fit: BoxFit.cover,
                            filterQuality: FilterQuality.medium,
                          );
                        }
                        if (snapshot.hasError) {
                          return Icon(
                            Icons.broken_image_outlined,
                            color: eco.textMuted,
                            size: 22,
                          );
                        }
                        return const Center(
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        );
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                artifact.displayTitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: eco.textPrimary,
                  fontSize: 11,
                  height: 1.25,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
