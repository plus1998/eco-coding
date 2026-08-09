import 'dart:typed_data';

enum ImageViewReadFailureCode {
  invalidPath,
  notFound,
  symbolicLink,
  notFile,
  tooLarge,
  unsupportedType,
  bridgeUnavailable,
  invalidResponse,
}

ImageViewReadFailureCode imageViewReadFailureCodeFromWire(Object? value) {
  return switch (value) {
    'invalid_path' => ImageViewReadFailureCode.invalidPath,
    'not_found' => ImageViewReadFailureCode.notFound,
    'symbolic_link' => ImageViewReadFailureCode.symbolicLink,
    'not_file' => ImageViewReadFailureCode.notFile,
    'too_large' => ImageViewReadFailureCode.tooLarge,
    'unsupported_type' => ImageViewReadFailureCode.unsupportedType,
    _ => ImageViewReadFailureCode.invalidResponse,
  };
}

class ImageViewReadException implements Exception {
  const ImageViewReadException(this.code, {this.detail});

  final ImageViewReadFailureCode code;
  final String? detail;

  @override
  String toString() {
    final suffix = detail?.trim();
    return suffix == null || suffix.isEmpty
        ? 'Image view read failed: ${code.name}'
        : 'Image view read failed: ${code.name}: $suffix';
  }
}

class ImageViewReadData {
  const ImageViewReadData({
    required this.bytes,
    required this.mimeType,
    required this.path,
    required this.fileName,
    required this.byteLength,
    required this.width,
    required this.height,
  });

  final Uint8List bytes;
  final String mimeType;
  final String path;
  final String fileName;
  final int byteLength;
  final int width;
  final int height;
}
