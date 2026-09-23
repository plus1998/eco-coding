import 'dart:convert';

/// Canonical JSON and FNV-1a hash compatible with the TypeScript V2 protocol.
///
/// The hash is deliberately small and is only an integrity/idempotency guard;
/// it is not a cryptographic signature. Keep this implementation in sync with
/// `packages/shared/src/conversation-v2.ts` because effect hashes cross the
/// desktop/mobile boundary.
String conversationV2StableJson(dynamic value) {
  if (value == null || value is bool || value is String) {
    return jsonEncode(value);
  }
  if (value is num) {
    return _stableNumber(value);
  }
  if (value is List) {
    return '[${value.map(conversationV2StableJson).join(',')}]';
  }
  if (value is Map) {
    final keys = <String>[];
    for (final key in value.keys) {
      if (key is! String) {
        throw FormatException(
          'Conversation V2 canonical JSON object keys must be strings.',
        );
      }
      keys.add(key);
    }
    keys.sort();
    return '{${keys.map((key) => '${jsonEncode(key)}:${conversationV2StableJson(value[key])}').join(',')}}';
  }
  throw FormatException(
    'Conversation V2 canonical JSON contains an unsupported value.',
  );
}

String conversationV2StableHash(dynamic value) {
  final input = conversationV2StableJson(value);
  var hash = 2166136261;
  for (final codeUnit in input.codeUnits) {
    hash = ((hash ^ codeUnit) * 16777619) & 0xffffffff;
  }
  return hash.toRadixString(16).padLeft(8, '0');
}

String _stableNumber(num value) {
  if (value is double && !value.isFinite) return 'null';
  if (value == 0) return '0';

  // JSON.stringify writes integral numbers without a trailing `.0`. Dart's
  // JSON encoder normally agrees, but normalising this boundary keeps a
  // decoded `1.0` identical to the JavaScript number `1`.
  var encoded = jsonEncode(value);
  encoded = encoded.replaceFirst(RegExp(r'\.0(?=e|$)'), '');
  encoded = encoded.replaceFirstMapped(
    RegExp(r'e([+-])0+(\d+)$'),
    (match) => 'e${match.group(1)}${match.group(2)}',
  );
  return encoded;
}
