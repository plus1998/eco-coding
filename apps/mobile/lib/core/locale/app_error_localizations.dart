import '../../l10n/generated/app_localizations.dart';
import '../models/app_error.dart';
import '../models/eco_types.dart';
import '../platform/system_speech_recognizer.dart';
import '../utils/center_server_auth.dart';

String localizedAppError(Object error, AppLocalizations l10n) {
  if (error is EcoCenterException) {
    final nativeMessage = error.nativeMessage?.trim();
    final localized = switch (error.kind) {
      EcoCenterErrorKind.invalidServerScheme => l10n.errorInvalidServerScheme,
      EcoCenterErrorKind.deviceCredentialsRequired =>
        l10n.errorDeviceCredentialsRequired,
      EcoCenterErrorKind.quickPairQrOutdated => l10n.errorQuickPairQrOutdated,
      EcoCenterErrorKind.serverUnreachable => l10n.errorServerUnreachable,
      EcoCenterErrorKind.websocketDisconnected =>
        l10n.errorWebSocketDisconnected,
      EcoCenterErrorKind.rpcTimeout => l10n.errorRpcTimeout,
      EcoCenterErrorKind.serverUrlRequired => l10n.errorServerUrlRequired,
      EcoCenterErrorKind.connectionAborted => l10n.errorConnectionAborted,
      EcoCenterErrorKind.websocketTimeout => l10n.errorWebSocketTimeout,
      EcoCenterErrorKind.rpcFailed => l10n.errorRpcFailed,
      EcoCenterErrorKind.userSessionExpired => l10n.authRelogin,
      EcoCenterErrorKind.deviceCredentialsMissing =>
        l10n.errorDeviceCredentialsMissing,
      EcoCenterErrorKind.serverOutdated => l10n.errorServerOutdated,
      EcoCenterErrorKind.httpRequestFailed => l10n.errorHttpRequestFailed(
        error.code ?? 0,
      ),
      EcoCenterErrorKind.networkRequestFailed => l10n.errorNetworkRequestFailed,
      EcoCenterErrorKind.invalidPairQr => l10n.errorInvalidPairQr,
      EcoCenterErrorKind.reauthRequired => l10n.authRelogin,
      null => null,
    };
    if (localized != null) return localized;
    if (nativeMessage?.isNotEmpty == true) return nativeMessage!;
    return error.message;
  }
  if (error is SystemSpeechRecognitionException) {
    final nativeMessage = error.nativeMessage?.trim();
    return switch (error.code) {
      'permission_denied' => l10n.speechPermissionDenied,
      'unavailable' =>
        nativeMessage?.isNotEmpty == true
            ? nativeMessage!
            : l10n.speechUnavailable,
      'busy' => l10n.speechBusy,
      'no_match' => l10n.composerNoSpeech,
      'network' => l10n.speechNetworkUnavailable,
      _ =>
        nativeMessage?.isNotEmpty == true
            ? nativeMessage!
            : l10n.speechRecognitionFailed,
    };
  }
  if (error is AppErrorCodeException) {
    return switch (error.code) {
      AppErrorCode.threadNoPcSelected => l10n.projectNoPcSelected,
      AppErrorCode.threadProjectionNoPcSelected =>
        l10n.threadProjectionNoPcSelected,
    };
  }
  if (error is String && error == threadNoPcSelectedErrorCode) {
    return l10n.projectNoPcSelected;
  }
  return error.toString();
}

String localizedEcoCenterNotice(EcoCenterNotice notice, AppLocalizations l10n) {
  return switch (notice.kind) {
    EcoCenterNoticeKind.deviceInactive => l10n.authDeviceInactive,
    EcoCenterNoticeKind.localSignOutCleanupFailed => l10n.signOutCleanupFailed(
      notice.nativeMessage ?? '',
    ),
  };
}

String localizedCenterServerRecovery(
  CenterServerAuthRecovery recovery,
  AppLocalizations l10n,
) {
  return switch (recovery) {
    CenterServerAuthRecovery.network => l10n.authNetwork,
    CenterServerAuthRecovery.deviceInactive => l10n.authDeviceInactive,
    CenterServerAuthRecovery.accountUnusable => l10n.authAccountUnusable,
    CenterServerAuthRecovery.relogin => l10n.authRelogin,
    CenterServerAuthRecovery.unknown => l10n.authUnknown,
  };
}
