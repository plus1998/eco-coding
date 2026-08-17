class CursorModelOption {
  const CursorModelOption({
    required this.id,
    required this.displayName,
    required this.current,
    required this.isDefault,
  });

  factory CursorModelOption.fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final displayName = json['displayName'];
    if (id is! String || id.trim().isEmpty) {
      throw const FormatException('Invalid Cursor model id');
    }
    if (displayName is! String || displayName.trim().isEmpty) {
      throw const FormatException('Invalid Cursor model display name');
    }
    return CursorModelOption(
      id: id.trim(),
      displayName: displayName.trim(),
      current: json['current'] == true,
      isDefault: json['default'] == true,
    );
  }

  final String id;
  final String displayName;
  final bool current;
  final bool isDefault;
}

String resolveCursorModelDisplayName(
  List<CursorModelOption> models,
  String? selectedModelId,
) {
  final selected = selectedModelId?.trim();
  if (selected != null && selected.isNotEmpty) {
    for (final model in models) {
      if (model.id == selected) return model.displayName;
    }
    return selected;
  }
  for (final model in models) {
    if (model.current) return model.displayName;
  }
  return 'Cursor';
}
