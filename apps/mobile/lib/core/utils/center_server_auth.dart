enum CenterServerAuthRecovery {
  network,
  deviceInactive,
  accountUnusable,
  relogin,
  unknown,
}

const String centerServerReauthMessage = '登录已失效，请重新登录。';
const String centerServerIncompleteConfigMessage = '连接配置不完整，请重新登录。';

CenterServerAuthRecovery classifyCenterServerAuthError(String? message) {
  final trimmed = message?.trim();
  if (trimmed == null || trimmed.isEmpty) {
    return CenterServerAuthRecovery.unknown;
  }
  // Local credentials missing (never registered, or cleared) vs genuine auth
  // expiry — both require the user to sign in again.
  if (trimmed == centerServerReauthMessage ||
      trimmed == centerServerIncompleteConfigMessage) {
    return CenterServerAuthRecovery.relogin;
  }
  final lower = trimmed.toLowerCase();
  if (_looksLikeTransientNetworkFailure(lower)) {
    return CenterServerAuthRecovery.network;
  }
  if (lower.contains('token user is not active') ||
      lower.contains('refresh token subject is not active')) {
    return CenterServerAuthRecovery.accountUnusable;
  }
  if (lower.contains('device is not active') ||
      lower.contains('token device is not active') ||
      lower.contains('refresh token device is not active')) {
    return CenterServerAuthRecovery.deviceInactive;
  }
  if (lower.contains('refresh token is invalid or expired') ||
      lower.contains('invalid refresh token') ||
      lower.contains('refresh_token_not_found') ||
      lower.contains('invalid login credentials') ||
      lower.contains('credentials are missing') ||
      lower.contains('credentials are invalid') ||
      lower.contains('device credentials are invalid') ||
      lower.contains('device credentials are missing') ||
      lower.contains('user session expired') ||
      lower.contains('session missing')) {
    return CenterServerAuthRecovery.relogin;
  }
  return CenterServerAuthRecovery.unknown;
}

/// Maps a failed access-token refresh to a recovery action.
///
/// Access JWTs are short-lived (~1h); refresh tokens are long-lived. A transient
/// network failure while renewing must **not** wipe the stored refresh token or
/// force the login screen — only Auth rejecting the refresh credentials should.
CenterServerAuthRecovery recoveryForSessionRefreshFailure(String? message) {
  final recovery = classifyCenterServerAuthError(message);
  if (isCenterServerAuthCredentialError(message)) {
    return recovery;
  }
  return CenterServerAuthRecovery.network;
}

bool isCenterServerAuthCredentialError(String? message) {
  final recovery = classifyCenterServerAuthError(message);
  return recovery == CenterServerAuthRecovery.relogin ||
      recovery == CenterServerAuthRecovery.deviceInactive ||
      recovery == CenterServerAuthRecovery.accountUnusable;
}

bool shouldStopCenterServerReconnect(CenterServerAuthRecovery recovery) {
  return recovery == CenterServerAuthRecovery.relogin ||
      recovery == CenterServerAuthRecovery.deviceInactive ||
      recovery == CenterServerAuthRecovery.accountUnusable;
}

bool _looksLikeTransientNetworkFailure(String lower) {
  return lower.contains('timed out') ||
      lower.contains('timeout') ||
      lower.contains('network request failed') ||
      lower.contains('networkerror') ||
      lower.contains('socketexception') ||
      lower.contains('clientexception') ||
      lower.contains('httpexception') ||
      lower.contains('econnrefused') ||
      lower.contains('enotfound') ||
      lower.contains('econnreset') ||
      lower.contains('connection reset') ||
      lower.contains('connection refused') ||
      lower.contains('connection closed') ||
      lower.contains('connection abort') ||
      lower.contains('failed host lookup') ||
      lower.contains('failed to lookup') ||
      lower.contains('no address associated') ||
      lower.contains('network is unreachable') ||
      lower.contains('software caused connection abort') ||
      lower.contains('failed to fetch') ||
      lower.contains('request failed with http 5') ||
      lower.contains('statuscode: 5') ||
      lower.contains('status code: 5') ||
      lower.contains('http 502') ||
      lower.contains('http 503') ||
      lower.contains('http 504');
}
