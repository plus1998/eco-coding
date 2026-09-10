class GeneratedImageFile {
  const GeneratedImageFile({
    required this.absolutePath,
    required this.relativePath,
    required this.mimeType,
    required this.bytes,
  });

  final String absolutePath;
  final String relativePath;
  final String mimeType;
  final int bytes;

  factory GeneratedImageFile.fromJson(Map<String, dynamic> json) {
    final absolutePath = (json['absolutePath'] as String?)?.trim() ?? '';
    final relativePath = (json['relativePath'] as String?)?.trim() ?? '';
    final mimeType = (json['mimeType'] as String?)?.trim() ?? 'image/png';
    final bytes = json['bytes'];
    return GeneratedImageFile(
      absolutePath: absolutePath,
      relativePath: relativePath,
      mimeType: mimeType.isEmpty ? 'image/png' : mimeType,
      bytes: bytes is num ? bytes.toInt() : 0,
    );
  }
}

class ImageGenerationArtifact {
  const ImageGenerationArtifact({
    required this.id,
    required this.threadId,
    required this.status,
    required this.prompt,
    required this.provider,
    required this.profileName,
    required this.model,
    required this.workspacePath,
    required this.generationRoot,
    required this.images,
    required this.createdAt,
    required this.updatedAt,
    this.toolUseId,
    this.errorCode,
    this.errorMessage,
  });

  final String id;
  final String threadId;
  final String? toolUseId;
  final String status;
  final String prompt;
  final String provider;
  final String profileName;
  final String model;
  final String workspacePath;
  final String generationRoot;
  final List<GeneratedImageFile> images;
  final String? errorCode;
  final String? errorMessage;
  final String createdAt;
  final String updatedAt;

  factory ImageGenerationArtifact.fromJson(Map<String, dynamic> json) {
    final id = (json['id'] as String?)?.trim() ?? '';
    final threadId = (json['threadId'] as String?)?.trim() ?? '';
    final status = (json['status'] as String?)?.trim() ?? 'completed';
    final prompt = (json['prompt'] as String?)?.trim() ?? '';
    final provider = (json['provider'] as String?)?.trim() ?? '';
    final profileName = (json['profileName'] as String?)?.trim() ?? '';
    final model = (json['model'] as String?)?.trim() ?? '';
    final workspacePath = (json['workspacePath'] as String?)?.trim() ?? '';
    final generationRoot = (json['generationRoot'] as String?)?.trim() ?? '';
    final createdAt = (json['createdAt'] as String?)?.trim() ?? '';
    final updatedAt = (json['updatedAt'] as String?)?.trim() ?? '';
    final toolUseId = (json['toolUseId'] as String?)?.trim();
    final errorCode = (json['errorCode'] as String?)?.trim();
    final errorMessage = (json['errorMessage'] as String?)?.trim();
    final imagesRaw = json['images'];
    final images = imagesRaw is List
        ? imagesRaw
              .whereType<Map>()
              .map(
                (entry) => GeneratedImageFile.fromJson(
                  Map<String, dynamic>.from(entry),
                ),
              )
              .toList(growable: false)
        : const <GeneratedImageFile>[];
    return ImageGenerationArtifact(
      id: id,
      threadId: threadId,
      toolUseId: toolUseId?.isNotEmpty == true ? toolUseId : null,
      status: status.isEmpty ? 'completed' : status,
      prompt: prompt,
      provider: provider,
      profileName: profileName,
      model: model,
      workspacePath: workspacePath,
      generationRoot: generationRoot,
      images: images,
      errorCode: errorCode?.isNotEmpty == true ? errorCode : null,
      errorMessage: errorMessage?.isNotEmpty == true ? errorMessage : null,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }

  String get displayTitle {
    final named = prompt.trim();
    if (named.isNotEmpty) return named;
    return id;
  }
}

class ImageGenerationArtifactReadResult {
  const ImageGenerationArtifactReadResult({
    required this.bytes,
    required this.mimeType,
    required this.path,
  });

  final List<int> bytes;
  final String mimeType;
  final String path;
}
