import 'package:eco_mobile/core/utils/prompt_image_attachment.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('normalizes supported image extensions to Desktop media types', () {
    expect(promptImageMediaTypeFromPath('/tmp/photo.jpg'), 'image/jpeg');
    expect(promptImageMediaTypeFromPath('/tmp/photo.JPEG'), 'image/jpeg');
    expect(promptImageMediaTypeFromPath('/tmp/photo.png'), 'image/png');
    expect(promptImageMediaTypeFromPath('/tmp/photo.gif'), 'image/gif');
    expect(promptImageMediaTypeFromPath('/tmp/photo.webp'), 'image/webp');
  });

  test('rejects unsupported or extensionless image paths', () {
    expect(promptImageMediaTypeFromPath('/tmp/photo.heic'), isNull);
    expect(promptImageMediaTypeFromPath('/tmp/photo'), isNull);
  });
}
