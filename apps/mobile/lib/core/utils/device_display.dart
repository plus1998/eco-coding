import '../models/eco_types.dart';

String threadSessionSubtitleLabel({
  String? projectName,
  required String workspacePath,
  String? desktopLabel,
}) {
  final project = projectName?.trim().isNotEmpty == true
      ? projectName!.trim()
      : (workspacePath.isNotEmpty ? workspaceDisplayName(workspacePath) : null);
  final host = desktopLabel?.trim();
  if (project != null && host != null && host.isNotEmpty) {
    return '$project · $host';
  }
  if (project != null) return project;
  if (host != null && host.isNotEmpty) return host;
  return '';
}

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
