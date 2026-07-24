import '../utils/center_server_auth.dart';

class EcoRpcConstants {
  static const jsonRpcVersion = '2.0';
  static const protocolVersion = 1;

  static const methodEvent = 'eco.event';
  static const methodInvoke = 'eco.invoke';
  static const methodPing = 'eco.ping';

  static const parseError = -32700;
  static const invalidRequest = -32600;
  static const methodNotFound = -32601;
  static const invalidParams = -32602;
  static const internalError = -32603;
  static const unauthorized = -32001;
  static const forbidden = -32003;
  static const targetOffline = -32004;
  static const timeout = -32008;
}

enum EcoConnectionState { disconnected, connecting, connected, error }

class CenterServerConnectionStatus {
  const CenterServerConnectionStatus({
    required this.state,
    this.connectedAt,
    this.lastError,
    this.authRecovery,
  });

  final EcoConnectionState state;
  final String? connectedAt;
  final String? lastError;
  final CenterServerAuthRecovery? authRecovery;
}

class PublicUser {
  const PublicUser({
    required this.id,
    required this.email,
    this.displayName,
    required this.createdAt,
  });

  factory PublicUser.fromJson(Map<String, dynamic> json) => PublicUser(
    id: json['id'] as String,
    email: json['email'] as String,
    displayName: json['displayName'] as String?,
    createdAt: json['createdAt'] as String,
  );

  final String id;
  final String email;
  final String? displayName;
  final String createdAt;
}

class PublicDeviceMetadata {
  const PublicDeviceMetadata({
    this.model,
    this.ipAddress,
    this.platform,
    this.hostname,
  });

  factory PublicDeviceMetadata.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const PublicDeviceMetadata();
    }
    return PublicDeviceMetadata(
      model: json['model'] as String?,
      ipAddress: json['ipAddress'] as String?,
      platform: json['platform'] as String?,
      hostname: json['hostname'] as String?,
    );
  }

  final String? model;
  final String? ipAddress;
  final String? platform;
  final String? hostname;
}

class PublicDevice {
  const PublicDevice({
    required this.id,
    required this.userId,
    required this.kind,
    required this.name,
    required this.createdAt,
    this.metadata = const PublicDeviceMetadata(),
    this.lastSeenAt,
    this.disabledAt,
    this.online = false,
  });

  factory PublicDevice.fromJson(Map<String, dynamic> json) => PublicDevice(
    id: json['id'] as String,
    userId: json['userId'] as String,
    kind: json['kind'] as String,
    name: json['name'] as String,
    createdAt: json['createdAt'] as String,
    metadata: PublicDeviceMetadata.fromJson(
      json['metadata'] as Map<String, dynamic>?,
    ),
    lastSeenAt: json['lastSeenAt'] as String?,
    disabledAt: json['disabledAt'] as String?,
    online: json['online'] as bool? ?? false,
  );

  final String id;
  final String userId;
  final String kind;
  final String name;
  final PublicDeviceMetadata metadata;
  final String createdAt;
  final String? lastSeenAt;
  final String? disabledAt;
  final bool online;

  PublicDevice copyWith({
    String? id,
    String? userId,
    String? kind,
    String? name,
    PublicDeviceMetadata? metadata,
    String? createdAt,
    String? lastSeenAt,
    String? disabledAt,
    bool? online,
  }) => PublicDevice(
    id: id ?? this.id,
    userId: userId ?? this.userId,
    kind: kind ?? this.kind,
    name: name ?? this.name,
    metadata: metadata ?? this.metadata,
    createdAt: createdAt ?? this.createdAt,
    lastSeenAt: lastSeenAt ?? this.lastSeenAt,
    disabledAt: disabledAt ?? this.disabledAt,
    online: online ?? this.online,
  );
}

class DeviceBinding {
  const DeviceBinding({
    required this.id,
    required this.userId,
    required this.desktopDeviceId,
    required this.mobileDeviceId,
    required this.capabilities,
    required this.createdAt,
    this.revokedAt,
  });

  factory DeviceBinding.fromJson(Map<String, dynamic> json) => DeviceBinding(
    id: json['id'] as String,
    userId: json['userId'] as String,
    desktopDeviceId: json['desktopDeviceId'] as String,
    mobileDeviceId: json['mobileDeviceId'] as String,
    capabilities: (json['capabilities'] as List<dynamic>)
        .map((e) => e as String)
        .toList(),
    createdAt: json['createdAt'] as String,
    revokedAt: json['revokedAt'] as String?,
  );

  final String id;
  final String userId;
  final String desktopDeviceId;
  final String mobileDeviceId;
  final List<String> capabilities;
  final String createdAt;
  final String? revokedAt;

  bool get isActive => revokedAt == null;
}

class TokenBundle {
  const TokenBundle({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  factory TokenBundle.fromJson(Map<String, dynamic> json) => TokenBundle(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    expiresAt: json['expiresAt'] as String,
  );

  final String accessToken;
  final String refreshToken;
  final String expiresAt;
}

class EcoEventEnvelope {
  const EcoEventEnvelope({
    required this.id,
    required this.kind,
    required this.source,
    required this.occurredAt,
    required this.payload,
    this.threadId,
    this.workspacePath,
  });

  factory EcoEventEnvelope.fromJson(Map<String, dynamic> json) =>
      EcoEventEnvelope(
        id: json['id'] as String,
        kind: json['kind'] as String,
        source: json['source'] as String,
        occurredAt: json['occurredAt'] as String,
        payload: json['payload'],
        threadId: json['threadId'] as String?,
        workspacePath: json['workspacePath'] as String?,
      );

  final String id;
  final String kind;
  final String source;
  final String occurredAt;
  final dynamic payload;
  final String? threadId;
  final String? workspacePath;
}

enum EcoCenterErrorKind {
  invalidServerScheme,
  deviceCredentialsRequired,
  quickPairQrOutdated,
  serverUnreachable,
  websocketDisconnected,
  rpcTimeout,
  serverUrlRequired,
  connectionAborted,
  websocketTimeout,
  rpcFailed,
  userSessionExpired,
  deviceCredentialsMissing,
  serverOutdated,
  httpRequestFailed,
  networkRequestFailed,
  invalidPairQr,
  reauthRequired,
}

enum EcoCenterNoticeKind { deviceInactive, localSignOutCleanupFailed }

class EcoCenterNotice {
  const EcoCenterNotice(this.kind, {this.nativeMessage});

  final EcoCenterNoticeKind kind;
  final String? nativeMessage;
}

class EcoCenterException implements Exception {
  EcoCenterException(
    this.message, {
    this.code,
    this.recovery,
    this.kind,
    this.nativeMessage,
  });

  EcoCenterException.app(
    EcoCenterErrorKind kind, {
    int? code,
    CenterServerAuthRecovery? recovery,
  }) : this(
         'eco_center.${kind.name}',
         code: code,
         recovery: recovery,
         kind: kind,
       );

  EcoCenterException.native(
    String nativeMessage, {
    int? code,
    CenterServerAuthRecovery? recovery,
  }) : this(
         nativeMessage,
         code: code,
         recovery: recovery,
         nativeMessage: nativeMessage,
       );

  final String message;
  final int? code;
  final CenterServerAuthRecovery? recovery;
  final EcoCenterErrorKind? kind;
  final String? nativeMessage;

  @override
  String toString() => message;
}

String normalizeCenterServerHttpUrl(String serverUrl) {
  final trimmed = serverUrl.trim();
  final parsed = Uri.parse(trimmed);
  if (parsed.scheme != 'http' && parsed.scheme != 'https') {
    throw EcoCenterException.app(EcoCenterErrorKind.invalidServerScheme);
  }
  var path = parsed.path;
  while (path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }
  return Uri(
    scheme: parsed.scheme,
    host: parsed.host,
    port: parsed.hasPort ? parsed.port : null,
    path: path.isEmpty ? '' : path,
  ).toString();
}

String buildCenterServerWebSocketUrl(String serverUrl, String accessToken) {
  final parsed = Uri.parse(normalizeCenterServerHttpUrl(serverUrl));
  final wsScheme = parsed.scheme == 'https' ? 'wss' : 'ws';
  var path = parsed.path;
  if (path.isEmpty) {
    path = '/v1/rpc';
  } else {
    path = '$path/v1/rpc';
  }
  return Uri(
    scheme: wsScheme,
    host: parsed.host,
    port: parsed.hasPort ? parsed.port : null,
    path: path,
    queryParameters: {'access_token': accessToken},
  ).toString();
}

bool tokenStillValid(String? expiresAt, DateTime now) {
  if (expiresAt == null || expiresAt.isEmpty) return false;
  final expiry = DateTime.tryParse(expiresAt);
  if (expiry == null) return false;
  return expiry.difference(now).inMilliseconds > 30000;
}

String workspaceDisplayName(String workspacePath) {
  final normalized = workspacePath.replaceAll('\\', '/');
  final segments = normalized.split('/').where((s) => s.isNotEmpty).toList();
  if (segments.isEmpty) return workspacePath;
  return segments.last;
}
