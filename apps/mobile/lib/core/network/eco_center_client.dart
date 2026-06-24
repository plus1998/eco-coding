import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../models/eco_types.dart';
import '../storage/credential_store.dart';
import '../utils/center_server_auth.dart';
import '../utils/device_profile.dart';

typedef JsonMap = Map<String, dynamic>;

class EcoCenterClient {
  EcoCenterClient({
    required CredentialStore store,
    Dio? dio,
    DateTime Function()? now,
    this.reconnectDelayMs = 3000,
    this.defaultInvokeTimeoutMs = 30000,
  }) : _store = store,
       _dio = dio ?? Dio(),
       _now = now ?? DateTime.now;

  final CredentialStore _store;
  final Dio _dio;
  final DateTime Function() _now;
  final int reconnectDelayMs;
  final int defaultInvokeTimeoutMs;

  AppCredentials _credentials = const AppCredentials(serverUrl: '');
  WebSocketChannel? _socket;
  StreamSubscription<dynamic>? _socketSub;
  Timer? _reconnectTimer;
  Timer? _keepaliveTimer;
  bool _intentionallyStopped = true;
  int _rpcCounter = 0;

  final _connectionController =
      StreamController<CenterServerConnectionStatus>.broadcast();
  final _eventController = StreamController<EcoEventEnvelope>.broadcast();

  final Map<String, Completer<dynamic>> _pendingInvokes = {};

  CenterServerConnectionStatus _status = const CenterServerConnectionStatus(
    state: EcoConnectionState.disconnected,
  );

  Stream<CenterServerConnectionStatus> get connectionStatus =>
      _connectionController.stream;
  Stream<EcoEventEnvelope> get events => _eventController.stream;
  CenterServerConnectionStatus get status => _status;
  AppCredentials get credentials => _credentials;

  Future<void> initialize() async {
    _credentials = await _store.load();
    _emitStatus(_status);
  }

  Future<void> updateCredentials(AppCredentials credentials) async {
    _credentials = credentials;
    await _store.save(credentials);
  }

  Future<void> setServerUrl(String serverUrl) async {
    final normalized = normalizeCenterServerHttpUrl(serverUrl);
    _credentials = _credentials.copyWith(serverUrl: normalized);
    await _store.save(_credentials);
  }

  Future<void> setSelectedDesktop(String? desktopDeviceId) async {
    _credentials = desktopDeviceId == null || desktopDeviceId.isEmpty
        ? _credentials.copyWith(clearSelectedDesktop: true)
        : _credentials.copyWith(selectedDesktopId: desktopDeviceId);
    await _store.save(_credentials);
  }

  Future<bool> testConnection(String serverUrl) async {
    try {
      final normalized = normalizeCenterServerHttpUrl(serverUrl);
      await _requestJson(serverUrl: normalized, path: '/health', method: 'GET');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<PublicUser> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    final serverUrl = _requireServerUrl();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/auth/register',
      method: 'POST',
      body: {
        'email': email.trim(),
        'password': password,
        if (displayName != null && displayName.trim().isNotEmpty)
          'displayName': displayName.trim(),
      },
    );
    final user = PublicUser.fromJson(response['user'] as JsonMap);
    final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
    final sameAccount = _credentials.userEmail == user.email;
    _credentials = _credentials.copyWith(
      userEmail: user.email,
      userDisplayName: user.displayName,
      userRefreshToken: tokens.refreshToken,
      userAccessToken: tokens.accessToken,
      userAccessTokenExpiresAt: tokens.expiresAt,
      clearDeviceCredentials: !sameAccount,
      clearSelectedDesktop: !sameAccount,
    );
    await _store.save(_credentials);
    return user;
  }

  Future<PublicUser> login({
    required String email,
    required String password,
  }) async {
    final serverUrl = _requireServerUrl();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/auth/login',
      method: 'POST',
      body: {'email': email.trim(), 'password': password},
    );
    final user = PublicUser.fromJson(response['user'] as JsonMap);
    final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
    final sameAccount = _credentials.userEmail == user.email;
    _credentials = _credentials.copyWith(
      userEmail: user.email,
      userDisplayName: user.displayName,
      userRefreshToken: tokens.refreshToken,
      userAccessToken: tokens.accessToken,
      userAccessTokenExpiresAt: tokens.expiresAt,
      clearDeviceCredentials: !sameAccount,
      clearSelectedDesktop: !sameAccount,
    );
    await _store.save(_credentials);
    return user;
  }

  Future<PublicDevice> registerMobileDevice({String? deviceName}) async {
    final serverUrl = _requireServerUrl();
    final accessToken = await _ensureUserAccessToken();
    final profile = await DeviceProfile.collect();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/devices/register',
      method: 'POST',
      bearerToken: accessToken,
      body: {
        'kind': 'mobile',
        'name': (deviceName ?? profile.displayName).trim(),
        'metadata': profile.toMetadata(),
      },
    );
    final device = PublicDevice.fromJson(response['device'] as JsonMap);
    final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
    final deviceSecret = response['deviceSecret'] as String;
    _credentials = _credentials.copyWith(
      deviceId: device.id,
      deviceSecret: deviceSecret,
      deviceName: device.name,
      deviceRefreshToken: tokens.refreshToken,
      deviceAccessToken: tokens.accessToken,
      deviceAccessTokenExpiresAt: tokens.expiresAt,
    );
    await _store.save(_credentials);
    return device;
  }

  Future<void> ensureMobileDevice() async {
    if (_credentials.hasDeviceCredentials) {
      await syncDeviceProfile();
      return;
    }
    await registerMobileDevice();
  }

  Future<PublicDevice> syncDeviceProfile() async {
    if (!_credentials.hasDeviceCredentials || _credentials.deviceId == null) {
      throw EcoCenterException('Device credentials are required.');
    }
    final profile = await DeviceProfile.collect();
    final serverUrl = _requireServerUrl();
    final accessToken = await _ensureDeviceAccessToken();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/devices/${_credentials.deviceId}',
      method: 'PATCH',
      bearerToken: accessToken,
      body: {'name': profile.displayName, 'metadata': profile.toMetadata()},
    );
    final device = PublicDevice.fromJson(response['device'] as JsonMap);
    _credentials = _credentials.copyWith(deviceName: device.name);
    await _store.save(_credentials);
    return device;
  }

  Future<DeviceBinding> claimPairing(String code) async {
    final serverUrl = _requireServerUrl();
    final accessToken = await _ensureDeviceAccessToken();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/pairing/claim',
      method: 'POST',
      bearerToken: accessToken,
      body: {'code': code.trim().toUpperCase()},
    );
    return DeviceBinding.fromJson(response['binding'] as JsonMap);
  }

  Future<QuickPairingResult> quickJoinFromQr(PairingQrPayload payload) async {
    if (!payload.canQuickJoin) {
      throw EcoCenterException('QR 码缺少服务器地址或授权信息，请使用 PC 最新版生成的二维码。');
    }
    final serverUrl = normalizeCenterServerHttpUrl(payload.serverUrl!);
    final reachable = await testConnection(serverUrl);
    if (!reachable) {
      throw EcoCenterException('无法访问服务器，请检查地址与网络');
    }
    final sameServer =
        _credentials.serverUrl.trim().isNotEmpty &&
        normalizeCenterServerHttpUrl(_credentials.serverUrl) == serverUrl;
    final reuseCurrentMobile = sameServer && _credentials.hasDeviceCredentials;
    final profile = await DeviceProfile.collect();
    final existingBindings = reuseCurrentMobile
        ? await listBindings()
        : const <DeviceBinding>[];
    final accessToken = reuseCurrentMobile
        ? await _ensureDeviceAccessToken()
        : null;
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/pairing/join',
      method: 'POST',
      bearerToken: accessToken,
      body: {
        'code': payload.code,
        'token': payload.bootstrapToken,
        'deviceName': profile.displayName,
        'metadata': profile.toMetadata(),
      },
    );
    final user = PublicUser.fromJson(response['user'] as JsonMap);
    final device = PublicDevice.fromJson(response['device'] as JsonMap);
    final binding = DeviceBinding.fromJson(response['binding'] as JsonMap);
    final desktopDeviceId = response['desktopDeviceId'] as String;
    final alreadyBound = existingBindings.any(
      (item) => item.isActive && item.desktopDeviceId == desktopDeviceId,
    );
    if (reuseCurrentMobile) {
      _credentials = _credentials.copyWith(
        serverUrl: serverUrl,
        userEmail: user.email,
        userDisplayName: user.displayName,
        deviceName: device.name,
        selectedDesktopId: desktopDeviceId,
      );
    } else {
      final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
      _credentials = AppCredentials(
        serverUrl: serverUrl,
        userEmail: user.email,
        userDisplayName: user.displayName,
        deviceId: device.id,
        deviceSecret: response['deviceSecret'] as String,
        deviceName: device.name,
        deviceRefreshToken: tokens.refreshToken,
        deviceAccessToken: tokens.accessToken,
        deviceAccessTokenExpiresAt: tokens.expiresAt,
        selectedDesktopId: desktopDeviceId,
      );
    }
    await _store.save(_credentials);
    _intentionallyStopped = false;
    await _connectOnce();
    if (reuseCurrentMobile) {
      try {
        await syncDeviceProfile();
      } catch (_) {
        // Profile sync is best-effort after quick pairing.
      }
    }
    return QuickPairingResult(
      binding: binding,
      desktopDeviceId: desktopDeviceId,
      reusedMobileDevice: reuseCurrentMobile,
      alreadyBound: alreadyBound,
    );
  }

  Future<List<DeviceBinding>> listBindings({
    bool includeRevoked = false,
  }) async {
    final serverUrl = _requireServerUrl();
    final accessToken = await _ensureDeviceAccessToken();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/bindings${includeRevoked ? '?includeRevoked=true' : ''}',
      method: 'GET',
      bearerToken: accessToken,
    );
    return (response['bindings'] as List<dynamic>)
        .map((e) => DeviceBinding.fromJson(e as JsonMap))
        .toList();
  }

  Future<List<PublicDevice>> listPresence() async {
    final serverUrl = _requireServerUrl();
    final accessToken = await _ensureDeviceAccessToken();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/presence',
      method: 'GET',
      bearerToken: accessToken,
    );
    return (response['devices'] as List<dynamic>)
        .map((e) => PublicDevice.fromJson(e as JsonMap))
        .toList();
  }

  Future<JsonMap> getMe() async {
    final serverUrl = _requireServerUrl();
    final accessToken = _credentials.hasUserSession
        ? await _ensureUserAccessToken()
        : await _ensureDeviceAccessToken();
    return _requestJson(
      serverUrl: serverUrl,
      path: '/v1/me',
      method: 'GET',
      bearerToken: accessToken,
    );
  }

  Future<void> connect() async {
    _intentionallyStopped = false;
    await _connectOnce();
  }

  void disconnect() {
    _intentionallyStopped = true;
    _clearReconnectTimer();
    _clearKeepalive();
    _socketSub?.cancel();
    _socketSub = null;
    _socket?.sink.close();
    _socket = null;
    _emitStatus(
      const CenterServerConnectionStatus(
        state: EcoConnectionState.disconnected,
      ),
    );
  }

  Future<String?> clearSession() async {
    disconnect();
    String? notice;
    final deviceId = _credentials.deviceId;
    final serverUrl = _credentials.serverUrl;
    if (deviceId != null && deviceId.isNotEmpty && serverUrl.isNotEmpty) {
      try {
        final accessToken = await _ensureDeviceAccessToken();
        await _requestJson(
          serverUrl: serverUrl,
          path: '/v1/devices/$deviceId',
          method: 'DELETE',
          bearerToken: accessToken,
        );
      } catch (error) {
        final recovery = _recoveryFromError(error);
        if (recovery == CenterServerAuthRecovery.deviceInactive) {
          notice = centerServerAuthRecoveryMessage(recovery);
        } else {
          notice = '本地已退出，但服务端注销未完成：${_exceptionMessage(error)}';
        }
      }
    }
    _credentials = _credentials.copyWith(
      clearUserSession: true,
      clearDeviceCredentials: true,
      clearSelectedDesktop: true,
    );
    await _store.clearSession();
    return notice;
  }

  Future<T> invoke<T>(
    String desktopDeviceId,
    String channel,
    List<dynamic> args, {
    int? deadlineMs,
  }) async {
    if (_socket == null || _status.state != EcoConnectionState.connected) {
      throw EcoCenterException('WebSocket is not connected.');
    }
    final id = 'mobile_req_${++_rpcCounter}';
    final completer = Completer<dynamic>();
    _pendingInvokes[id] = completer;

    final request = {
      'jsonrpc': EcoRpcConstants.jsonRpcVersion,
      'id': id,
      'method': EcoRpcConstants.methodInvoke,
      'params': {
        'desktopDeviceId': desktopDeviceId,
        'channel': channel,
        'args': args,
        'deadlineMs': deadlineMs ?? defaultInvokeTimeoutMs,
      },
    };

    try {
      _socket!.sink.add(jsonEncode(request));
      final result = await completer.future.timeout(
        Duration(milliseconds: deadlineMs ?? defaultInvokeTimeoutMs),
        onTimeout: () {
          _pendingInvokes.remove(id);
          throw EcoCenterException(
            'RPC timed out.',
            code: EcoRpcConstants.timeout,
          );
        },
      );
      return unwrapInvokeResult<T>(result);
    } catch (error) {
      _pendingInvokes.remove(id);
      rethrow;
    }
  }

  static T unwrapInvokeResult<T>(dynamic result) {
    if (result is Map<String, dynamic> && result.containsKey('result')) {
      return result['result'] as T;
    }
    return result as T;
  }

  Future<void> _connectOnce() async {
    _clearReconnectTimer();
    if (_credentials.serverUrl.isEmpty) {
      throw EcoCenterException('Center server URL is required.');
    }

    _emitStatus(
      const CenterServerConnectionStatus(state: EcoConnectionState.connecting),
    );

    try {
      final accessToken = await _ensureDeviceAccessToken();
      if (_intentionallyStopped) {
        throw EcoCenterException('Connection aborted.');
      }

      final wsUrl = buildCenterServerWebSocketUrl(
        _credentials.serverUrl,
        accessToken,
      );

      await _socketSub?.cancel();
      _socket?.sink.close();

      final channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _socket = channel;
      _socketSub = channel.stream.listen(
        _handleSocketMessage,
        onError: (Object error) => _handleSocketClosed(error.toString()),
        onDone: () => _handleSocketClosed('WebSocket closed.'),
        cancelOnError: true,
      );

      await channel.ready.timeout(
        const Duration(seconds: 15),
        onTimeout: () =>
            throw EcoCenterException('WebSocket connection timed out.'),
      );
      if (_intentionallyStopped) {
        throw EcoCenterException('Connection aborted.');
      }

      _emitStatus(
        CenterServerConnectionStatus(
          state: EcoConnectionState.connected,
          connectedAt: _now().toIso8601String(),
        ),
      );
      _startKeepalive();
      syncDeviceProfile().ignore();
    } catch (error) {
      final message = _exceptionMessage(error);
      final recovery = _recoveryFromError(error);
      _emitStatus(
        CenterServerConnectionStatus(
          state: EcoConnectionState.error,
          lastError: message,
          authRecovery: recovery,
        ),
      );
      if (!_intentionallyStopped &&
          !shouldStopCenterServerReconnect(recovery)) {
        _scheduleReconnect();
      }
      rethrow;
    }
  }

  void _handleSocketClosed(String reason) {
    _clearKeepalive();
    _socket = null;
    if (_intentionallyStopped) {
      _emitStatus(
        const CenterServerConnectionStatus(
          state: EcoConnectionState.disconnected,
        ),
      );
      return;
    }
    _emitStatus(
      CenterServerConnectionStatus(
        state: EcoConnectionState.error,
        lastError: reason,
        authRecovery: classifyCenterServerAuthError(reason),
      ),
    );
    final recovery = classifyCenterServerAuthError(reason);
    if (!shouldStopCenterServerReconnect(recovery)) {
      _scheduleReconnect();
    }
  }

  void _handleSocketMessage(dynamic data) {
    final decoded = jsonDecode(data as String) as Map<String, dynamic>;

    if (decoded.containsKey('method') && !decoded.containsKey('id')) {
      final method = decoded['method'] as String?;
      if (method == EcoRpcConstants.methodEvent) {
        final params = decoded['params'] as Map<String, dynamic>?;
        if (params != null) {
          _eventController.add(EcoEventEnvelope.fromJson(params));
        }
      }
      return;
    }

    final id = decoded['id'];
    if (id == null) return;

    final key = id.toString();
    final pending = _pendingInvokes.remove(key);
    if (pending == null) return;

    if (decoded.containsKey('error')) {
      final error = decoded['error'] as Map<String, dynamic>;
      pending.completeError(
        EcoCenterException(
          error['message'] as String? ?? 'RPC failed.',
          code: error['code'] as int?,
        ),
      );
      return;
    }

    pending.complete(decoded['result']);
  }

  void _scheduleReconnect() {
    _clearReconnectTimer();
    _reconnectTimer = Timer(Duration(milliseconds: reconnectDelayMs), () {
      if (!_intentionallyStopped) {
        unawaited(_connectOnce());
      }
    });
  }

  void _clearReconnectTimer() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  void _startKeepalive() {
    _clearKeepalive();
    _keepaliveTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      if (_socket == null || _status.state != EcoConnectionState.connected) {
        return;
      }
      _socket!.sink.add(
        jsonEncode({
          'jsonrpc': EcoRpcConstants.jsonRpcVersion,
          'id': 'ping_${++_rpcCounter}',
          'method': EcoRpcConstants.methodPing,
          'params': <String, dynamic>{},
        }),
      );
    });
  }

  void _clearKeepalive() {
    _keepaliveTimer?.cancel();
    _keepaliveTimer = null;
  }

  void _emitStatus(CenterServerConnectionStatus status) {
    _status = status;
    if (!_connectionController.isClosed) {
      _connectionController.add(status);
    }
  }

  Future<String> _ensureUserAccessToken() async {
    if (tokenStillValid(_credentials.userAccessTokenExpiresAt, _now()) &&
        _credentials.userAccessToken != null) {
      return _credentials.userAccessToken!;
    }
    if (_credentials.userRefreshToken != null) {
      try {
        final refreshed = await _refreshTokens(
          _credentials.userRefreshToken!,
          _TokenScope.user,
        );
        return refreshed.accessToken;
      } catch (error) {
        throw _toAuthException(
          error,
          fallbackRecovery: CenterServerAuthRecovery.relogin,
        );
      }
    }
    throw EcoCenterException(
      'User session expired. Please sign in again.',
      recovery: CenterServerAuthRecovery.relogin,
    );
  }

  Future<String> _ensureDeviceAccessToken() async {
    if (tokenStillValid(_credentials.deviceAccessTokenExpiresAt, _now()) &&
        _credentials.deviceAccessToken != null) {
      return _credentials.deviceAccessToken!;
    }
    if (_credentials.deviceRefreshToken != null) {
      try {
        final refreshed = await _refreshTokens(
          _credentials.deviceRefreshToken!,
          _TokenScope.device,
        );
        return refreshed.accessToken;
      } catch (error) {
        if (!_credentials.hasDeviceCredentials ||
            !isCenterServerAuthCredentialError(_exceptionMessage(error))) {
          rethrow;
        }
        _credentials = _credentials.copyWith(clearDeviceSession: true);
        await _store.save(_credentials);
      }
    }
    if (_credentials.hasDeviceCredentials) {
      try {
        final serverUrl = _requireServerUrl();
        final response = await _requestJson(
          serverUrl: serverUrl,
          path: '/v1/devices/token',
          method: 'POST',
          body: {
            'deviceId': _credentials.deviceId,
            'deviceSecret': _credentials.deviceSecret,
          },
        );
        final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
        _credentials = _credentials.copyWith(
          deviceRefreshToken: tokens.refreshToken,
          deviceAccessToken: tokens.accessToken,
          deviceAccessTokenExpiresAt: tokens.expiresAt,
        );
        await _store.save(_credentials);
        return tokens.accessToken;
      } catch (error) {
        throw _toAuthException(error);
      }
    }
    throw EcoCenterException(
      'Device credentials are missing.',
      recovery: CenterServerAuthRecovery.relogin,
    );
  }

  Future<TokenBundle> _refreshTokens(
    String refreshToken,
    _TokenScope scope,
  ) async {
    final serverUrl = _requireServerUrl();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/auth/refresh',
      method: 'POST',
      body: {'refreshToken': refreshToken},
    );
    final tokens = TokenBundle(
      accessToken: response['accessToken'] as String,
      refreshToken: refreshToken,
      expiresAt: response['expiresAt'] as String,
    );
    _credentials = scope == _TokenScope.user
        ? _credentials.copyWith(
            userRefreshToken: tokens.refreshToken,
            userAccessToken: tokens.accessToken,
            userAccessTokenExpiresAt: tokens.expiresAt,
          )
        : _credentials.copyWith(
            deviceRefreshToken: tokens.refreshToken,
            deviceAccessToken: tokens.accessToken,
            deviceAccessTokenExpiresAt: tokens.expiresAt,
          );
    await _store.save(_credentials);
    return tokens;
  }

  Future<JsonMap> _requestJson({
    required String serverUrl,
    required String path,
    required String method,
    String? bearerToken,
    JsonMap? body,
  }) async {
    final url = Uri.parse(serverUrl).resolve(path).toString();
    try {
      final response = await _dio.request<dynamic>(
        url,
        options: Options(
          method: method,
          headers: {
            if (bearerToken != null) 'Authorization': 'Bearer $bearerToken',
            if (body != null) 'Content-Type': 'application/json',
          },
          validateStatus: (_) => true,
        ),
        data: body == null ? null : jsonEncode(body),
      );

      final payload = response.data;
      final map = payload is String
          ? jsonDecode(payload) as JsonMap
          : payload as JsonMap?;

      if (response.statusCode == null ||
          response.statusCode! < 200 ||
          response.statusCode! >= 300) {
        final error = map?['error'];
        if (error is String && error.isNotEmpty) {
          throw EcoCenterException(
            error.toLowerCase().contains('route not found')
                ? 'Server 版本过旧，缺少扫码连接接口。请重新构建并部署 Center Server（docker compose up -d --build）。'
                : error,
          );
        }
        throw EcoCenterException(
          'Request failed with HTTP ${response.statusCode}.',
        );
      }

      return map ?? {};
    } on DioException catch (error) {
      throw EcoCenterException(error.message ?? 'Network request failed.');
    }
  }

  String _requireServerUrl() {
    if (_credentials.serverUrl.isEmpty) {
      throw EcoCenterException('Center server URL is required.');
    }
    return _credentials.serverUrl;
  }

  String _exceptionMessage(Object error) {
    return error is EcoCenterException ? error.message : error.toString();
  }

  CenterServerAuthRecovery _recoveryFromError(Object error) {
    if (error is EcoCenterException && error.recovery != null) {
      return error.recovery!;
    }
    return classifyCenterServerAuthError(_exceptionMessage(error));
  }

  EcoCenterException _toAuthException(
    Object error, {
    CenterServerAuthRecovery? fallbackRecovery,
  }) {
    final message = _exceptionMessage(error);
    if (!isCenterServerAuthCredentialError(message)) {
      if (error is EcoCenterException) {
        return error;
      }
      return EcoCenterException(message);
    }
    final recovery = classifyCenterServerAuthError(message);
    final resolved = recovery == CenterServerAuthRecovery.unknown
        ? (fallbackRecovery ?? CenterServerAuthRecovery.relogin)
        : recovery;
    if (resolved == CenterServerAuthRecovery.relogin) {
      return EcoCenterException(centerServerReauthMessage, recovery: resolved);
    }
    return EcoCenterException(message, recovery: resolved);
  }

  Future<void> dispose() async {
    disconnect();
    await _connectionController.close();
    await _eventController.close();
  }
}

String parsePairingCodeFromQr(String raw) => parsePairingQrPayload(raw).code;

class PairingQrPayload {
  const PairingQrPayload({
    required this.code,
    this.serverUrl,
    this.bootstrapToken,
  });

  final String code;
  final String? serverUrl;
  final String? bootstrapToken;

  bool get canQuickJoin =>
      serverUrl != null &&
      serverUrl!.trim().isNotEmpty &&
      bootstrapToken != null &&
      bootstrapToken!.trim().isNotEmpty;
}

class QuickPairingResult {
  const QuickPairingResult({
    required this.binding,
    required this.desktopDeviceId,
    required this.reusedMobileDevice,
    required this.alreadyBound,
  });

  final DeviceBinding binding;
  final String desktopDeviceId;
  final bool reusedMobileDevice;
  final bool alreadyBound;
}

PairingQrPayload parsePairingQrPayload(String raw) {
  final trimmed = raw.trim();
  if (trimmed.startsWith('eco://pair')) {
    final uri = Uri.parse(trimmed);
    final code = uri.queryParameters['code'];
    if (code == null || code.trim().isEmpty) {
      throw EcoCenterException('无效的配对二维码。');
    }
    return PairingQrPayload(
      serverUrl: uri.queryParameters['server'],
      code: code.trim().toUpperCase(),
      bootstrapToken: uri.queryParameters['token'],
    );
  }
  return PairingQrPayload(code: trimmed.toUpperCase());
}

enum _TokenScope { user, device }
