import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/git_models.dart';
import 'package:eco_mobile/core/utils/package_script_search.dart';

void main() {
  const scripts = [
    PackageScriptInfo(name: 'build:web', command: 'flutter build web'),
    PackageScriptInfo(name: 'test', command: 'flutter test'),
    PackageScriptInfo(name: 'analyze', command: 'dart analyze'),
  ];

  test('empty query returns the original script list', () {
    expect(filterPackageScripts(scripts, '  '), same(scripts));
  });

  test('filters scripts by name without case sensitivity', () {
    final result = filterPackageScripts(scripts, 'BUILD');

    expect(result.map((script) => script.name), ['build:web']);
  });

  test('filters scripts by command without case sensitivity', () {
    final result = filterPackageScripts(scripts, 'FLUTTER');

    expect(result.map((script) => script.name), ['build:web', 'test']);
  });

  test('returns an empty list when no scripts match', () {
    expect(filterPackageScripts(scripts, 'deploy'), isEmpty);
  });
}
