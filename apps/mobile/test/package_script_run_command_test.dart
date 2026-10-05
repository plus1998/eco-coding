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

  test('formatRunCommand prefixes leading commands', () {
    expect(
      formatRunCommand('npm', 'dev', '--port 3000', 'nvm use 20'),
      'nvm use 20 && npm run dev -- --port 3000',
    );
  });

  test('formatRunCommand drops a trailing connector in the prefix', () {
    expect(
      formatRunCommand('bun', 'dev', null, 'nvm use 20 &&'),
      'nvm use 20 && bun run dev',
    );
  });

  test('formatRunCommand ignores blank prefixes', () {
    expect(
      formatRunCommand('bun', 'dev', '--watch', '   '),
      'bun run dev --watch',
    );
  });
}
