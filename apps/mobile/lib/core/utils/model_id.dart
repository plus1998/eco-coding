String shortenModelId(String modelId) {
  final trimmed = modelId.trim();
  if (trimmed.isEmpty) {
    return '';
  }
  final slash = trimmed.lastIndexOf('/');
  final normalized = slash >= 0 ? trimmed.substring(slash + 1) : trimmed;
  if (normalized.length <= 24) {
    return normalized;
  }
  return '${normalized.substring(0, 11)}…${normalized.substring(normalized.length - 10)}';
}
