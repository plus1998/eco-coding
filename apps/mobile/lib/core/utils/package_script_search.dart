import '../models/git_models.dart';

List<PackageScriptInfo> filterPackageScripts(
  List<PackageScriptInfo> scripts,
  String query,
) {
  final normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.isEmpty) {
    return scripts;
  }

  return scripts
      .where(
        (script) =>
            script.name.toLowerCase().contains(normalizedQuery) ||
            script.command.toLowerCase().contains(normalizedQuery),
      )
      .toList();
}
