import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/eco_types.dart';
import '../storage/credential_store.dart';
import '../utils/center_server_auth.dart';
import '../utils/device_profile.dart';
import 'eco_realtime.dart';

typedef JsonMap = Map<String, dynamic>;

/// Edge Function names (Track A). Documented in `supabase/README.md`.
abstract final class EcoSupabaseFunctions {
  static const deviceRegister = 'device-register';
  static const pairingJoin = 'pairing-join';
  static const pairingCreate = 'pairing-create';
}

/// Supabase Center mobile client (Track F foundation).
///
/// Auth + device-register + pairing-join + Realtime `eco:bind:*` ping/invoke stub.
/// [DesktopRpc] continues to call [invoke]; transport is private Broadcast, not WS.
class EcoCenterClient {
  EcoCenterClient({
    required CredentialStore store,
    DateTime Function()? now,
    this.reconnectDelayMs = 3000,
    this.defaultInvokeTimeoutMs = 30000,
  }) : _store = store,
       _now = now ?? DateTime.now;

  final CredentialStore _store;
  final DateTime Function() _now;
  final int reconnectDelayMs;
  final int defaultInvokeTimeoutMs;

  AppCredentials _credentials = const AppCredentials(supabaseUrl: '');
  SupabaseClient? _supabase;
  String? _clientUrl;
  String? _clientAnonKey;

  RealtimeChannel? _bindChannel;
  String? _subscribedBindingId;
  StreamSubscription<AuthState>? _authSub;
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
  SupabaseClient? get supabaseOrNull => _supabase;

  Future<void> initialize() async {
    _credentials = await _store.load();
    if (_credentials.hasProjectConfig) {
      await _ensureSupabaseClient();
      await _restoreSessionIfNeeded();
    }
    _emitStatus(_status);
  }

  Future<void> updateCredentials(AppCredentials credentials) async {
    _credentials = credentials;
    await _store.save(credentials);
  }

  /// Persists project URL + anon key. Prefer this over [setServerUrl].
  Future<void> setProjectConfig({
    required String supabaseUrl,
    required String anonKey,
  }) async {
    final normalized = normalizeSupabaseProjectUrl(supabaseUrl);
    final key = anonKey.trim();
    if (key.isEmpty) {
      throw EcoCenterException.app(EcoCenterErrorKind.anonKeyRequired);
    }
    final previousUrl = _credentials.supabaseUrl.trim();
    final urlChanged = previousUrl.isEmpty
        ? true
        : normalizeSupabaseProjectUrl(previousUrl) != normalized;
    final keyChanged = (_credentials.anonKey?.trim() ?? '') != key;
    _credentials = _credentials.copyWith(supabaseUrl: normalized, anonKey: key);
    await _store.save(_credentials);
    if (urlChanged || keyChanged || _supabase == null) {
      await _resetSupabaseClient();
      await _ensureSupabaseClient();
    }
  }

  /// @deprecated Prefer [setProjectConfig]. Keeps anon key if already stored.
  Future<void> setServerUrl(String serverUrl) async {
    final normalized = normalizeSupabaseProjectUrl(serverUrl);
    final anon = _credentials.anonKey?.trim() ?? '';
    if (anon.isEmpty) {
      _credentials = _credentials.copyWith(supabaseUrl: normalized);
      await _store.save(_credentials);
      return;
    }
    await setProjectConfig(supabaseUrl: normalized, anonKey: anon);
  }

  Future<void> setSelectedDesktop(String? desktopDeviceId) async {
    _credentials = desktopDeviceId == null || desktopDeviceId.isEmpty
        ? _credentials.copyWith(
            clearSelectedDesktop: true,
            clearBindingId: true,
          )
        : _credentials.copyWith(
            selectedDesktopId: desktopDeviceId,
            clearBindingId: true,
          );
    await _store.save(_credentials);
  }

  Future<bool> testConnection(String supabaseUrl, {String? anonKey}) async {
    try {
      final normalized = normalizeSupabaseProjectUrl(supabaseUrl);
      final key = (anonKey ?? _credentials.anonKey)?.trim() ?? '';
      if (key.isEmpty) return false;
      final healthUri = Uri.parse('$normalized/auth/v1/health');
      final client = HttpClient();
      try {
        final request = await client
            .getUrl(healthUri)
            .timeout(const Duration(seconds: 8));
        request.headers.set('apikey', key);
        request.headers.set('authorization', 'Bearer $key');
        final response = await request.close().timeout(
          const Duration(seconds: 8),
        );
        // Any HTTP response means the project gateway is reachable.
        await response.drain<void>();
        return response.statusCode > 0 && response.statusCode < 500;
      } finally {
        client.close(force: true);
      }
    } catch (_) {
      return false;
    }
  }

  Future<PublicUser> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    final client = await _ensureSupabaseClient();
    final response = await client.auth.signUp(
      email: email.trim(),
      password: password,
      data: {
        if (displayName != null && displayName.trim().isNotEmpty)
          'display_name': displayName.trim(),
      },
    );
    final user = response.user;
    final session = response.session;
    if (user == null || session == null) {
      throw EcoCenterException.native(
        'Sign up succeeded but no session returned. Confirm email may be required.',
      );
    }
    return _applyAuthSession(user, session);
  }

  Future<PublicUser> login({
    required String email,
    required String password,
  }) async {
    final client = await _ensureSupabaseClient();
    final response = await client.auth.signInWithPassword(
      email: email.trim(),
      password: password,
    );
    final user = response.user;
    final session = response.session;
    if (user == null || session == null) {
      throw EcoCenterException.app(
        EcoCenterErrorKind.reauthRequired,
        recovery: CenterServerAuthRecovery.relogin,
      );
    }
    return _applyAuthSession(user, session);
  }

  Future<PublicDevice> registerMobileDevice({String? deviceName}) async {
    final client = await _ensureSupabaseClient();
    await _ensureUserAccessToken();
    final profile = await DeviceProfile.collect();
    final response = await client.functions.invoke(
      EcoSupabaseFunctions.deviceRegister,
      body: {
        'kind': 'mobile',
        'name': (deviceName ?? profile.displayName).trim(),
        'metadata': profile.toMetadata(),
      },
    );
    final data = _requireFunctionJson(response);
    final device = PublicDevice.fromJson(
      _asJsonMap(data['device']),
    );
    final deviceSecret = data['deviceSecret'] as String?;
    if (deviceSecret == null || deviceSecret.isEmpty) {
      throw EcoCenterException.native('device-register omitted deviceSecret.');
    }
    _credentials = _credentials.copyWith(
      deviceId: device.id,
      deviceSecret: deviceSecret,
      deviceName: device.name,
      clearDeviceSession: true,
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
      throw EcoCenterException.app(
        EcoCenterErrorKind.deviceCredentialsRequired,
      );
    }
    final client = await _ensureSupabaseClient();
    await _ensureUserAccessToken();
    final profile = await DeviceProfile.collect();
    final result = await client
        .from('devices')
        .update({
          'name': profile.displayName,
          'metadata': profile.toMetadata(),
          'last_seen_at': _now().toUtc().toIso8601String(),
        })
        .eq('id', _credentials.deviceId!)
        .select(
          'id, user_id, kind, name, metadata, created_at, last_seen_at, disabled_at',
        )
        .maybeSingle();
    if (result == null) {
      // RLS may block select after update; keep local name.
      _credentials = _credentials.copyWith(deviceName: profile.displayName);
      await _store.save(_credentials);
      return PublicDevice(
        id: _credentials.deviceId!,
        userId: '',
        kind: 'mobile',
        name: profile.displayName,
        createdAt: _now().toUtc().toIso8601String(),
      );
    }
    final device = _deviceFromRow(result);
    _credentials = _credentials.copyWith(deviceName: device.name);
    await _store.save(_credentials);
    return device;
  }

  /// Manual code entry without bootstrap token is not supported on Supabase
  /// Center (pairing-join requires bootstrapToken). Prefer QR quick join.
  Future<DeviceBinding> claimPairing(String code) async {
    throw EcoCenterException.app(EcoCenterErrorKind.quickPairQrOutdated);
  }

  Future<QuickPairingResult> quickJoinFromQr(PairingQrPayload payload) async {
    if (!payload.canQuickJoin) {
      throw EcoCenterException.app(EcoCenterErrorKind.quickPairQrOutdated);
    }
    final projectUrl = normalizeSupabaseProjectUrl(payload.projectUrl!);
    final anonFromQr = payload.anonKey?.trim();
    final anon =
        (anonFromQr != null && anonFromQr.isNotEmpty)
            ? anonFromQr
            : (_credentials.anonKey?.trim() ?? '');
    if (anon.isEmpty) {
      throw EcoCenterException.app(EcoCenterErrorKind.anonKeyRequired);
    }

    final reachable = await testConnection(projectUrl, anonKey: anon);
    if (!reachable) {
      throw EcoCenterException.app(EcoCenterErrorKind.serverUnreachable);
    }

    await setProjectConfig(supabaseUrl: projectUrl, anonKey: anon);
    if (!_credentials.hasUserSession) {
      throw EcoCenterException.app(
        EcoCenterErrorKind.reauthRequired,
        recovery: CenterServerAuthRecovery.relogin,
      );
    }
    await ensureMobileDevice();

    final client = await _ensureSupabaseClient();
    await _ensureUserAccessToken();
    final profile = await DeviceProfile.collect();
    final response = await client.functions.invoke(
      EcoSupabaseFunctions.pairingJoin,
      body: {
        'code': payload.code,
        'bootstrapToken': payload.bootstrapToken,
        'mobileDeviceId': _credentials.deviceId,
        'deviceSecret': _credentials.deviceSecret,
        'deviceName': profile.displayName,
        'metadata': profile.toMetadata(),
      },
    );
    final data = _requireFunctionJson(response);
    final binding = DeviceBinding.fromJson(_asJsonMap(data['binding']));
    final desktopDeviceId = data['desktopDeviceId'] as String? ??
        binding.desktopDeviceId;

    _credentials = _credentials.copyWith(
      selectedDesktopId: desktopDeviceId,
      bindingId: binding.id,
    );
    await _store.save(_credentials);

    return QuickPairingResult(
      binding: binding,
      desktopDeviceId: desktopDeviceId,
      reusedMobileDevice: true,
      alreadyBound: false,
    );
  }

  Future<List<DeviceBinding>> listBindings() async {
    final client = await _ensureSupabaseClient();
    await _ensureUserAccessToken();
    final rows = await client
        .from('device_bindings')
        .select(
          'id, user_id, desktop_device_id, mobile_device_id, capabilities, created_at, revoked_at',
        )
        .filter('revoked_at', 'is', null)
        .order('created_at', ascending: false);
    return (rows as List<dynamic>)
        .map((row) => _bindingFromRow(_asJsonMap(row)))
        .toList();
  }

  Future<List<PublicDevice>> listPresence() async {
    final client = await _ensureSupabaseClient();
    await _ensureUserAccessToken();
    // Presence online bit is Track D (`eco:user:*`). Foundation: list desktops.
    final rows = await client
        .from('devices_public')
        .select(
          'id, user_id, kind, name, metadata, created_at, last_seen_at, disabled_at',
        )
        .eq('kind', 'desktop')
        .filter('disabled_at', 'is', null);
    return (rows as List<dynamic>).map((row) {
      final device = _deviceFromRow(_asJsonMap(row));
      final lastSeen = device.lastSeenAt;
      var online = false;
      if (lastSeen != null) {
        final at = DateTime.tryParse(lastSeen);
        if (at != null) {
          online = _now().difference(at).inMinutes < 5;
        }
      }
      return device.copyWith(online: online);
    }).toList();
  }

  Future<void> connect() async {
    _intentionallyStopped = false;
    await _connectOnce();
  }

  void disconnect() {
    _intentionallyStopped = true;
    _clearReconnectTimer();
    _clearKeepalive();
    _teardownBindChannel();
    _emitStatus(
      const CenterServerConnectionStatus(
        state: EcoConnectionState.disconnected,
      ),
    );
  }

  Future<void> clearSession() async {
    disconnect();
    try {
      await _supabase?.auth.signOut();
    } catch (_) {}
    await _store.clearSession();
    _credentials = _credentials.copyWith(
      clearUserSession: true,
      clearDeviceCredentials: true,
      clearSelectedDesktop: true,
      clearBindingId: true,
    );
  }

  Future<T> invoke<T>(
    String desktopDeviceId,
    String channel,
    List<dynamic> args, {
    int? deadlineMs,
  }) async {
    if (_bindChannel == null ||
        _status.state != EcoConnectionState.connected) {
      throw EcoCenterException.app(EcoCenterErrorKind.websocketDisconnected);
    }
    final id = 'mobile_req_${++_rpcCounter}';
    final completer = Completer<dynamic>();
    _pendingInvokes[id] = completer;

    final request = buildEcoInvokeRequest(
      id: id,
      desktopDeviceId: desktopDeviceId,
      channel: channel,
      args: args,
      deadlineMs: deadlineMs ?? defaultInvokeTimeoutMs,
    );

    try {
      await _sendRpc(request);
      final result = await completer.future.timeout(
        Duration(milliseconds: deadlineMs ?? defaultInvokeTimeoutMs),
        onTimeout: () {
          _pendingInvokes.remove(id);
          throw EcoCenterException.app(
            EcoCenterErrorKind.rpcTimeout,
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

  /// Sends `eco.ping` on the bind channel and waits for a JSON-RPC response.
  Future<void> ping({int timeoutMs = 10000}) async {
    if (_bindChannel == null ||
        _status.state != EcoConnectionState.connected) {
      throw EcoCenterException.app(EcoCenterErrorKind.websocketDisconnected);
    }
    final id = 'ping_${++_rpcCounter}';
    final completer = Completer<dynamic>();
    _pendingInvokes[id] = completer;
    await _sendRpc(buildEcoPingRequest(id));
    await completer.future.timeout(
      Duration(milliseconds: timeoutMs),
      onTimeout: () {
        _pendingInvokes.remove(id);
        throw EcoCenterException.app(
          EcoCenterErrorKind.rpcTimeout,
          code: EcoRpcConstants.timeout,
        );
      },
    );
  }

  static T unwrapInvokeResult<T>(dynamic result) {
    if (result is Map<String, dynamic> && result.containsKey('result')) {
      return result['result'] as T;
    }
    return result as T;
  }

  Future<void> dispose() async {
    disconnect();
    await _authSub?.cancel();
    await _connectionController.close();
    await _eventController.close();
  }

  // --- internals ---

  Future<PublicUser> _applyAuthSession(User user, Session session) async {
    final email = user.email ?? '';
    final displayName =
        user.userMetadata?['display_name'] as String? ??
        user.userMetadata?['displayName'] as String?;
    final sameAccount = _credentials.userEmail == email;
    _credentials = _credentials.copyWith(
      userEmail: email,
      userDisplayName: displayName,
      userRefreshToken: session.refreshToken,
      userAccessToken: session.accessToken,
      userAccessTokenExpiresAt: DateTime.fromMillisecondsSinceEpoch(
        session.expiresAt! * 1000,
        isUtc: true,
      ).toIso8601String(),
      clearDeviceCredentials: !sameAccount,
      clearSelectedDesktop: !sameAccount,
      clearBindingId: !sameAccount,
    );
    await _store.save(_credentials);
    return PublicUser(
      id: user.id,
      email: email,
      displayName: displayName,
      createdAt: user.createdAt,
    );
  }

  Future<void> _restoreSessionIfNeeded() async {
    final refresh = _credentials.userRefreshToken;
    if (refresh == null || refresh.isEmpty || _supabase == null) return;
    try {
      final current = _supabase!.auth.currentSession;
      if (current != null) return;
      await _supabase!.auth.setSession(refresh);
      final session = _supabase!.auth.currentSession;
      final user = _supabase!.auth.currentUser;
      if (session != null && user != null) {
        await _applyAuthSession(user, session);
      }
    } catch (_) {
      // Leave stored tokens; login flow can recover.
    }
  }

  Future<SupabaseClient> _ensureSupabaseClient() async {
    _requireProjectConfig();
    final url = normalizeSupabaseProjectUrl(_credentials.supabaseUrl);
    final anon = _credentials.anonKey!.trim();
    if (_supabase != null && _clientUrl == url && _clientAnonKey == anon) {
      return _supabase!;
    }
    await _resetSupabaseClient();
    _supabase = SupabaseClient(url, anon);
    _clientUrl = url;
    _clientAnonKey = anon;
    await _authSub?.cancel();
    _authSub = _supabase!.auth.onAuthStateChange.listen((state) {
      final session = state.session;
      if (session == null) return;
      unawaited(
        _store.save(
          _credentials = _credentials.copyWith(
            userAccessToken: session.accessToken,
            userRefreshToken: session.refreshToken,
            userAccessTokenExpiresAt: session.expiresAt == null
                ? null
                : DateTime.fromMillisecondsSinceEpoch(
                    session.expiresAt! * 1000,
                    isUtc: true,
                  ).toIso8601String(),
          ),
        ),
      );
    });
    return _supabase!;
  }

  Future<void> _resetSupabaseClient() async {
    _teardownBindChannel();
    await _authSub?.cancel();
    _authSub = null;
    _supabase = null;
    _clientUrl = null;
    _clientAnonKey = null;
  }

  Future<String> _ensureUserAccessToken() async {
    final client = await _ensureSupabaseClient();
    var session = client.auth.currentSession;
    if (session != null &&
        tokenStillValid(
          DateTime.fromMillisecondsSinceEpoch(
            session.expiresAt! * 1000,
            isUtc: true,
          ).toIso8601String(),
          _now(),
        )) {
      return session.accessToken;
    }
    final refresh = _credentials.userRefreshToken;
    if (refresh == null || refresh.isEmpty) {
      throw EcoCenterException.app(
        EcoCenterErrorKind.userSessionExpired,
        recovery: CenterServerAuthRecovery.relogin,
      );
    }
    try {
      final recovered = await client.auth.setSession(refresh);
      session = recovered.session ?? client.auth.currentSession;
      if (session == null) {
        throw EcoCenterException.app(
          EcoCenterErrorKind.reauthRequired,
          recovery: CenterServerAuthRecovery.relogin,
        );
      }
      final user = recovered.user ?? client.auth.currentUser;
      if (user != null) {
        await _applyAuthSession(user, session);
      }
      return session.accessToken;
    } catch (error) {
      if (error is EcoCenterException) rethrow;
      throw EcoCenterException.app(
        EcoCenterErrorKind.reauthRequired,
        recovery: CenterServerAuthRecovery.relogin,
      );
    }
  }

  Future<void> _connectOnce() async {
    _clearReconnectTimer();
    _requireProjectConfig();
    if (!_credentials.hasDeviceCredentials) {
      throw EcoCenterException.app(
        EcoCenterErrorKind.deviceCredentialsMissing,
      );
    }

    _emitStatus(
      const CenterServerConnectionStatus(state: EcoConnectionState.connecting),
    );

    try {
      await _ensureUserAccessToken();
      if (_intentionallyStopped) {
        throw EcoCenterException.app(EcoCenterErrorKind.connectionAborted);
      }

      final bindingId = await _resolveBindingId();
      if (bindingId == null || bindingId.isEmpty) {
        _emitStatus(
          const CenterServerConnectionStatus(
            state: EcoConnectionState.connected,
            // Connected at auth layer; bind channel deferred until pairing.
          ),
        );
        // No binding yet — still "connected" for setup wizard WS step after login.
        return;
      }

      await _subscribeBindChannel(bindingId);
      if (_intentionallyStopped) {
        throw EcoCenterException.app(EcoCenterErrorKind.connectionAborted);
      }

      _emitStatus(
        CenterServerConnectionStatus(
          state: EcoConnectionState.connected,
          connectedAt: _now().toIso8601String(),
        ),
      );
      _startKeepalive();
      unawaited(syncDeviceProfile());
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

  Future<String?> _resolveBindingId() async {
    final cached = _credentials.bindingId;
    final selected = _credentials.selectedDesktopId;
    final mobileId = _credentials.deviceId;
    if (cached != null &&
        cached.isNotEmpty &&
        selected != null &&
        mobileId != null) {
      return cached;
    }
    if (selected == null || mobileId == null) return null;
    final bindings = await listBindings();
    final match = bindings.where(
      (b) =>
          b.isActive &&
          b.desktopDeviceId == selected &&
          b.mobileDeviceId == mobileId,
    );
    final binding = match.isEmpty ? null : match.first;
    if (binding == null) return null;
    _credentials = _credentials.copyWith(bindingId: binding.id);
    await _store.save(_credentials);
    return binding.id;
  }

  Future<void> _subscribeBindChannel(String bindingId) async {
    final client = await _ensureSupabaseClient();
    _teardownBindChannel();
    final topic = EcoRealtimeTopics.bindTopic(bindingId);
    final channel = client.channel(
      topic,
      opts: const RealtimeChannelConfig(private: true),
    );
    channel.onBroadcast(
      event: EcoRealtimeTopics.broadcastEvent,
      callback: (payload) {
        _handleBroadcastPayload(payload);
      },
    );
    final result = await channel.subscribe();
    if (result != RealtimeSubscribeStatus.subscribed) {
      throw EcoCenterException.native(
        'Failed to subscribe to $topic ($result).',
      );
    }
    _bindChannel = channel;
    _subscribedBindingId = bindingId;
  }

  void _teardownBindChannel() {
    final channel = _bindChannel;
    _bindChannel = null;
    _subscribedBindingId = null;
    if (channel != null) {
      unawaited(channel.unsubscribe());
    }
    for (final pending in _pendingInvokes.values) {
      if (!pending.isCompleted) {
        pending.completeError(
          EcoCenterException.app(EcoCenterErrorKind.websocketDisconnected),
        );
      }
    }
    _pendingInvokes.clear();
  }

  Future<void> _sendRpc(Map<String, dynamic> message) async {
    final channel = _bindChannel;
    if (channel == null) {
      throw EcoCenterException.app(EcoCenterErrorKind.websocketDisconnected);
    }
    final envelope = wrapEcoRpcForBroadcast(message);
    await channel.sendBroadcastMessage(
      event: EcoRealtimeTopics.broadcastEvent,
      payload: envelope,
    );
  }

  void _handleBroadcastPayload(Map<String, dynamic> payload) {
    // supabase_flutter may nest under `payload` or deliver envelope directly.
    final raw = payload['payload'] ?? payload;
    final message =
        unwrapEcoRpcFromBroadcast(raw) ??
        (raw is Map ? Map<String, dynamic>.from(raw) : null);
    if (message == null) return;

    if (message.containsKey('method') && !message.containsKey('id')) {
      final method = message['method'] as String?;
      if (method == EcoRpcConstants.methodEvent) {
        final params = message['params'];
        if (params is Map<String, dynamic>) {
          _eventController.add(EcoEventEnvelope.fromJson(params));
        } else if (params is Map) {
          _eventController.add(
            EcoEventEnvelope.fromJson(Map<String, dynamic>.from(params)),
          );
        }
      }
      return;
    }

    final id = message['id'];
    if (id == null) return;
    final pending = _pendingInvokes.remove(id.toString());
    if (pending == null) return;

    if (message.containsKey('error')) {
      final error = message['error'];
      final errorMap = error is Map ? Map<String, dynamic>.from(error) : null;
      pending.completeError(
        errorMap?['message'] is String
            ? EcoCenterException.native(
                errorMap!['message'] as String,
                code: errorMap['code'] as int?,
              )
            : EcoCenterException.app(
                EcoCenterErrorKind.rpcFailed,
                code: errorMap?['code'] as int?,
              ),
      );
      return;
    }

    pending.complete(message['result']);
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
      if (_bindChannel == null ||
          _status.state != EcoConnectionState.connected) {
        return;
      }
      unawaited(
        _sendRpc(buildEcoPingRequest('ping_${++_rpcCounter}')).catchError((
          _,
        ) {}),
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

  void _requireProjectConfig() {
    if (_credentials.supabaseUrl.trim().isEmpty) {
      throw EcoCenterException.app(EcoCenterErrorKind.serverUrlRequired);
    }
    if (_credentials.anonKey == null || _credentials.anonKey!.trim().isEmpty) {
      throw EcoCenterException.app(EcoCenterErrorKind.anonKeyRequired);
    }
  }

  CenterServerAuthRecovery _recoveryFromError(Object error) {
    if (error is EcoCenterException && error.recovery != null) {
      return error.recovery!;
    }
    return classifyCenterServerAuthError(_exceptionMessage(error));
  }

  String _exceptionMessage(Object error) {
    if (error is EcoCenterException) {
      return error.nativeMessage ?? error.message;
    }
    return error.toString();
  }

  JsonMap _requireFunctionJson(FunctionResponse response) {
    if (response.status >= 400) {
      final data = response.data;
      String message = 'Edge Function failed (${response.status}).';
      if (data is Map && data['error'] is String) {
        message = data['error'] as String;
      } else if (data is Map && data['message'] is String) {
        message = data['message'] as String;
      } else if (data is String && data.trim().isNotEmpty) {
        message = data;
      }
      throw EcoCenterException.native(message, code: response.status);
    }
    final data = response.data;
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    if (data is String) {
      final decoded = jsonDecode(data);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    }
    throw EcoCenterException.native('Edge Function returned non-JSON body.');
  }

  JsonMap _asJsonMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    throw EcoCenterException.native('Expected JSON object.');
  }

  PublicDevice _deviceFromRow(JsonMap row) {
    if (row.containsKey('userId')) {
      return PublicDevice.fromJson(row);
    }
    return PublicDevice(
      id: row['id'] as String,
      userId: row['user_id'] as String? ?? '',
      kind: row['kind'] as String,
      name: row['name'] as String,
      createdAt: row['created_at'] as String? ?? '',
      metadata: PublicDeviceMetadata.fromJson(
        row['metadata'] is Map
            ? Map<String, dynamic>.from(row['metadata'] as Map)
            : null,
      ),
      lastSeenAt: row['last_seen_at'] as String?,
      disabledAt: row['disabled_at'] as String?,
    );
  }

  DeviceBinding _bindingFromRow(JsonMap row) {
    if (row.containsKey('userId')) {
      return DeviceBinding.fromJson(row);
    }
    return DeviceBinding(
      id: row['id'] as String,
      userId: row['user_id'] as String,
      desktopDeviceId: row['desktop_device_id'] as String,
      mobileDeviceId: row['mobile_device_id'] as String,
      capabilities: (row['capabilities'] as List<dynamic>? ?? const [])
          .map((e) => e as String)
          .toList(),
      createdAt: row['created_at'] as String,
      revokedAt: row['revoked_at'] as String?,
    );
  }
}

String parsePairingCodeFromQr(String raw) => parsePairingQrPayload(raw).code;

class PairingQrPayload {
  const PairingQrPayload({
    required this.code,
    this.serverUrl,
    this.supabaseUrl,
    this.anonKey,
    this.bootstrapToken,
  });

  final String code;

  /// Legacy QR param `server` (Center Server or Supabase URL).
  final String? serverUrl;

  /// Explicit Supabase project URL (`supabase` / `url` query params).
  final String? supabaseUrl;

  /// Optional anon key carried in QR (`anon` / `anonKey`).
  final String? anonKey;

  final String? bootstrapToken;

  String? get projectUrl {
    final explicit = supabaseUrl?.trim();
    if (explicit != null && explicit.isNotEmpty) return explicit;
    final legacy = serverUrl?.trim();
    if (legacy != null && legacy.isNotEmpty) return legacy;
    return null;
  }

  bool get canQuickJoin =>
      projectUrl != null &&
      projectUrl!.isNotEmpty &&
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

/// Parses pairing QR. Backward compatible with legacy:
/// `eco://pair?server=...&code=...&token=...`
/// Supabase-aware:
/// `eco://pair?supabase=...&anon=...&code=...&token=...`
PairingQrPayload parsePairingQrPayload(String raw) {
  final trimmed = raw.trim();
  if (trimmed.startsWith('eco://pair')) {
    final uri = Uri.parse(trimmed);
    final code = uri.queryParameters['code'];
    if (code == null || code.trim().isEmpty) {
      throw EcoCenterException.app(EcoCenterErrorKind.invalidPairQr);
    }
    final supabase =
        uri.queryParameters['supabase'] ??
        uri.queryParameters['url'] ??
        uri.queryParameters['supabaseUrl'];
    final server = uri.queryParameters['server'];
    final anon =
        uri.queryParameters['anon'] ??
        uri.queryParameters['anonKey'] ??
        uri.queryParameters['key'];
    return PairingQrPayload(
      code: code.trim().toUpperCase(),
      serverUrl: server,
      supabaseUrl: supabase,
      anonKey: anon,
      bootstrapToken: uri.queryParameters['token'],
    );
  }
  return PairingQrPayload(code: trimmed.toUpperCase());
}
