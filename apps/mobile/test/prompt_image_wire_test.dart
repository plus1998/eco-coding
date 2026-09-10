import 'package:eco_mobile/core/models/thread_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('toWireJson prefers staged path over inline data', () {
    const attachment = PromptImageAttachment(
      mediaType: 'image/png',
      data: 'YWJj',
      path: r'C:\eco\prompt-images\spool\thread_thr\img.png',
    );
    expect(attachment.toWireJson(), {
      'mediaType': 'image/png',
      'path': r'C:\eco\prompt-images\spool\thread_thr\img.png',
    });
  });

  test('toWireJson falls back to data when path missing', () {
    const attachment = PromptImageAttachment(
      mediaType: 'image/jpeg',
      data: 'YWJj',
    );
    expect(attachment.toWireJson(), {
      'mediaType': 'image/jpeg',
      'data': 'YWJj',
    });
  });
}
