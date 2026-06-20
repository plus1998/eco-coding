import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/package_script_models.dart';
import 'package:eco_mobile/core/utils/strip_ansi.dart';

void main() {
  const baseState = PackageScriptRunViewState(
    runId: 'run_1',
    script: 'dev',
    command: ['npm', 'run', 'dev'],
  );

  test('stripAnsi removes CSI color sequences', () {
    expect(stripAnsi('\u001B[31merror\u001B[0m'), 'error');
  });

  test('reducePackageScriptRunState appends stripped output', () {
    final next = reducePackageScriptRunState(
      baseState,
      const PackageScriptOutputEvent(
        runId: 'run_1',
        data: '\u001B[32mready\u001B[0m\n',
      ),
    );

    expect(next?.output, 'ready\n');
    expect(next?.running, isTrue);
  });

  test('reducePackageScriptRunState handles exit', () {
    final next = reducePackageScriptRunState(
      baseState.copyWith(output: 'done'),
      const PackageScriptExitEvent(runId: 'run_1', exitCode: 0),
    );

    expect(next?.running, isFalse);
    expect(next?.exitCode, 0);
    expect(next?.output, 'done');
  });

  test('reducePackageScriptRunState handles error', () {
    final next = reducePackageScriptRunState(
      baseState,
      const PackageScriptErrorEvent(
        runId: 'run_1',
        message: 'spawn failed',
      ),
    );

    expect(next?.running, isFalse);
    expect(next?.exitCode, 1);
    expect(next?.output, 'spawn failed');
  });

  test('reducePackageScriptRunState ignores mismatched runId', () {
    final next = reducePackageScriptRunState(
      baseState,
      const PackageScriptOutputEvent(runId: 'run_other', data: 'ignored'),
    );

    expect(next, baseState);
  });

  test('PackageScriptStreamEvent.fromJson parses output events', () {
    final event = PackageScriptStreamEvent.fromJson({
      'type': 'output',
      'runId': 'run_1',
      'data': 'hello',
    });

    expect(event, isA<PackageScriptOutputEvent>());
    expect((event as PackageScriptOutputEvent).data, 'hello');
  });
}
