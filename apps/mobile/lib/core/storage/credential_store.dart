import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppCredentials {
  const AppCredentials({
    required this.serverUrl,
    this.deviceId,
    this.deviceSecret,
    this.userRefreshToken,
    this.userAccessToken,
    this.userAccessTokenExpiresAt,
    this.deviceRefreshToken,
    this.deviceAccessToken,
    this.deviceAccessTokenExpiresAt,
    this.deviceName,
    this.selectedDesktopId,
    this.userEmail,
    this.userDisplayName,
  });

  final String serverUrl;
  final String? deviceId;
  final String? deviceSecret;
  final String? userRefreshToken;
  final String? userAccessToken;
  final String? userAccessTokenExpiresAt;
  final String? deviceRefreshToken;
  final String? deviceAccessToken;
  final String? deviceAccessTokenExpiresAt;
  final String? deviceName;
  final String? selectedDesktopId;
  final String? userEmail;
  final String? userDisplayName;

  bool get hasUserSession =>
      userEmail != null &&
      userEmail!.isNotEmpty &&
      userRefreshToken != null &&
      userRefreshToken!.isNotEmpty;

  bool get hasDeviceCredentials =>
      deviceId != null &&
      deviceId!.isNotEmpty &&
      deviceSecret != null &&
      deviceSecret!.isNotEmpty;

  AppCredentials copyWith({
    String? serverUrl,
    String? deviceId,
    String? deviceSecret,
    String? userRefreshToken,
    String? userAccessToken,
    String? userAccessTokenExpiresAt,
    String? deviceRefreshToken,
    String? deviceAccessToken,
    String? deviceAccessTokenExpiresAt,
    String? deviceName,
    String? selectedDesktopId,
    String? userEmail,
    String? userDisplayName,
    bool clearDeviceSecret = false,
    bool clearUserSession = false,
    bool clearDeviceSession = false,
    bool clearDeviceCredentials = false,
    bool clearSelectedDesktop = false,
  }) {
    return AppCredentials(
      serverUrl: serverUrl ?? this.serverUrl,
      deviceId: clearDeviceCredentials ? null : (deviceId ?? this.deviceId),
      deviceSecret: clearDeviceSecret || clearDeviceCredentials
          ? null
          : (deviceSecret ?? this.deviceSecret),
      userRefreshToken: clearUserSession
          ? null
          : (userRefreshToken ?? this.userRefreshToken),
      userAccessToken: clearUserSession
          ? null
          : (userAccessToken ?? this.userAccessToken),
      userAccessTokenExpiresAt: clearUserSession
          ? null
          : (userAccessTokenExpiresAt ?? this.userAccessTokenExpiresAt),
      deviceRefreshToken: clearDeviceSession || clearDeviceCredentials
          ? null
          : (deviceRefreshToken ?? this.deviceRefreshToken),
      deviceAccessToken: clearDeviceSession || clearDeviceCredentials
          ? null
          : (deviceAccessToken ?? this.deviceAccessToken),
      deviceAccessTokenExpiresAt: clearDeviceSession || clearDeviceCredentials
          ? null
          : (deviceAccessTokenExpiresAt ?? this.deviceAccessTokenExpiresAt),
      deviceName: deviceName ?? this.deviceName,
      selectedDesktopId: clearSelectedDesktop
          ? null
          : (selectedDesktopId ?? this.selectedDesktopId),
      userEmail: clearUserSession ? null : (userEmail ?? this.userEmail),
      userDisplayName: clearUserSession
          ? null
          : (userDisplayName ?? this.userDisplayName),
    );
  }
}

class CredentialStore {
  CredentialStore({FlutterSecureStorage? secureStorage})
    : _secure = secureStorage ?? const FlutterSecureStorage();

  static const _serverUrlKey = 'server_url';
  static const _deviceIdKey = 'device_id';
  static const _deviceSecretKey = 'device_secret';
  static const _refreshTokenKey = 'refresh_token';
  static const _accessTokenKey = 'access_token';
  static const _accessTokenExpiresAtKey = 'access_token_expires_at';
  static const _userRefreshTokenKey = 'user_refresh_token';
  static const _userAccessTokenKey = 'user_access_token';
  static const _userAccessTokenExpiresAtKey = 'user_access_token_expires_at';
  static const _deviceRefreshTokenKey = 'device_refresh_token';
  static const _deviceAccessTokenKey = 'device_access_token';
  static const _deviceAccessTokenExpiresAtKey =
      'device_access_token_expires_at';
  static const _deviceNameKey = 'device_name';
  static const _selectedDesktopIdKey = 'selected_desktop_id';
  static const _userEmailKey = 'user_email';
  static const _userDisplayNameKey = 'user_display_name';

  final FlutterSecureStorage _secure;

  Future<AppCredentials> load() async {
    final prefs = await SharedPreferences.getInstance();
    final deviceId = await _secure.read(key: _deviceIdKey);
    final deviceSecret = await _secure.read(key: _deviceSecretKey);
    final hasLegacyDeviceCredentials =
        deviceId != null &&
        deviceId.isNotEmpty &&
        deviceSecret != null &&
        deviceSecret.isNotEmpty;
    final legacyRefreshToken = await _secure.read(key: _refreshTokenKey);
    final legacyAccessToken = await _secure.read(key: _accessTokenKey);
    final legacyAccessTokenExpiresAt = await _secure.read(
      key: _accessTokenExpiresAtKey,
    );

    return AppCredentials(
      serverUrl: prefs.getString(_serverUrlKey) ?? '',
      deviceName: prefs.getString(_deviceNameKey) ?? 'Eco Mobile',
      selectedDesktopId: prefs.getString(_selectedDesktopIdKey),
      userEmail: prefs.getString(_userEmailKey),
      userDisplayName: prefs.getString(_userDisplayNameKey),
      deviceId: deviceId,
      deviceSecret: deviceSecret,
      userRefreshToken:
          await _secure.read(key: _userRefreshTokenKey) ??
          (hasLegacyDeviceCredentials ? null : legacyRefreshToken),
      userAccessToken:
          await _secure.read(key: _userAccessTokenKey) ??
          (hasLegacyDeviceCredentials ? null : legacyAccessToken),
      userAccessTokenExpiresAt:
          await _secure.read(key: _userAccessTokenExpiresAtKey) ??
          (hasLegacyDeviceCredentials ? null : legacyAccessTokenExpiresAt),
      deviceRefreshToken:
          await _secure.read(key: _deviceRefreshTokenKey) ??
          (hasLegacyDeviceCredentials ? legacyRefreshToken : null),
      deviceAccessToken:
          await _secure.read(key: _deviceAccessTokenKey) ??
          (hasLegacyDeviceCredentials ? legacyAccessToken : null),
      deviceAccessTokenExpiresAt:
          await _secure.read(key: _deviceAccessTokenExpiresAtKey) ??
          (hasLegacyDeviceCredentials ? legacyAccessTokenExpiresAt : null),
    );
  }

  Future<void> save(AppCredentials credentials) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverUrlKey, credentials.serverUrl);
    if (credentials.deviceName != null) {
      await prefs.setString(_deviceNameKey, credentials.deviceName!);
    }
    if (credentials.selectedDesktopId != null) {
      await prefs.setString(
        _selectedDesktopIdKey,
        credentials.selectedDesktopId!,
      );
    } else {
      await prefs.remove(_selectedDesktopIdKey);
    }
    if (credentials.userEmail != null) {
      await prefs.setString(_userEmailKey, credentials.userEmail!);
    } else {
      await prefs.remove(_userEmailKey);
    }
    if (credentials.userDisplayName != null) {
      await prefs.setString(_userDisplayNameKey, credentials.userDisplayName!);
    } else {
      await prefs.remove(_userDisplayNameKey);
    }

    await _writeSecure(_deviceIdKey, credentials.deviceId);
    await _writeSecure(_deviceSecretKey, credentials.deviceSecret);
    await _writeSecure(_userRefreshTokenKey, credentials.userRefreshToken);
    await _writeSecure(_userAccessTokenKey, credentials.userAccessToken);
    await _writeSecure(
      _userAccessTokenExpiresAtKey,
      credentials.userAccessTokenExpiresAt,
    );
    await _writeSecure(_deviceRefreshTokenKey, credentials.deviceRefreshToken);
    await _writeSecure(_deviceAccessTokenKey, credentials.deviceAccessToken);
    await _writeSecure(
      _deviceAccessTokenExpiresAtKey,
      credentials.deviceAccessTokenExpiresAt,
    );
    await _secure.delete(key: _refreshTokenKey);
    await _secure.delete(key: _accessTokenKey);
    await _secure.delete(key: _accessTokenExpiresAtKey);
  }

  Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userEmailKey);
    await prefs.remove(_userDisplayNameKey);
    await prefs.remove(_selectedDesktopIdKey);
    await _secure.delete(key: _deviceIdKey);
    await _secure.delete(key: _deviceSecretKey);
    await _secure.delete(key: _refreshTokenKey);
    await _secure.delete(key: _accessTokenKey);
    await _secure.delete(key: _accessTokenExpiresAtKey);
    await _secure.delete(key: _userRefreshTokenKey);
    await _secure.delete(key: _userAccessTokenKey);
    await _secure.delete(key: _userAccessTokenExpiresAtKey);
    await _secure.delete(key: _deviceRefreshTokenKey);
    await _secure.delete(key: _deviceAccessTokenKey);
    await _secure.delete(key: _deviceAccessTokenExpiresAtKey);
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
