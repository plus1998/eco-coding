import '../models/eco_types.dart';
import '../models/thread_models.dart';
import 'thread_follow_up_ui.dart';

List<CoderTodoItem>? threadTodoListFromLiveEvent({
  required String threadId,
  required Object? payload,
  String? envelopeThreadId,
}) {
  if (payload is! Map<String, dynamic>) {
    return null;
  }
  final live = ThreadLiveEvent.fromJson(payload);
  final eventThreadId = resolveThreadEventThreadId(
    envelopeThreadId: envelopeThreadId,
    payloadThreadId: live.threadId,
  );
  if (eventThreadId != threadId || live.todoList == null) {
    return null;
  }
  final todos = [...live.todoList!];
  todos.sort((left, right) => left.position.compareTo(right.position));
  return todos;
}

bool shouldReloadThreadTodosAfterConnection({
  required EcoConnectionState? previous,
  required EcoConnectionState current,
}) {
  return current == EcoConnectionState.connected &&
      previous != EcoConnectionState.connected;
}
