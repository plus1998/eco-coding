import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

const _storageKey = 'eco.package-script-args';

typedef PackageScriptArgsByWorkspace = Map<String, Map<String, String>>;

Future<PackageScriptArgsByWorkspace> _readStore() async {
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(_storageKey);
  if (raw == null || raw.isEmpty) {
    return {};
  }
  try {
    final parsed = jsonDecode(raw);
    if (parsed is! Map<String, dynamic>) {
      return {};
    }
    final store = <String, Map<String, String>>{};
    for (final entry in parsed.entries) {
      final scripts = entry.value;
      if (scripts is! Map) {
        continue;
      }
      final scriptArgs = <String, String>{};
      for (final scriptEntry in scripts.entries) {
        final args = scriptEntry.value;
        if (args is String && args.trim().isNotEmpty) {
          scriptArgs[scriptEntry.key] = args;
        }
      }
      if (scriptArgs.isNotEmpty) {
        store[entry.key] = scriptArgs;
      }
    }
    return store;
  } catch (_) {
    return {};
  }
}

Future<void> _writeStore(PackageScriptArgsByWorkspace store) async {
  final prefs = await SharedPreferences.getInstance();
  final normalized = <String, Map<String, String>>{};
  for (final entry in store.entries) {
    final scriptArgs = <String, String>{};
    for (final scriptEntry in entry.value.entries) {
      final trimmed = scriptEntry.value.trim();
      if (trimmed.isNotEmpty) {
        scriptArgs[scriptEntry.key] = trimmed;
      }
    }
    if (scriptArgs.isNotEmpty) {
      normalized[entry.key] = scriptArgs;
    }
  }
  if (normalized.isEmpty) {
    await prefs.remove(_storageKey);
    return;
  }
  await prefs.setString(_storageKey, jsonEncode(normalized));
}

Future<Map<String, String>> readWorkspaceScriptArgs(
  String workspacePath,
) async {
  final store = await _readStore();
  return {...?store[workspacePath]};
}

Future<String> readScriptArgs(String workspacePath, String scriptName) async {
  final store = await _readStore();
  return store[workspacePath]?[scriptName] ?? '';
}

Future<Map<String, String>> saveScriptArgs(
  String workspacePath,
  String scriptName,
  String args,
) async {
  final store = await _readStore();
  final workspaceArgs = {...?store[workspacePath]};
  final trimmed = args.trim();
  if (trimmed.isNotEmpty) {
    workspaceArgs[scriptName] = trimmed;
  } else {
    workspaceArgs.remove(scriptName);
  }
  if (workspaceArgs.isNotEmpty) {
    store[workspacePath] = workspaceArgs;
  } else {
    store.remove(workspacePath);
  }
  await _writeStore(store);
  return workspaceArgs;
}

Future<void> clearWorkspaceScriptArgs(String workspacePath) async {
  final store = await _readStore();
  if (!store.containsKey(workspacePath)) {
    return;
  }
  store.remove(workspacePath);
  await _writeStore(store);
}
