import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/package_script_run.dart';

void main() {
  test('formatRunCommand appends args with npm separator', () {
    expect(
      formatRunCommand('npm', 'dev', '--port 3000'),
      'npm run dev -- --port 3000',
    );
  });

  test('formatRunCommand keeps explicit separator for pnpm', () {
    expect(
      formatRunCommand('pnpm', 'test', '-- --watch'),
      'pnpm run test -- --watch',
    );
  });
}
