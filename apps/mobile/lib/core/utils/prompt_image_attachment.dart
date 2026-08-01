import 'dart:convert';

import 'package:image_picker/image_picker.dart';

import '../models/thread_models.dart';

Future<PromptImageAttachment?> promptImageAttachmentFromXFile(
  XFile file,
) async {
  final mediaType = promptImageMediaTypeFromPath(file.path);
  if (mediaType == null) return null;

  return PromptImageAttachment(
    mediaType: mediaType,
    data: base64Encode(await file.readAsBytes()),
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
