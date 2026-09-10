import '../models/thread_models.dart';

/// Desktop `hasProgressInfo`: only active todo states surface the progress card.
bool threadMenuShouldShowProgress(Iterable<CoderTodoItem> todos) {
  for (final todo in todos) {
    final status = todo.status.trim();
    if (status == 'pending' || status == 'running' || status == 'blocked') {
      return true;
    }
  }
  return false;
}

/// Desktop workspace plan card only surfaces an approved plan (pending stays
/// in the in-feed approval UI). Require non-empty plan body so empty shells
/// do not keep the menu entry around.
bool threadMenuShouldShowPlan({
  ThreadPendingPlan? pendingPlan,
  ThreadPendingPlan? approvedPlan,
}) {
  final plan = approvedPlan?.plan.trim() ?? '';
  return plan.isNotEmpty;
}

bool threadMenuShouldShowArtifacts(int count) => count > 0;
