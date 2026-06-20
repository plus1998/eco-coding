import '../utils/strip_ansi.dart';

sealed class PackageScriptStreamEvent {
  const PackageScriptStreamEvent({required this.runId});

  factory PackageScriptStreamEvent.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? '';
    final runId = json['runId'] as String? ?? '';
    switch (type) {
      case 'output':
        return PackageScriptOutputEvent(
          runId: runId,
          data: json['data'] as String? ?? '',
        );
      case 'exit':
        return PackageScriptExitEvent(
          runId: runId,
          exitCode: json['exitCode'] as int? ?? 1,
          signal: json['signal'] as int?,
        );
      case 'error':
        return PackageScriptErrorEvent(
          runId: runId,
          message: json['message'] as String? ?? '',
        );
      default:
        throw FormatException('Unknown package script event type: $type');
    }
  }

  final String runId;
}

class PackageScriptOutputEvent extends PackageScriptStreamEvent {
  const PackageScriptOutputEvent({
    required super.runId,
    required this.data,
  });

  final String data;
}

class PackageScriptExitEvent extends PackageScriptStreamEvent {
  const PackageScriptExitEvent({
    required super.runId,
    required this.exitCode,
    this.signal,
  });

  final int exitCode;
  final int? signal;
}

class PackageScriptErrorEvent extends PackageScriptStreamEvent {
  const PackageScriptErrorEvent({
    required super.runId,
    required this.message,
  });

  final String message;
}

class PackageScriptRunViewState {
  const PackageScriptRunViewState({
    required this.runId,
    required this.script,
    required this.command,
    this.output = '',
    this.running = true,
    this.exitCode,
  });

  final String runId;
  final String script;
  final List<String> command;
  final String output;
  final bool running;
  final int? exitCode;

  PackageScriptRunViewState copyWith({
    String? runId,
    String? script,
    List<String>? command,
    String? output,
    bool? running,
    int? exitCode,
    bool clearExitCode = false,
  }) {
    return PackageScriptRunViewState(
      runId: runId ?? this.runId,
      script: script ?? this.script,
      command: command ?? this.command,
      output: output ?? this.output,
      running: running ?? this.running,
      exitCode: clearExitCode ? null : (exitCode ?? this.exitCode),
    );
  }
}

PackageScriptRunViewState? reducePackageScriptRunState(
  PackageScriptRunViewState? state,
  PackageScriptStreamEvent event,
) {
  if (state == null || state.runId != event.runId) {
    return state;
  }

  return switch (event) {
    PackageScriptOutputEvent(:final data) => state.copyWith(
        output: state.output + stripAnsi(data),
      ),
    PackageScriptExitEvent(:final exitCode) => state.copyWith(
        running: false,
        exitCode: exitCode,
      ),
    PackageScriptErrorEvent(:final message) => state.copyWith(
        output: state.output + message,
        running: false,
        exitCode: 1,
      ),
  };
}
