import 'package:eco_mobile/core/locale/app_error_localizations.dart';
import 'package:eco_mobile/core/models/app_error.dart';
import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/platform/system_speech_recognizer.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final en = lookupAppLocalizations(const Locale('en'));
  final zh = lookupAppLocalizations(const Locale('zh'));

  test('localizes stable Eco Center error kinds', () {
    final error = EcoCenterException.app(EcoCenterErrorKind.serverUnreachable);

    expect(
      localizedAppError(error, en),
      'Cannot reach the server. Check the address and network.',
    );
    expect(localizedAppError(error, zh), '无法访问服务器，请检查地址与网络。');
  });

  test('preserves external Eco Center messages verbatim', () {
    final error = EcoCenterException.native('Server supplied detail');

    expect(localizedAppError(error, en), 'Server supplied detail');
    expect(error.nativeMessage, 'Server supplied detail');
  });

  test(
    'localizes known speech codes and preserves unknown native messages',
    () {
      const permission = SystemSpeechRecognitionException(
        code: 'permission_denied',
        nativeMessage: 'Native permission text',
      );
      const unknown = SystemSpeechRecognitionException(
        code: 'vendor_error',
        nativeMessage: 'Vendor detail',
      );

      expect(
        localizedAppError(permission, en),
        'Microphone and speech recognition permissions are required',
      );
      expect(localizedAppError(unknown, zh), 'Vendor detail');
    },
  );

  test('localizes stable thread errors', () {
    expect(
      localizedAppError(
        const AppErrorCodeException(AppErrorCode.threadProjectionNoPcSelected),
        en,
      ),
      'Select a PC before requesting projection details',
    );
    expect(localizedAppError(threadNoPcSelectedErrorCode, zh), '未选择 PC');
  });
}
