import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppCredentials {
  const AppCredentials({
    required this.serverUrl,
    this.deviceId,
    this.deviceSecret,
    this.refreshToken,
    this.accessToken,
    this.accessTokenExpiresAt,
    this.deviceName,
    this.selectedDesktopId,
    this.userEmail,
    this.userDisplayName,
  });

  final String serverUrl;
  final String? deviceId;
  final String? deviceSecret;
  final String? refreshToken;
  final String? accessToken;
  final String? accessTokenExpiresAt;
  final String? deviceName;
  final String? selectedDesktopId;
  final String? userEmail;
  final String? userDisplayName;

  bool get hasDeviceCredentials =>
      deviceId != null &&
      deviceId!.isNotEmpty &&
      deviceSecret != null &&
      deviceSecret!.isNotEmpty;

  AppCredentials copyWith({
    String? serverUrl,
    String? deviceId,
    String? deviceSecret,
    String? refreshToken,
    String? accessToken,
    String? accessTokenExpiresAt,
    String? deviceName,
    String? selectedDesktopId,
    String? userEmail,
    String? userDisplayName,
    bool clearDeviceSecret = false,
    bool clearRefreshToken = false,
    bool clearAccessToken = false,
  }) {
    return AppCredentials(
      serverUrl: serverUrl ?? this.serverUrl,
      deviceId: deviceId ?? this.deviceId,
      deviceSecret: clearDeviceSecret ? null : (deviceSecret ?? this.deviceSecret),
      refreshToken: clearRefreshToken ? null : (refreshToken ?? this.refreshToken),
      accessToken: clearAccessToken ? null : (accessToken ?? this.accessToken),
      accessTokenExpiresAt:
          clearAccessToken ? null : (accessTokenExpiresAt ?? this.accessTokenExpiresAt),
      deviceName: deviceName ?? this.deviceName,
      selectedDesktopId: selectedDesktopId ?? this.selectedDesktopId,
      userEmail: userEmail ?? this.userEmail,
      userDisplayName: userDisplayName ?? this.userDisplayName,
    );
  }
}

class CredentialStore {
  CredentialStore({
    FlutterSecureStorage? secureStorage,
  }) : _secure = secureStorage ?? const FlutterSecureStorage();

  static const _serverUrlKey = 'server_url';
  static const _deviceIdKey = 'device_id';
  static const _deviceSecretKey = 'device_secret';
  static const _refreshTokenKey = 'refresh_token';
  static const _accessTokenKey = 'access_token';
  static const _accessTokenExpiresAtKey = 'access_token_expires_at';
  static const _deviceNameKey = 'device_name';
  static const _selectedDesktopIdKey = 'selected_desktop_id';
  static const _userEmailKey = 'user_email';
  static const _userDisplayNameKey = 'user_display_name';

  final FlutterSecureStorage _secure;

  Future<AppCredentials> load() async {
    final prefs = await SharedPreferences.getInstance();
    return AppCredentials(
      serverUrl: prefs.getString(_serverUrlKey) ?? '',
      deviceName: prefs.getString(_deviceNameKey) ?? 'Eco Mobile',
      selectedDesktopId: prefs.getString(_selectedDesktopIdKey),
      userEmail: prefs.getString(_userEmailKey),
      userDisplayName: prefs.getString(_userDisplayNameKey),
      deviceId: await _secure.read(key: _deviceIdKey),
      deviceSecret: await _secure.read(key: _deviceSecretKey),
      refreshToken: await _secure.read(key: _refreshTokenKey),
      accessToken: await _secure.read(key: _accessTokenKey),
      accessTokenExpiresAt: await _secure.read(key: _accessTokenExpiresAtKey),
    );
  }

  Future<void> save(AppCredentials credentials) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverUrlKey, credentials.serverUrl);
    if (credentials.deviceName != null) {
      await prefs.setString(_deviceNameKey, credentials.deviceName!);
    }
    if (credentials.selectedDesktopId != null) {
      await prefs.setString(_selectedDesktopIdKey, credentials.selectedDesktopId!);
    } else {
      await prefs.remove(_selectedDesktopIdKey);
    }
    if (credentials.userEmail != null) {
      await prefs.setString(_userEmailKey, credentials.userEmail!);
    }
    if (credentials.userDisplayName != null) {
      await prefs.setString(_userDisplayNameKey, credentials.userDisplayName!);
    }

    await _writeSecure(_deviceIdKey, credentials.deviceId);
    await _writeSecure(_deviceSecretKey, credentials.deviceSecret);
    await _writeSecure(_refreshTokenKey, credentials.refreshToken);
    await _writeSecure(_accessTokenKey, credentials.accessToken);
    await _writeSecure(_accessTokenExpiresAtKey, credentials.accessTokenExpiresAt);
  }

  Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userEmailKey);
    await prefs.remove(_userDisplayNameKey);
    await prefs.remove(_selectedDesktopIdKey);
    await _secure.delete(key: _refreshTokenKey);
    await _secure.delete(key: _accessTokenKey);
    await _secure.delete(key: _accessTokenExpiresAtKey);
  }

  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    await _secure.deleteAll();
  }

  Future<void> _writeSecure(String key, String? value) async {
    if (value == null || value.isEmpty) {
      await _secure.delete(key: key);
      return;
    }
    await _secure.write(key: key, value: value);
  }
}
