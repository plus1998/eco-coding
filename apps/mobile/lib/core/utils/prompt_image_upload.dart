import 'dart:convert';
import 'dart:typed_data';

import '../models/thread_models.dart';
import '../network/desktop_rpc.dart';
import 'prompt_image_attachment.dart';

/// Upload pending composer images in chunks, updating [uploadProgress] for UI.
Future<List<PromptImageAttachment>> stagePromptImageAttachments({
  required DesktopRpc rpc,
  required String contextKey,
  required List<PromptImageAttachment> attachments,
  required void Function(List<PromptImageAttachment> next) onUpdate,
}) async {
  if (attachments.isEmpty) return const [];

  final next = List<PromptImageAttachment>.of(attachments);
  onUpdate(List.of(next));

  for (var i = 0; i < next.length; i++) {
    final attachment = next[i];
    final stagedPath = attachment.path?.trim() ?? '';
    if (stagedPath.isNotEmpty) {
      if (attachment.contentRef?.trim().isNotEmpty != true) {
        next[i] = attachment.copyWith(
          uploadFailed: true,
          clearUploadProgress: true,
        );
        onUpdate(List.of(next));
        throw StateError(
          'Image attachment is staged without a durable content reference.',
        );
      }
      next[i] = attachment.copyWith(
        clearUploadProgress: true,
        uploadFailed: false,
      );
      onUpdate(List.of(next));
      continue;
    }

    final contentRef = attachment.contentRef?.trim() ?? '';
    late final Uint8List sourceBytes;
    try {
      sourceBytes = contentRef.isNotEmpty
          ? await rpc.downloadPromptImage(
              contextKey: contextKey,
              contentRef: contentRef,
              mediaType: attachment.mediaType,
            )
          : base64Decode(attachment.data);
    } catch (_) {
      next[i] = attachment.copyWith(
        uploadFailed: true,
        clearUploadProgress: true,
      );
      onUpdate(List.of(next));
      rethrow;
    }
    final imageId = (attachment.id?.trim().isNotEmpty ?? false)
        ? attachment.id!.trim()
        : 'img_${DateTime.now().microsecondsSinceEpoch}_$i';
    final bytes = sourceBytes;
    if (bytes.isEmpty ||
        bytes.length > kPromptImageUploadMaxBytes ||
        (attachment.byteLength != null &&
            attachment.byteLength != bytes.length)) {
      next[i] = attachment.copyWith(
        uploadFailed: true,
        clearUploadProgress: true,
      );
      onUpdate(List.of(next));
      throw StateError(
        attachment.byteLength != null && attachment.byteLength != bytes.length
            ? 'Image attachment byte length does not match its durable metadata.'
            : 'Image attachment is empty or exceeds 20 MB.',
      );
    }

    next[i] = attachment.copyWith(
      id: imageId,
      uploadProgress: 0,
      uploadFailed: false,
    );
    onUpdate(List.of(next));

    try {
      final uploaded = await rpc.uploadPromptImageChunkedWithMetadata(
        contextKey: contextKey,
        imageId: imageId,
        mediaType: attachment.mediaType,
        bytes: bytes,
        onProgress: (sent, total) {
          final progress = total <= 0 ? 0.0 : (sent / total).clamp(0.0, 1.0);
          next[i] = next[i].copyWith(
            uploadProgress: progress,
            uploadFailed: false,
          );
          onUpdate(List.of(next));
        },
      );
      next[i] = next[i].copyWith(
        path: uploaded.path,
        contentRef: uploaded.contentRef,
        byteLength: uploaded.byteLength,
        uploadProgress: 1,
        uploadFailed: false,
      );
      onUpdate(List.of(next));
      // Clear determinate progress after a successful stage so the thumb looks idle.
      next[i] = next[i].copyWith(clearUploadProgress: true);
      onUpdate(List.of(next));
    } catch (_) {
      next[i] = next[i].copyWith(uploadFailed: true, clearUploadProgress: true);
      onUpdate(List.of(next));
      rethrow;
    }
  }

  return List.of(next);
}
