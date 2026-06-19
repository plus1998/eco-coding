import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../models/eco_types.dart';
import '../storage/credential_store.dart';

typedef JsonMap = Map<String, dynamic>;

class EcoCenterClient {
  EcoCenterClient({
    required CredentialStore store,
    Dio? dio,
    DateTime Function()? now,
    this.reconnectDelayMs = 3000,
    this.defaultInvokeTimeoutMs = 30000,
  })  : _store = store,
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
  bool _intentionallyStopped = true;
  int _rpcCounter = 0;

  final _connectionController =
      StreamController<CenterServerConnectionStatus>.broadcast();
  final _eventController = StreamController<EcoEventEnvelope>.broadcast();

  final Map<String, Completer<dynamic>> _pendingInvokes = {};

  CenterServerConnectionStatus _status =
      const CenterServerConnectionStatus(state: EcoConnectionState.disconnected);

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
    _credentials = _credentials.copyWith(selectedDesktopId: desktopDeviceId);
    await _store.save(_credentials);
  }

  Future<bool> testConnection(String serverUrl) async {
    try {
      final normalized = normalizeCenterServerHttpUrl(serverUrl);
      await _requestJson(
        serverUrl: normalized,
        path: '/health',
        method: 'GET',
      );
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
    _credentials = _credentials.copyWith(
      userEmail: user.email,
      userDisplayName: user.displayName,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
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
      body: {
        'email': email.trim(),
        'password': password,
      },
    );
    final user = PublicUser.fromJson(response['user'] as JsonMap);
    final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
    _credentials = _credentials.copyWith(
      userEmail: user.email,
      userDisplayName: user.displayName,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
    );
    await _store.save(_credentials);
    return user;
  }

  Future<PublicDevice> registerMobileDevice({String? deviceName}) async {
    final serverUrl = _requireServerUrl();
    final accessToken = await _ensureUserAccessToken();
    final response = await _requestJson(
      serverUrl: serverUrl,
      path: '/v1/devices/register',
      method: 'POST',
      bearerToken: accessToken,
      body: {
        'kind': 'mobile',
        'name': (deviceName ?? _credentials.deviceName ?? 'Eco Mobile').trim(),
      },
    );
    final device = PublicDevice.fromJson(response['device'] as JsonMap);
    final tokens = TokenBundle.fromJson(response['tokens'] as JsonMap);
    final deviceSecret = response['deviceSecret'] as String;
    _credentials = _credentials.copyWith(
      deviceId: device.id,
      deviceSecret: deviceSecret,
      deviceName: device.name,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
    );
    await _store.save(_credentials);
    return device;
  }

  Future<void> ensureMobileDevice() async {
    if (_credentials.hasDeviceCredentials) return;
    await registerMobileDevice();
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

  Future<List<DeviceBinding>> listBindings({bool includeRevoked = false}) async {
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
    final accessToken = await _ensureDeviceAccessToken();
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
    _socketSub?.cancel();
    _socketSub = null;
    _socket?.sink.close();
    _socket = null;
    _emitStatus(
      const CenterServerConnectionStatus(state: EcoConnectionState.disconnected),
    );
  }

  Future<T> invoke<T>(
    String desktopDeviceId,
    String channel,
    List<dynamic> args, {
    int? deadlineMs,
  }) async {
    if (_socket == null) {
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

      final opened = Completer<void>();
      _socketSub = channel.stream.listen(
        _handleSocketMessage,
        onError: (Object error) {
          if (!opened.isCompleted) {
            opened.completeError(error);
          }
          _handleSocketClosed(error.toString());
        },
        onDone: () {
          if (!opened.isCompleted) {
            opened.completeError(
              EcoCenterException('WebSocket closed before open.'),
            );
          }
          _handleSocketClosed('WebSocket closed.');
        },
        cancelOnError: true,
      );

      await Future<void>.delayed(const Duration(milliseconds: 100));
      if (_intentionallyStopped) {
        throw EcoCenterException('Connection aborted.');
      }

      _emitStatus(
        CenterServerConnectionStatus(
          state: EcoConnectionState.connected,
          connectedAt: _now().toIso8601String(),
        ),
      );
      if (!opened.isCompleted) opened.complete();
    } catch (error) {
      final message = error is EcoCenterException
          ? error.message
          : error.toString();
      _emitStatus(
        CenterServerConnectionStatus(
          state: EcoConnectionState.error,
          lastError: message,
        ),
      );
      if (!_intentionallyStopped) {
        _scheduleReconnect();
      }
      rethrow;
    }
  }

  void _handleSocketClosed(String reason) {
    _socket = null;
    if (_intentionallyStopped) {
      _emitStatus(
        const CenterServerConnectionStatus(state: EcoConnectionState.disconnected),
      );
      return;
    }
    _emitStatus(
      CenterServerConnectionStatus(
        state: EcoConnectionState.error,
        lastError: reason,
      ),
    );
    _scheduleReconnect();
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

  void _emitStatus(CenterServerConnectionStatus status) {
    _status = status;
    if (!_connectionController.isClosed) {
      _connectionController.add(status);
    }
  }

  Future<String> _ensureUserAccessToken() async {
    if (tokenStillValid(_credentials.accessTokenExpiresAt, _now()) &&
        _credentials.accessToken != null) {
      return _credentials.accessToken!;
    }
    if (_credentials.refreshToken != null) {
      final refreshed = await _refreshTokens(_credentials.refreshToken!);
      return refreshed.accessToken;
    }
    throw EcoCenterException('User session expired. Please sign in again.');
  }

  Future<String> _ensureDeviceAccessToken() async {
    if (tokenStillValid(_credentials.accessTokenExpiresAt, _now()) &&
        _credentials.accessToken != null) {
      return _credentials.accessToken!;
    }
    if (_credentials.refreshToken != null) {
      final refreshed = await _refreshTokens(_credentials.refreshToken!);
      return refreshed.accessToken;
    }
    if (_credentials.hasDeviceCredentials) {
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
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.expiresAt,
      );
      await _store.save(_credentials);
      return tokens.accessToken;
    }
    throw EcoCenterException('Device credentials are missing.');
  }

  Future<TokenBundle> _refreshTokens(String refreshToken) async {
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
    _credentials = _credentials.copyWith(
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
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
        throw EcoCenterException(
          error is String && error.isNotEmpty
              ? error
              : 'Request failed with HTTP ${response.statusCode}.',
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

  Future<void> dispose() async {
    disconnect();
    await _connectionController.close();
    await _eventController.close();
  }
}

String parsePairingCodeFromQr(String raw) {
  final trimmed = raw.trim();
  if (trimmed.startsWith('eco://pair')) {
    final uri = Uri.parse(trimmed);
    final code = uri.queryParameters['code'];
    if (code != null && code.isNotEmpty) {
      return code.trim().toUpperCase();
    }
  }
  return trimmed.toUpperCase();
}
