import 'dart:convert';

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
      next[i] = attachment.copyWith(
        clearUploadProgress: true,
        uploadFailed: false,
      );
      onUpdate(List.of(next));
      continue;
    }

    final imageId =
        (attachment.id?.trim().isNotEmpty ?? false)
            ? attachment.id!.trim()
            : 'img_${DateTime.now().microsecondsSinceEpoch}_$i';
    final bytes = base64Decode(attachment.data);
    if (bytes.isEmpty || bytes.length > kPromptImageUploadMaxBytes) {
      next[i] = attachment.copyWith(
        uploadFailed: true,
        clearUploadProgress: true,
      );
      onUpdate(List.of(next));
      throw StateError('Image attachment is empty or exceeds 20 MB.');
    }

    next[i] = attachment.copyWith(
      id: imageId,
      uploadProgress: 0,
      uploadFailed: false,
    );
    onUpdate(List.of(next));

    try {
      final path = await rpc.uploadPromptImageChunked(
        contextKey: contextKey,
        imageId: imageId,
        mediaType: attachment.mediaType,
        bytes: bytes,
        onProgress: (sent, total) {
          final progress = total <= 0 ? 0.0 : (sent / total).clamp(0.0, 1.0);
          next[i] = next[i].copyWith(uploadProgress: progress, uploadFailed: false);
          onUpdate(List.of(next));
        },
      );
      next[i] = next[i].copyWith(
        path: path,
        uploadProgress: 1,
        uploadFailed: false,
      );
      onUpdate(List.of(next));
      // Clear determinate progress after a successful stage so the thumb looks idle.
      next[i] = next[i].copyWith(clearUploadProgress: true);
      onUpdate(List.of(next));
    } catch (_) {
      next[i] = next[i].copyWith(
        uploadFailed: true,
        clearUploadProgress: true,
      );
      onUpdate(List.of(next));
      rethrow;
    }
  }

  return List.of(next);
}
