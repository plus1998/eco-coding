class AsrServiceException implements Exception {
  const AsrServiceException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => message;
}

enum AsrApiMode {
  chatCompletions('chat_completions'),
  audioTranscriptions('audio_transcriptions');

  const AsrApiMode(this.wireValue);

  final String wireValue;

  static AsrApiMode fromWire(Object? value) {
    if (value == AsrApiMode.audioTranscriptions.wireValue) {
      return AsrApiMode.audioTranscriptions;
    }
    return AsrApiMode.chatCompletions;
  }
}

class AsrStatus {
  const AsrStatus({
    this.hasApiKey = false,
    this.apiKeyEncryptionAvailable = false,
    this.online,
    this.model,
  });

  factory AsrStatus.fromJson(Object? value) {
    if (value is! Map) {
      throw const FormatException('Invalid ASR status response.');
    }
    final hasApiKey = value['hasApiKey'];
    final encryptionAvailable = value['apiKeyEncryptionAvailable'];
    final online = value['online'] ?? value['connected'] ?? value['available'];
    final model = value['model'];
    if (hasApiKey != null && hasApiKey is! bool ||
        encryptionAvailable != null && encryptionAvailable is! bool ||
        online != null && online is! bool ||
        model != null && model is! String) {
      throw const FormatException('ASR status contains an invalid boolean.');
    }
    return AsrStatus(
      hasApiKey: hasApiKey as bool? ?? false,
      apiKeyEncryptionAvailable: encryptionAvailable as bool? ?? false,
      online: online as bool?,
      model: (model as String?)?.trim(),
    );
  }

  final bool hasApiKey;
  final bool apiKeyEncryptionAvailable;
  final bool? online;
  final String? model;

  bool get configured => hasApiKey;
}

class AsrClientConfig {
  const AsrClientConfig({
    required this.endpointUrl,
    required this.apiKey,
    required this.model,
    this.apiMode = AsrApiMode.chatCompletions,
    this.systemPrompt,
  });

  factory AsrClientConfig.fromJson(Object? value) {
    if (value is! Map) {
      throw const FormatException('Invalid ASR client config response.');
    }
    final endpoint =
        value['endpoint'] ?? value['endpointUrl'] ?? value['baseUrl'];
    final apiKey = value['apiKey'];
    final model = value['model'];
    final systemPrompt = value['systemPrompt'];
    final apiMode = value['apiMode'];
    if (endpoint is! String || endpoint.trim().isEmpty) {
      throw const FormatException('ASR endpoint is required.');
    }
    if (apiKey is! String || apiKey.trim().isEmpty) {
      throw const FormatException('ASR apiKey is required.');
    }
    if (model is! String || model.trim().isEmpty) {
      throw const FormatException('ASR model is required.');
    }
    if (systemPrompt != null && systemPrompt is! String) {
      throw const FormatException('ASR systemPrompt must be a string.');
    }
    if (apiMode != null && apiMode is! String) {
      throw const FormatException('ASR apiMode must be a string.');
    }
    return AsrClientConfig(
      endpointUrl: endpoint.trim(),
      apiKey: apiKey,
      model: model.trim(),
      apiMode: AsrApiMode.fromWire(apiMode),
      systemPrompt: (systemPrompt as String?)?.trim(),
    );
  }

  final String endpointUrl;
  final String apiKey;
  final String model;
  final AsrApiMode apiMode;
  final String? systemPrompt;
}

class AsrTranscriptResponse {
  const AsrTranscriptResponse(this.text);

  factory AsrTranscriptResponse.fromJson(Object? value, {AsrApiMode? apiMode}) {
    if (value is! Map) {
      throw const FormatException('Invalid ASR response.');
    }
    if (apiMode == AsrApiMode.audioTranscriptions) {
      final text = value['text'];
      if (text is! String || text.trim().isEmpty) {
        throw const FormatException('ASR response has no text.');
      }
      return AsrTranscriptResponse(text.trim());
    }
    if (value['text'] is String && (value['text'] as String).trim().isNotEmpty) {
      return AsrTranscriptResponse((value['text'] as String).trim());
    }
    final choices = value['choices'];
    if (choices is! List || choices.isEmpty || choices.first is! Map) {
      throw const FormatException('ASR response has no choices.');
    }
    final message = choices.first['message'];
    final content = message is Map ? message['content'] : null;
    final text = switch (content) {
      String value => value,
      List value =>
        value
            .whereType<Map>()
            .map((part) => part['text'])
            .whereType<String>()
            .join(),
      _ => '',
    };
    if (text.trim().isEmpty) {
      throw const FormatException('ASR response has no text.');
    }
    return AsrTranscriptResponse(text.trim());
  }

  final String text;
}
