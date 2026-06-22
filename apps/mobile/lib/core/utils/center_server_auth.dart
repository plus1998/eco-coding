const centerServerReauthMessage = '登录已失效，请重新登录。';

enum CenterServerAuthRecovery {
  network,
  deviceInactive,
  accountUnusable,
  relogin,
  unknown,
}

CenterServerAuthRecovery classifyCenterServerAuthError(String? message) {
  final trimmed = message?.trim();
  if (trimmed == null || trimmed.isEmpty) {
    return CenterServerAuthRecovery.unknown;
  }
  if (trimmed == centerServerReauthMessage) {
    return CenterServerAuthRecovery.relogin;
  }
  final lower = trimmed.toLowerCase();
  if (lower.contains('timed out') ||
      lower.contains('network request failed') ||
      lower.contains('econnrefused') ||
      lower.contains('enotfound') ||
      lower.contains('failed to fetch') ||
      lower.contains('request failed with http 5')) {
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
      lower.contains('credentials are missing') ||
      lower.contains('credentials are invalid') ||
      lower.contains('device credentials are invalid') ||
      lower.contains('device credentials are missing') ||
      lower.contains('user session expired') ||
      lower.contains('not authorized') ||
      lower.contains('unauthorized')) {
    return CenterServerAuthRecovery.relogin;
  }
  return CenterServerAuthRecovery.unknown;
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

String centerServerAuthRecoveryMessage(CenterServerAuthRecovery recovery) {
  switch (recovery) {
    case CenterServerAuthRecovery.network:
      return '无法连接服务端，请检查网络后重试。';
    case CenterServerAuthRecovery.deviceInactive:
      return '设备已在服务端注销或禁用，请重新配置连接。';
    case CenterServerAuthRecovery.accountUnusable:
      return '账号已停用，请联系管理员。';
    case CenterServerAuthRecovery.relogin:
      return centerServerReauthMessage;
    case CenterServerAuthRecovery.unknown:
      return '连接失败，请稍后重试。';
  }
}
