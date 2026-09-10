import '../../core/models/html_host_models.dart';
import '../../core/models/thread_run_projection.dart';
import '../../core/utils/activity_display.dart';

/// Collect publish_html artifacts from the live run projection.
List<HtmlHostArtifact> collectHtmlHostArtifactsFromProjection({
  required String threadId,
  ThreadRunProjectionSnapshot? projection,
}) {
  if (projection == null) return const [];
  final byPageId = <String, HtmlHostArtifact>{};

  void scan(Iterable<ThreadRunProjectionTimelineItem> items) {
    for (final item in items) {
      final tool = readProjectionToolMetadata(item.metadata);
      final host = tool?.htmlHost;
      final pageId = host?.pageId.trim() ?? '';
      final publicUrl = host?.publicUrl.trim() ?? '';
      if (pageId.isEmpty || publicUrl.isEmpty) continue;
      final title = host?.title?.trim() ?? '';
      final existing = byPageId[pageId];
      if (existing != null &&
          (title.isEmpty || existing.title.trim().isNotEmpty)) {
        continue;
      }
      byPageId[pageId] = HtmlHostArtifact(
        id: existing?.id.isNotEmpty == true ? existing!.id : pageId,
        threadId: threadId,
        toolUseId: tool?.toolUseId ?? existing?.toolUseId,
        status: tool?.status == 'failed' ? 'failed' : 'completed',
        pageId: pageId,
        slug: existing?.slug ?? '',
        title: title.isNotEmpty ? title : (existing?.title ?? ''),
        publicUrl: publicUrl,
        expiresAt: host?.expiresAt ?? existing?.expiresAt ?? '',
        canExtend: host?.canExtend ?? existing?.canExtend ?? false,
        createdAt: item.at.isNotEmpty ? item.at : (existing?.createdAt ?? ''),
        updatedAt: item.at.isNotEmpty ? item.at : (existing?.updatedAt ?? ''),
      );
    }
  }

  scan(projection.timeline);
  for (final agent in projection.agents) {
    scan(agent.timeline);
  }

  final artifacts = byPageId.values.toList();
  artifacts.sort((left, right) {
    final byCreated = left.createdAt.compareTo(right.createdAt);
    if (byCreated != 0) return byCreated;
    return left.id.compareTo(right.id);
  });
  return List<HtmlHostArtifact>.unmodifiable(artifacts);
}

/// Prefer remote list metadata; keep projection-only entries as fallback.
List<HtmlHostArtifact> mergeHtmlHostArtifacts({
  required List<HtmlHostArtifact> fromProjection,
  required List<HtmlHostArtifact> fromRemote,
}) {
  if (fromRemote.isEmpty) return fromProjection;
  if (fromProjection.isEmpty) return fromRemote;
  final byKey = <String, HtmlHostArtifact>{
    for (final artifact in fromProjection)
      (artifact.pageId.isNotEmpty ? artifact.pageId : artifact.id): artifact,
  };
  for (final remote in fromRemote) {
    final key = remote.pageId.isNotEmpty ? remote.pageId : remote.id;
    final local = byKey[key];
    byKey[key] = HtmlHostArtifact(
      id: remote.id.isNotEmpty ? remote.id : (local?.id ?? key),
      threadId: remote.threadId.isNotEmpty
          ? remote.threadId
          : (local?.threadId ?? ''),
      toolUseId: remote.toolUseId ?? local?.toolUseId,
      status: remote.status,
      pageId: remote.pageId.isNotEmpty ? remote.pageId : (local?.pageId ?? ''),
      slug: remote.slug.isNotEmpty ? remote.slug : (local?.slug ?? ''),
      title: remote.title.isNotEmpty ? remote.title : (local?.title ?? ''),
      publicUrl: remote.publicUrl.isNotEmpty
          ? remote.publicUrl
          : (local?.publicUrl ?? ''),
      expiresAt: remote.expiresAt.isNotEmpty
          ? remote.expiresAt
          : (local?.expiresAt ?? ''),
      extendedAt: remote.extendedAt ?? local?.extendedAt,
      canExtend: remote.canExtend,
      createdAt: remote.createdAt.isNotEmpty
          ? remote.createdAt
          : (local?.createdAt ?? ''),
      updatedAt: remote.updatedAt.isNotEmpty
          ? remote.updatedAt
          : (local?.updatedAt ?? ''),
    );
  }
  final merged = byKey.values.toList();
  merged.sort((left, right) {
    final byCreated = left.createdAt.compareTo(right.createdAt);
    if (byCreated != 0) return byCreated;
    return left.id.compareTo(right.id);
  });
  return List<HtmlHostArtifact>.unmodifiable(merged);
}
