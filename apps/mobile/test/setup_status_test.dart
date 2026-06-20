import 'package:eco_mobile/features/home/setup_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('SetupOverview.setupComplete', () {
    test('requires login, active binding, and visible selected desktop', () {
      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.pending,
          select: SetupStepState.done,
        ).setupComplete,
        isFalse,
      );

      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.done,
          select: SetupStepState.pending,
        ).setupComplete,
        isFalse,
      );

      expect(
        _overview(
          selectedDesktopId: 'dev_desktop',
          login: SetupStepState.done,
          bind: SetupStepState.done,
          select: SetupStepState.done,
        ).setupComplete,
        isTrue,
      );
    });
  });
}

SetupOverview _overview({
  required String? selectedDesktopId,
  required SetupStepState login,
  required SetupStepState bind,
  required SetupStepState select,
}) {
  return SetupOverview(
    selectedDesktopId: selectedDesktopId,
    readyForThreads: false,
    steps: [
      const SetupStep(id: 'server', title: 'server', state: SetupStepState.done),
      SetupStep(id: 'login', title: 'login', state: login),
      const SetupStep(
        id: 'websocket',
        title: 'websocket',
        state: SetupStepState.done,
      ),
      SetupStep(id: 'bind', title: 'bind', state: bind),
      SetupStep(id: 'select', title: 'select', state: select),
    ],
  );
}
