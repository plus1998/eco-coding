import '../models/eco_types.dart';

String formatDesktopLabel(PublicDevice? device, String deviceId) {
  final hostname = device?.metadata.hostname?.trim();
  if (hostname != null && hostname.isNotEmpty) {
    return hostname;
  }
  return shortenDeviceId(deviceId);
}

String shortenDeviceId(String deviceId) {
  final trimmed = deviceId.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return '${trimmed.substring(0, 8)}…${trimmed.substring(trimmed.length - 4)}';
}
