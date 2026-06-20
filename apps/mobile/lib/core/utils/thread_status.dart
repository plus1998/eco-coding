import 'package:flutter/material.dart';

import '../models/thread_models.dart';
import '../theme/eco_theme.dart';

bool isThreadWaitingForApproval(ThreadSummary thread) {
  if (thread.status != 'running') return false;
  return RegExp(r'等待.*(批准|确认)|approval', caseSensitive: false)
      .hasMatch(thread.message);
}

bool isThreadBusy(ThreadSummary thread) {
  return thread.status == 'running' || thread.status == 'queued';
}

bool hasThreadStatusIndicator(ThreadSummary thread) {
  return isThreadWaitingForApproval(thread) ||
      isThreadBusy(thread) ||
      thread.status == 'failed' ||
      thread.status == 'blocked';
}

Color threadStatusDotColor(String status) {
  switch (status) {
    case 'running':
      return const Color(0xFF4ADE80);
    case 'completed':
      return const Color(0xFF60A5FA);
    case 'failed':
    case 'blocked':
      return EcoColors.danger;
    default:
      return EcoColors.textMuted;
  }
}

String threadStatusTime(ThreadSummary thread) {
  final iso = thread.updatedAt.isNotEmpty ? thread.updatedAt : thread.createdAt;
  return iso;
}
