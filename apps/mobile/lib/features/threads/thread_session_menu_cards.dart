import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/html_host_models.dart';
import '../../core/models/image_display_models.dart';
import '../../core/models/image_generation_models.dart';
import '../../core/models/thread_models.dart';
import '../../core/network/desktop_rpc.dart';
import '../../core/providers/app_providers.dart';
import '../../core/utils/thread_session_menu_visibility.dart';
import '../../core/utils/thread_todo_live.dart';
import 'html_host_artifacts.dart';
import 'image_display_artifacts.dart';
import 'thread_providers.dart';

class ThreadSessionMenuCards {
  const ThreadSessionMenuCards({
    required this.showProgress,
    required this.showPlan,
    required this.showImageDisplay,
    required this.showImageGeneration,
    required this.showHtmlHost,
    this.imageDisplayArtifacts = const [],
    this.imageGenerationArtifacts = const [],
    this.htmlHostArtifacts = const [],
  });

  final bool showProgress;
  final bool showPlan;
  final bool showImageDisplay;
  final bool showImageGeneration;
  final bool showHtmlHost;
  final List<ImageDisplayArtifact> imageDisplayArtifacts;
  final List<ImageGenerationArtifact> imageGenerationArtifacts;
  final List<HtmlHostArtifact> htmlHostArtifacts;

  static const empty = ThreadSessionMenuCards(
    showProgress: false,
    showPlan: false,
    showImageDisplay: false,
    showImageGeneration: false,
    showHtmlHost: false,
  );
}

Future<T> _safeMenuCardsLoad<T>(
  Future<T> Function() load,
  T fallback,
) async {
  try {
    return await load();
  } catch (_) {
    return fallback;
  }
}

/// Desktop workspace-cards parity signals for the session overflow menu.
///
/// Rebuilds when pending plan / projection change, and when todo/plan live
/// events arrive. Artifact lists come from Desktop RPC (+ projection merge).
final threadSessionMenuCardsProvider = FutureProvider.autoDispose
    .family<ThreadSessionMenuCards, String>((ref, threadId) async {
      if (threadId.isEmpty) return ThreadSessionMenuCards.empty;

      final session = ref.watch(
        threadSessionProvider(threadId).select(
          (state) => (projection: state.runProjection),
        ),
      );

      ref.listen(ecoEventsProvider, (_, next) {
        next.whenData((event) {
          final todos = threadTodoListFromLiveEvent(
            threadId: threadId,
            envelopeThreadId: event.threadId,
            payload: event.payload,
          );
          if (todos != null) {
            ref.invalidateSelf();
            return;
          }
          if (event.kind == 'thread.plan') {
            ref.invalidateSelf();
          }
        });
      });

      final fromProjectionDisplay = collectImageDisplayArtifactsFromProjection(
        threadId: threadId,
        projection: session.projection,
      );
      final fromProjectionHtml = collectHtmlHostArtifactsFromProjection(
        threadId: threadId,
        projection: session.projection,
      );

      final rpc = ref.watch(desktopRpcProvider);
      if (rpc == null) {
        return ThreadSessionMenuCards(
          showProgress: false,
          showPlan: false,
          showImageDisplay: fromProjectionDisplay.isNotEmpty,
          showImageGeneration: false,
          showHtmlHost: fromProjectionHtml.isNotEmpty,
          imageDisplayArtifacts: fromProjectionDisplay,
          htmlHostArtifacts: fromProjectionHtml,
        );
      }

      final loaded = await _loadMenuCardsRemote(
        rpc: rpc,
        threadId: threadId,
        fromProjectionDisplay: fromProjectionDisplay,
        fromProjectionHtml: fromProjectionHtml,
      );
      return loaded;
    });

Future<ThreadSessionMenuCards> _loadMenuCardsRemote({
  required DesktopRpc rpc,
  required String threadId,
  required List<ImageDisplayArtifact> fromProjectionDisplay,
  required List<HtmlHostArtifact> fromProjectionHtml,
}) async {
  final todos = await _safeMenuCardsLoad(
    () => rpc.listThreadTodos(threadId),
    const <CoderTodoItem>[],
  );
  final approvedPlan = await _safeMenuCardsLoad(
    () => rpc.getApprovedPlan(threadId),
    null,
  );
  final remoteDisplay = await _safeMenuCardsLoad(
    () => rpc.listImageDisplayArtifacts(threadId),
    const <ImageDisplayArtifact>[],
  );
  final imageGeneration = await _safeMenuCardsLoad(
    () => rpc.listImageGenerationArtifacts(threadId),
    const <ImageGenerationArtifact>[],
  );
  final remoteHtml = await _safeMenuCardsLoad(
    () => rpc.listHtmlHostArtifacts(threadId),
    const <HtmlHostArtifact>[],
  );

  final imageDisplay = mergeImageDisplayArtifacts(
    fromProjection: fromProjectionDisplay,
    fromRemote: remoteDisplay,
  );
  final htmlHost = mergeHtmlHostArtifacts(
    fromProjection: fromProjectionHtml,
    fromRemote: remoteHtml,
  );

  return ThreadSessionMenuCards(
    showProgress: threadMenuShouldShowProgress(todos),
    showPlan: threadMenuShouldShowPlan(approvedPlan: approvedPlan),
    showImageDisplay: imageDisplay.isNotEmpty,
    showImageGeneration: imageGeneration.isNotEmpty,
    showHtmlHost: htmlHost.isNotEmpty,
    imageDisplayArtifacts: imageDisplay,
    imageGenerationArtifacts: imageGeneration,
    htmlHostArtifacts: htmlHost,
  );
}
