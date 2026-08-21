import '../models/eco_types.dart';

/// Channel topic helpers aligned with `packages/shared` + supabase migrations.
class EcoRealtimeTopics {
  static const userPrefix = 'eco:user:';
  static const bindPrefix = 'eco:bind:';
  static const vaultPrefix = 'eco:vault:';

  static const broadcastEvent = 'eco.rpc';
  static const envelopeVersion = 1;

  static String bindTopic(String bindingId) =>
      '$bindPrefix${bindingId.trim().toLowerCase()}';

  static String userTopic(String userId) =>
      '$userPrefix${userId.trim().toLowerCase()}';

  static String? parseBindId(String topic) {
    if (!topic.startsWith(bindPrefix)) return null;
    final id = topic.substring(bindPrefix.length).trim().toLowerCase();
    return id.isEmpty ? null : id;
  }
}

/// Broadcast envelope: `{ v, event, message }` around Eco JSON-RPC.
Map<String, dynamic> wrapEcoRpcForBroadcast(Map<String, dynamic> message) {
  return {
    'v': EcoRealtimeTopics.envelopeVersion,
    'event': EcoRealtimeTopics.broadcastEvent,
    'message': message,
  };
}

Map<String, dynamic>? unwrapEcoRpcFromBroadcast(dynamic value) {
  if (value is! Map) return null;
  final map = Map<String, dynamic>.from(value);
  if (map['v'] != EcoRealtimeTopics.envelopeVersion) return null;
  if (map['event'] != EcoRealtimeTopics.broadcastEvent) return null;
  final message = map['message'];
  if (message is! Map) return null;
  return Map<String, dynamic>.from(message);
}

Map<String, dynamic> buildEcoPingRequest(String id) {
  return {
    'jsonrpc': EcoRpcConstants.jsonRpcVersion,
    'id': id,
    'method': EcoRpcConstants.methodPing,
    'params': <String, dynamic>{},
  };
}

Map<String, dynamic> buildEcoInvokeRequest({
  required String id,
  required String desktopDeviceId,
  required String channel,
  required List<dynamic> args,
  required int deadlineMs,
}) {
  return {
    'jsonrpc': EcoRpcConstants.jsonRpcVersion,
    'id': id,
    'method': EcoRpcConstants.methodInvoke,
    'params': {
      'desktopDeviceId': desktopDeviceId,
      'channel': channel,
      'args': args,
      'deadlineMs': deadlineMs,
    },
  };
}
