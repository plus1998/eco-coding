import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/feed_text.dart';

void main() {
  test('removes internal web citation tokens', () {
    expect(
      sanitizeFeedText('模型输出。 citeturn0search0turn0search3'),
      '模型输出。 ',
    );
  });
}
