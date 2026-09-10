import 'dart:convert';

import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../models/thread_models.dart';

const int kPromptImageUploadMaxBytes = 20 * 1024 * 1024;

enum PromptImagePickFailure { unsupportedType, tooLarge }

class PromptImagePickResult {
  const PromptImagePickResult.ok(this.attachment) : failure = null;

  const PromptImagePickResult.fail(this.failure) : attachment = null;

  final PromptImageAttachment? attachment;
  final PromptImagePickFailure? failure;
}

Future<PromptImagePickResult> promptImageAttachmentFromXFile(XFile file) async {
  final mediaType = promptImageMediaTypeFromPath(file.path);
  if (mediaType == null) {
    return const PromptImagePickResult.fail(
      PromptImagePickFailure.unsupportedType,
    );
  }

  final bytes = await file.readAsBytes();
  if (bytes.isEmpty) {
    return const PromptImagePickResult.fail(
      PromptImagePickFailure.unsupportedType,
    );
  }
  if (bytes.length > kPromptImageUploadMaxBytes) {
    return const PromptImagePickResult.fail(PromptImagePickFailure.tooLarge);
  }

  return PromptImagePickResult.ok(
    PromptImageAttachment(
      id: 'img_${const Uuid().v4()}',
      mediaType: mediaType,
      data: base64Encode(bytes),
    ),
  );
}

String? promptImageMediaTypeFromPath(String path) {
  final dotIndex = path.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex == path.length - 1) return null;

  return switch (path.substring(dotIndex + 1).toLowerCase()) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    _ => null,
  };
}

String composerDraftContextKey({String? threadId, String? workspacePath}) {
  final thread = threadId?.trim() ?? '';
  if (thread.isNotEmpty) return 'thread:$thread';
  final workspace = workspacePath?.trim() ?? '';
  if (workspace.isNotEmpty) return 'landing:$workspace';
  throw StateError(
    'composer draft context key requires threadId or workspacePath',
  );
}
