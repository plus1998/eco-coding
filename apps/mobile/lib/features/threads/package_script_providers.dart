import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/eco_types.dart';
import '../../core/models/package_script_models.dart';
import '../../core/providers/app_providers.dart';
import 'thread_providers.dart';

final packageScriptRunProvider =
    NotifierProvider<PackageScriptRunNotifier, PackageScriptRunViewState?>(
  PackageScriptRunNotifier.new,
);

class PackageScriptRunNotifier extends Notifier<PackageScriptRunViewState?> {
  @override
  PackageScriptRunViewState? build() {
    ref.listen(ecoEventsProvider, (previous, next) {
      next.whenData(_handleEvent);
    });
    return null;
  }

  void beginRun({
    required String runId,
    required String script,
    required List<String> command,
  }) {
    state = PackageScriptRunViewState(
      runId: runId,
      script: script,
      command: command,
    );
  }

  Future<void> stopRun() async {
    final current = state;
    if (current == null || !current.running) {
      return;
    }
    final rpc = ref.read(desktopRpcProvider);
    if (rpc != null) {
      await rpc.stopPackageScript(current.runId);
    }
  }

  void clearRun() {
    state = null;
  }

  void _handleEvent(EcoEventEnvelope event) {
    if (event.kind != 'workspace.package_script') {
      return;
    }
    final payload = event.payload;
    if (payload is! Map<String, dynamic>) {
      return;
    }

    PackageScriptStreamEvent streamEvent;
    try {
      streamEvent = PackageScriptStreamEvent.fromJson(payload);
    } catch (_) {
      return;
    }

    final next = reducePackageScriptRunState(state, streamEvent);
    if (next != state) {
      state = next;
    }
  }
}
