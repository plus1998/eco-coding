import 'dart:ui' show Color;

import '../../l10n/generated/app_localizations.dart';
import '../models/thread_models.dart';
import '../models/thread_runtime_config.dart';
import '../models/thread_run_projection.dart';
import '../theme/subagent_theme.dart' as subagent_theme;
import 'agent_mission.dart';
import 'file_change.dart';
import 'subagent_session_timing.dart';

const subagentDisplayRoles = {
  'vision',
  'explore',
  'architect',
  'coder',
  'reviewer',
  'tester',
};

const _nonAgentActivityRoles = {
  'assistant',
  'main',
  'planner',
  'system',
  'thinking',
  'tool',
  'user',
};

const _chineseRoleToId = {
  '看图': 'vision',
  '探索': 'explore',
  '架构': 'architect',
  '编码': 'coder',
  '审查': 'reviewer',
  '测试': 'tester',
};

String? _toolVerbLabel(String toolName, AppLocalizations l10n) {
  return switch (toolName) {
    'Read' => l10n.toolRead,
    'Write' => l10n.toolWrite,
    'Edit' || 'MultiEdit' => l10n.toolEdit,
    'Grep' => l10n.toolSearch,
    'Glob' => l10n.toolFind,
    'Bash' => l10n.toolRunCommand,
    'Agent' => l10n.toolCall,
    'TodoWrite' || 'TaskUpdate' => l10n.toolUpdateTasks,
    'TaskCreate' => l10n.toolCreateTask,
    'TaskList' => l10n.toolListTasks,
    'TaskOutput' => l10n.toolReadTaskOutput,
    'AskUserQuestion' => l10n.toolClarify,
    'WebSearch' => l10n.toolWebSearch,
    'WebFetch' => l10n.toolWebFetch,
    'Skill' => l10n.activityReadSkill,
    _ => null,
  };
}

final _subagentBracketPrefix = RegExp(r'^【[^】]+】\s*');

// Chinese alternatives match historical Desktop event text, not mobile UI.
final _activityNoisePattern = RegExp(
  r'^(?:Tool:|Running tool:|Requesting model|Compacting context|API retry |Usage recorded|Run finished|Agent session started|Agent run completed|Claude Agent SDK ready|状态已更新|已从异常退出恢复|【\d+/\d+】|Creating isolated worktree|Isolated worktree ready:|Local model router ready:|Working in project directory:|已清理隔离工作树|工具调用被拒绝|Permission denied for )',
  caseSensitive: false,
);

final _internalActivityMessagePattern = RegExp(
  r'^(?:标题已更新|标题更新|运行投影已更新|运行投影更新|执行完成。|执行完成，变更已写入项目目录。|执行完成，工作树内无相对基线的文件变更。|执行已结束，但无法确认文件变更。|正在启动 Claude Agent SDK|等待工具读取确认|等待 Bash 执行确认|读取已确认，继续执行|读取已拒绝，等待 Agent 调整|Bash 已确认，继续执行|Bash 已拒绝，等待 Agent 调整|模型路由已变更|模型请求(?:完成|失败|已取消))',
);

final _usageBadgePattern = RegExp(r'^[↑↓⊙][↑↓⊙\d\s.,kKmM\$%·+()-]*$');

final _usageNoisePattern = RegExp(
  r'^(?:Usage recorded|Run finished)',
  caseSensitive: false,
);

final _activityStatusNoisePattern = RegExp(r'^状态已更新\s*');

final _threadOperationalStatusPatterns = [
  RegExp(r'^正在停止(?:当前步骤|…)'),
  RegExp(r'^已停止'),
  RegExp(r'^正在继续执行'),
  RegExp(r'^正在按计划执行'),
  RegExp(r'^正在回答'),
  RegExp(r'^正在分析并制定计划'),
  RegExp(r'^正在交给主代理处理'),
  RegExp(r'^已开始处理排队的后续消息。'),
  RegExp(r'^已取消排队的后续消息。'),
  RegExp(r'^已记录后续消息，并标记为需要立即处理。'),
  RegExp(r'^后续消息处理失败：'),
];

final _toolLinePattern = RegExp(
  r'^Tool:\s*([A-Za-z0-9_]+)(?:\s*·\s*(.+?)|\s+(\(\d+(?:\.\d+)?s\)))?\s*$',
);

enum _ProgressKind { read, write, edit, search, command }

final _progressPatterns = <({RegExp pattern, _ProgressKind kind})>[
  (
    pattern: RegExp(
      r'^Reading\s+(.+?)(?:\s*·\s*Read)?\s*$',
      caseSensitive: false,
    ),
    kind: _ProgressKind.read,
  ),
  (
    pattern: RegExp(
      r'^Writing\s+(.+?)(?:\s*·\s*Write)?\s*$',
      caseSensitive: false,
    ),
    kind: _ProgressKind.write,
  ),
  (
    pattern: RegExp(
      r'^Editing\s+(.+?)(?:\s*·\s*Edit)?\s*$',
      caseSensitive: false,
    ),
    kind: _ProgressKind.edit,
  ),
  (
    pattern: RegExp(
      r'^Searching\s+(.+?)(?:\s*·\s*Grep)?\s*$',
      caseSensitive: false,
    ),
    kind: _ProgressKind.search,
  ),
  (
    pattern: RegExp(
      r'^Running\s+(.+?)(?:\s*·\s*Bash)?\s*$',
      caseSensitive: false,
    ),
    kind: _ProgressKind.command,
  ),
];

final _connectionFailedPattern = RegExp(r'^【连接失败】\s*([\s\S]*)$');

enum ActivityActionIcon {
  search,
  file,
  edit,
  terminal,
  agent,
  context,
  network,
}

enum ToolActionLifecycle {
  approvalPending,
  approvalApproved,
  approvalRejected,
  running,
  completed,
  failed,
}

class ThreadRunBashApprovalMetadata {
  const ThreadRunBashApprovalMetadata({
    required this.toolUseId,
    required this.toolName,
    this.phase,
    this.detail,
    this.description,
  });

  final String toolUseId;
  final String toolName;
  final String? phase;
  final String? detail;
  final String? description;
}

ToolActionLifecycle? bashApprovalPhaseToLifecycle(String? phase) {
  switch (phase) {
    case 'requested':
      return ToolActionLifecycle.approvalPending;
    case 'approved':
      return ToolActionLifecycle.approvalApproved;
    case 'rejected':
    case 'denied':
      return ToolActionLifecycle.approvalRejected;
    default:
      return null;
  }
}

ToolActionLifecycle toolLifecycleFromMetadata(ThreadRunToolMetadata tool) {
  switch (tool.status) {
    case 'completed':
      return ToolActionLifecycle.completed;
    case 'failed':
      return ToolActionLifecycle.failed;
    case 'running':
      return ToolActionLifecycle.running;
    default:
      return ToolActionLifecycle.running;
  }
}

ThreadRunBashApprovalMetadata? readBashApprovalMetadata(
  Map<String, dynamic>? metadata,
) {
  final raw = metadata?['bashApproval'];
  if (raw is! Map<String, dynamic>) return null;
  final toolUseId = (raw['toolUseId'] as String?)?.trim() ?? '';
  final toolName = (raw['toolName'] as String?)?.trim() ?? '';
  if (toolUseId.isEmpty || toolName.isEmpty) return null;
  final phase = (raw['phase'] as String?)?.trim();
  final detail = (raw['detail'] as String?)?.trim();
  final description = (raw['description'] as String?)?.trim();
  return ThreadRunBashApprovalMetadata(
    toolUseId: toolUseId,
    toolName: toolName,
    phase: phase?.isNotEmpty == true ? phase : null,
    detail: detail?.isNotEmpty == true ? detail : null,
    description: description?.isNotEmpty == true ? description : null,
  );
}

Map<String, ThreadRunBashApprovalMetadata> buildBashApprovalIndexByToolUseId(
  ThreadRunProjectionSnapshot? projection,
) {
  final index = <String, ThreadRunBashApprovalMetadata>{};
  if (projection == null) return index;
  void scan(Iterable<ThreadRunProjectionTimelineItem> items) {
    for (final item in items) {
      final approval = readBashApprovalMetadata(item.metadata);
      if (approval != null) {
        index[approval.toolUseId] = approval;
      }
    }
  }

  scan(projection.timeline);
  for (final agent in projection.agents) {
    scan(agent.timeline);
  }
  return index;
}

Map<String, ThreadRunToolMetadata> buildToolIndexByToolUseId(
  ThreadRunProjectionSnapshot? projection,
) {
  final index = <String, ThreadRunToolMetadata>{};
  if (projection == null) return index;
  void scan(Iterable<ThreadRunProjectionTimelineItem> items) {
    for (final item in items) {
      final tool = readProjectionToolMetadata(item.metadata);
      final toolUseId = tool?.toolUseId?.trim();
      if (tool == null || toolUseId == null || toolUseId.isEmpty) continue;
      index[toolUseId] = tool;
    }
  }

  scan(projection.timeline);
  for (final agent in projection.agents) {
    scan(agent.timeline);
  }
  return index;
}

ThreadRunToolMetadata? findProjectionToolForInvocation(
  ParsedActivityToolInvocation invocation,
  Map<String, ThreadRunToolMetadata> toolIndex,
) {
  final normalizedDetail = invocation.detail?.trim();
  ThreadRunToolMetadata? fallback;
  for (final tool in toolIndex.values) {
    if (tool.name != invocation.toolName) continue;
    if (normalizedDetail == null || normalizedDetail.isEmpty) {
      fallback ??= tool;
      continue;
    }
    final toolDetail = tool.detail?.trim();
    if (toolDetail == normalizedDetail) return tool;
    if (tool.name == 'Bash' &&
        toolDetail != null &&
        normalizeBashCommandKey(toolDetail) ==
            normalizeBashCommandKey(normalizedDetail)) {
      return tool;
    }
  }
  return fallback;
}

String normalizeBashCommandKey(String command) {
  return command.trim().replaceAll(RegExp(r'\s+'), ' ');
}

ThreadRunToolMetadata? threadRunToolMetadataFromJson(
  Map<String, dynamic>? json, {
  bool includeOutputPreview = true,
}) {
  if (json == null) return null;
  final name = (json['name'] as String?)?.trim() ?? '';
  if (name.isEmpty) return null;
  final detail = (json['detail'] as String?)?.trim();
  final toolUseId = (json['toolUseId'] as String?)?.trim();
  final description = (json['description'] as String?)?.trim();
  final outputPreview = name == 'Bash' && includeOutputPreview
      ? (json['outputPreview'] as String?)?.trim()
      : null;
  final durationMs = json['durationMs'];
  final status = (json['status'] as String?)?.trim();
  return ThreadRunToolMetadata(
    name: name,
    detail: detail?.isNotEmpty == true ? detail : null,
    toolUseId: toolUseId?.isNotEmpty == true ? toolUseId : null,
    description: description?.isNotEmpty == true ? description : null,
    outputPreview: outputPreview?.isNotEmpty == true ? outputPreview : null,
    outputPreviewTruncated:
        outputPreview?.isNotEmpty == true &&
        json['outputPreviewTruncated'] == true,
    durationMs: durationMs is int ? durationMs : null,
    status: status?.isNotEmpty == true ? status : null,
    readTargetPath: _readToolTargetPath(json['readTarget']),
    grepPattern: _grepToolTargetPattern(json['grepTarget']),
    fileChange: parseThreadRunFileChangeMetadata(json['fileChange']),
    webSearch: _readWebSearchMetadata(json['webSearch']),
  );
}

ThreadRunWebSearchMetadata? _readWebSearchMetadata(dynamic value) {
  if (value is! Map<String, dynamic>) return null;
  final query = (value['query'] as String?)?.trim();
  final url = (value['url'] as String?)?.trim();
  final pattern = (value['pattern'] as String?)?.trim();
  final queries = value['queries'] is List
      ? (value['queries'] as List)
            .whereType<String>()
            .map((entry) => entry.trim())
            .where((entry) => entry.isNotEmpty)
            .take(12)
            .toList(growable: false)
      : const <String>[];
  final actionType = switch (value['actionType']) {
    'search' ||
    'openPage' ||
    'findInPage' ||
    'other' => value['actionType'] as String,
    _ => null,
  };
  final mode = switch (value['mode']) {
    'search' || 'fetch' => value['mode'] as String,
    _ => null,
  };
  if ((query == null || query.isEmpty) &&
      (url == null || url.isEmpty) &&
      (pattern == null || pattern.isEmpty) &&
      queries.isEmpty &&
      actionType == null &&
      mode == null) {
    return null;
  }
  return ThreadRunWebSearchMetadata(
    query: query?.isNotEmpty == true ? query : null,
    url: url?.isNotEmpty == true ? url : null,
    pattern: pattern?.isNotEmpty == true ? pattern : null,
    queries: queries,
    actionType: actionType,
    mode: mode,
  );
}

String? _readToolTargetPath(dynamic value) {
  if (value is! Map<String, dynamic>) return null;
  final path = (value['filePath'] as String?)?.trim();
  return path?.isNotEmpty == true ? path : null;
}

String? _grepToolTargetPattern(dynamic value) {
  if (value is! Map<String, dynamic>) return null;
  final pattern = (value['pattern'] as String?)?.trim();
  return pattern?.isNotEmpty == true ? pattern : null;
}

String? resolveStructuredBashDescription({
  ThreadRunToolMetadata? tool,
  ThreadRunBashApprovalMetadata? bashApproval,
}) {
  final fromTool = tool?.name == 'Bash' ? tool?.description?.trim() : null;
  if (fromTool != null && fromTool.isNotEmpty) {
    return fromTool;
  }
  final fromApproval = bashApproval?.description?.trim();
  if (fromApproval != null && fromApproval.isNotEmpty) {
    return fromApproval;
  }
  return null;
}

String formatStructuredToolActionLabel(
  ThreadRunToolMetadata tool, {
  ThreadRunBashApprovalMetadata? bashApproval,
  required AppLocalizations l10n,
}) {
  if (tool.name == 'Bash') {
    final description = resolveStructuredBashDescription(
      tool: tool,
      bashApproval: bashApproval,
    );
    if (description != null) {
      return description;
    }
  }
  return formatToolDisplayLabel(
    bashApproval?.toolName ?? tool.name,
    bashApproval?.detail ?? tool.detail,
    l10n,
  );
}

ThreadRunToolMetadata? toolMetadataFromBashApproval(
  BashApprovalRequest request, {
  String? status,
}) {
  final toolUseId = request.toolUseId.trim();
  if (toolUseId.isEmpty) return null;
  final toolName = request.filesystemTool?.trim().isNotEmpty == true
      ? request.filesystemTool!.trim()
      : 'Bash';
  final detail = request.filesystemPath?.trim().isNotEmpty == true
      ? request.filesystemPath!.trim()
      : request.command.trim();
  final description = request.description?.trim();
  return ThreadRunToolMetadata(
    name: toolName,
    detail: detail.isNotEmpty ? detail : null,
    toolUseId: toolUseId,
    description: description?.isNotEmpty == true ? description : null,
    status: status,
  );
}

String? bashApprovalLiveTypeToToolStatus(String liveType) {
  if (liveType == 'bash_approval.rejected' ||
      liveType == 'bash_approval.denied') {
    return 'failed';
  }
  if (liveType.startsWith('bash_approval.')) {
    return 'running';
  }
  return null;
}

BashRunCardDisplay? resolveBashRunCardDisplayFromTool(
  ThreadRunToolMetadata tool,
) {
  if (tool.name != 'Bash') return null;
  return resolveBashRunCardDisplay(
    toolName: tool.name,
    command: tool.detail,
    output: tool.outputPreview,
    durationMs: tool.durationMs,
    description: tool.description,
  );
}

class ThreadRunToolMetadata {
  const ThreadRunToolMetadata({
    required this.name,
    this.detail,
    this.toolUseId,
    this.description,
    this.outputPreview,
    this.outputPreviewTruncated = false,
    this.durationMs,
    this.status,
    this.readTargetPath,
    this.grepPattern,
    this.fileChange,
    this.webSearch,
  });

  final String name;
  final String? detail;
  final String? toolUseId;
  final String? description;
  final String? outputPreview;
  final bool outputPreviewTruncated;
  final int? durationMs;
  final String? status;
  final String? readTargetPath;
  final String? grepPattern;
  final ThreadRunFileChangeMetadata? fileChange;
  final ThreadRunWebSearchMetadata? webSearch;
}

class ThreadRunWebSearchMetadata {
  const ThreadRunWebSearchMetadata({
    this.query,
    this.actionType,
    this.url,
    this.pattern,
    this.queries = const [],
    this.mode,
  });

  final String? query;
  final String? actionType;
  final String? url;
  final String? pattern;
  final List<String> queries;
  final String? mode;
}

ThreadRunToolMetadata? readProjectionToolMetadata(
  Map<String, dynamic>? metadata,
) {
  final raw = metadata?['tool'];
  if (raw is! Map<String, dynamic>) return null;
  return threadRunToolMetadataFromJson(raw);
}

String resolveBashApprovalTitle({
  String? description,
  required String reason,
  String? filesystemTool,
  required AppLocalizations l10n,
}) {
  final normalizedDescription = description?.trim();
  if (normalizedDescription != null && normalizedDescription.isNotEmpty) {
    return normalizedDescription;
  }
  final normalizedReason = reason.trim();
  if (normalizedReason.isNotEmpty) return normalizedReason;
  if (filesystemTool != null && filesystemTool.trim().isNotEmpty) {
    return l10n.activityAllowOutsideWorkspace(filesystemTool);
  }
  return l10n.activityToolPermissionRequired;
}

String activityActionKey({
  String? subagent,
  required String label,
  ActivityActionIcon? icon,
}) {
  return '${subagent ?? ''}\x00${icon?.name ?? ''}\x00${normalizeActivityActionLabel(label)}';
}

String normalizeActivityActionLabel(String raw) {
  return stripSubagentBracketPrefix(raw.trim());
}

bool isGenericToolActionLabel(String label, AppLocalizations l10n) {
  final trimmed = label.trim();
  if (trimmed.isEmpty) return true;
  return <String>{
    l10n.toolRead,
    l10n.toolWrite,
    l10n.toolEdit,
    l10n.toolSearch,
    l10n.toolFind,
    l10n.toolRunCommand,
    l10n.toolCall,
    l10n.toolUpdateTasks,
    l10n.toolCreateTask,
    l10n.toolListTasks,
    l10n.toolReadTaskOutput,
    l10n.toolClarify,
    l10n.toolWebSearch,
    l10n.toolWebFetch,
    l10n.activityReadSkill,
  }.contains(trimmed);
}

String resolveMergedToolActionLabel(
  String existing,
  String incoming,
  AppLocalizations l10n,
) {
  if (!isGenericToolActionLabel(existing, l10n) &&
      isGenericToolActionLabel(incoming, l10n)) {
    return existing;
  }
  return incoming;
}

int compareToolActionLifecyclePriority(
  ToolActionLifecycle left,
  ToolActionLifecycle right,
) {
  const rank = {
    ToolActionLifecycle.approvalRejected: 1,
    ToolActionLifecycle.approvalPending: 2,
    ToolActionLifecycle.approvalApproved: 3,
    ToolActionLifecycle.running: 4,
    ToolActionLifecycle.completed: 5,
    ToolActionLifecycle.failed: 5,
  };
  return (rank[left] ?? 0) - (rank[right] ?? 0);
}

String stripSubagentBracketPrefix(String text) {
  return text.replaceFirst(_subagentBracketPrefix, '').trim();
}

String stripActivityStatusNoise(String text) {
  return text.replaceFirst(_activityStatusNoisePattern, '').trim();
}

bool isActivityStatusNoise(String message) {
  final trimmed = message.trim();
  return trimmed == '状态已更新' || _activityStatusNoisePattern.hasMatch(trimmed);
}

bool isUsageNoiseMessage(String message) {
  final text = stripSubagentBracketPrefix(message.trim());
  return _usageNoisePattern.hasMatch(text);
}

bool isActivityNoiseMessage(String message) {
  final text = stripSubagentBracketPrefix(message.trim());
  return text.isEmpty ||
      _activityNoisePattern.hasMatch(text) ||
      isInternalActivityMessage(text);
}

bool isInternalActivityMessage(String message) {
  final trimmed = message.trim();
  if (trimmed.isEmpty) return true;
  if (_internalActivityMessagePattern.hasMatch(trimmed)) return true;
  if (trimmed.startsWith('__eco_worktree_merge__')) return true;
  return false;
}

bool isUsageBadgeText(String message) {
  return _usageBadgePattern.hasMatch(message.trim());
}

bool isSubagentDisplayRole(String? role) {
  final normalized = normalizeAgentDisplayRole(role);
  return normalized != null && subagentDisplayRoles.contains(normalized);
}

bool isInternalAgentActivityRole(String? role) {
  final normalized = normalizeAgentDisplayRole(role);
  return normalized != null && !subagentDisplayRoles.contains(normalized);
}

bool isThreadFollowUpActivityMessage(String message) {
  final trimmed = message.trim();
  if (trimmed.isEmpty) return false;
  return _threadOperationalStatusPatterns.any(
    (pattern) => pattern.hasMatch(trimmed),
  );
}

/// Legacy activity-line bash/filesystem approval transitions; projection owns display.
bool isLegacyBashApprovalActivityText(String message) {
  final trimmed = message.trim();
  if (trimmed.isEmpty) return false;
  if (trimmed.startsWith('Bash 已拒绝：')) return true;
  return RegExp(
    r'^(?:等待确认|已允许本次|已拒绝)\s*[A-Za-z][A-Za-z0-9_]*(?:[：:]\s*.+)?$',
  ).hasMatch(trimmed);
}

bool isRecordedUserPromptLiveEvent(String? liveType) {
  return liveType == 'thread.user_prompt';
}

const clarificationAnswerPrefix = '澄清回答：';

class ClarificationAnswerRow {
  const ClarificationAnswerRow({required this.question, required this.answer});

  final String question;
  final String answer;
}

List<ClarificationAnswerRow>? parseClarificationAnswersSummary(String text) {
  final trimmed = text.trim();
  if (!trimmed.startsWith(clarificationAnswerPrefix)) {
    return null;
  }

  final rest = trimmed.substring(clarificationAnswerPrefix.length).trim();
  if (rest.isEmpty) {
    return const [];
  }

  final parts = rest
      .split('；')
      .map((part) => part.trim())
      .where((part) => part.isNotEmpty);

  return parts.map((part) {
    final segments = part.split(RegExp(r'\s*→\s*'));
    final question = segments.first.trim().isEmpty
        ? part.trim()
        : segments.first.trim();
    final answer = segments.skip(1).join(' → ').trim();
    return ClarificationAnswerRow(question: question, answer: answer);
  }).toList();
}

bool isUserPromptActivityLine({required String role, required String message}) {
  if (role != 'user') return false;
  final text = message.trim();
  return text.isNotEmpty && !isThreadFollowUpActivityMessage(text);
}

String? normalizeAgentDisplayRole(String? role) {
  if (role == null || role.trim().isEmpty) return null;
  final trimmed = role.trim();
  final fromChinese = _chineseRoleToId[trimmed];
  if (fromChinese != null) return fromChinese;
  if (subagentDisplayRoles.contains(trimmed)) return trimmed;

  final withoutEco = trimmed.startsWith('eco_')
      ? trimmed.substring(4)
      : trimmed;
  if (withoutEco.isEmpty || _nonAgentActivityRoles.contains(withoutEco)) {
    return null;
  }
  if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9_-]*$').hasMatch(withoutEco)) {
    return null;
  }
  return withoutEco;
}

bool isAgentDisplayRole(String role) {
  return normalizeAgentDisplayRole(role) != null;
}

bool shouldShowLineInMainFeed({required String role}) {
  if (role == 'user') return true;
  if (role == 'planner' || role == 'thinking') return true;
  if (isAgentDisplayRole(role)) return false;
  return true;
}

String pathBasename(String filePath) {
  final normalized = filePath.replaceAll('\\', '/');
  final segments = normalized.split('/').where((part) => part.isNotEmpty);
  final list = segments.toList();
  if (list.isEmpty) return filePath;
  return list.last;
}

bool _isPath(String token) {
  return token.startsWith('/') ||
      token.startsWith('./') ||
      token.startsWith('~/');
}

String clampActivityPreviewLine(String text, [int max = 56]) {
  final oneLine = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (oneLine.isEmpty || oneLine.length <= max) return oneLine;
  return '${oneLine.substring(0, max - 1)}…';
}

bool isToolElapsedDuration(String value) {
  return RegExp(r'\(\d+(?:\.\d+)?s\)\s*$').hasMatch(value.trim());
}

class ParsedActivityToolInvocation {
  const ParsedActivityToolInvocation({
    required this.toolName,
    this.detail,
    this.durationMs,
    required this.rawMessage,
  });

  final String toolName;
  final String? detail;
  final int? durationMs;
  final String rawMessage;
}

class BashRunCardDisplay {
  const BashRunCardDisplay({
    required this.title,
    this.meta,
    this.command,
    this.output,
  });

  final String title;
  final String? meta;
  final String? command;
  final String? output;
}

int? parseToolDurationMsFromMessage(String message) {
  final match = RegExp(r'\((\d+(?:\.\d+)?)s\)\s*$').firstMatch(message.trim());
  if (match == null) return null;
  final seconds = double.tryParse(match.group(1) ?? '');
  if (seconds == null) return null;
  return (seconds * 1000).round();
}

ParsedActivityToolInvocation? parseActivityToolInvocation(String raw) {
  final text = stripSubagentBracketPrefix(raw.trim());
  if (text.isEmpty) return null;

  for (final item in _progressPatterns) {
    if (item.kind != _ProgressKind.command) continue;
    final match = item.pattern.firstMatch(text);
    if (match != null) {
      final detail = match.group(1)?.trim();
      return ParsedActivityToolInvocation(
        toolName: 'Bash',
        detail: detail?.isEmpty == true ? null : detail,
        durationMs: parseToolDurationMsFromMessage(text),
        rawMessage: text,
      );
    }
  }

  final toolMatch = _toolLinePattern.firstMatch(text);
  if (toolMatch != null) {
    final toolName = toolMatch.group(1) ?? '';
    var detail = toolMatch.group(2)?.trim() ?? toolMatch.group(3)?.trim();
    if (detail != null && RegExp(r'^\(\d+(?:\.\d+)?s\)$').hasMatch(detail)) {
      detail = null;
    } else if (detail != null) {
      detail = detail
          .replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '')
          .trim();
      if (detail.isEmpty) detail = null;
    }
    return ParsedActivityToolInvocation(
      toolName: toolName,
      detail: detail,
      durationMs: parseToolDurationMsFromMessage(text),
      rawMessage: text,
    );
  }

  final bareMatch = RegExp(
    r'^([A-Za-z][A-Za-z0-9_]*)\s*·\s*(.+)$',
  ).firstMatch(text);
  if (bareMatch != null) {
    final toolName = bareMatch.group(1)!;
    final detail = bareMatch
        .group(2)!
        .replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '')
        .trim();
    return ParsedActivityToolInvocation(
      toolName: toolName,
      detail: detail.isEmpty ? null : detail,
      durationMs: parseToolDurationMsFromMessage(text),
      rawMessage: text,
    );
  }

  return null;
}

String formatBashRunMeta(String command, {int? durationMs}) {
  final trimmed = command.trim();
  if (trimmed.isEmpty) {
    if (durationMs == null || durationMs <= 0) return '';
    final seconds = durationMs / 1000;
    return seconds < 60
        ? '${seconds.toStringAsFixed(1)}s'
        : formatDurationMs(durationMs);
  }
  final segments = trimmed.split(RegExp(r'\s*(?:&&|\|\||;)\s*'));
  final firstToken = segments.first.trim().split(RegExp(r'\s+')).first;
  final metaToken = _isPath(firstToken) ? pathBasename(firstToken) : firstToken;
  final parts = <String>[];
  if (metaToken.isNotEmpty) parts.add(metaToken);
  if (segments.length > 1) parts.add('${segments.length - 1}+');
  if (durationMs != null && durationMs > 0) {
    final seconds = durationMs / 1000;
    parts.add(
      seconds < 60
          ? '${seconds.toStringAsFixed(1)}s'
          : formatDurationMs(durationMs),
    );
  }
  return parts.join(', ');
}

String formatBashRunTitle(String? description) {
  final normalizedDescription = description?.trim();
  if (normalizedDescription != null && normalizedDescription.isNotEmpty) {
    return clampActivityPreviewLine(normalizedDescription, 48);
  }
  return 'Shell';
}

BashRunCardDisplay? resolveBashRunCardDisplay({
  String? toolName,
  String? command,
  String? output,
  int? durationMs,
  String? description,
}) {
  if (toolName != 'Bash') return null;
  final normalizedCommand = command?.trim();
  final normalizedOutput = output?.trim();
  final title = formatBashRunTitle(description);
  final meta = normalizedCommand == null || normalizedCommand.isEmpty
      ? null
      : formatBashRunMeta(normalizedCommand, durationMs: durationMs);
  return BashRunCardDisplay(
    title: title,
    meta: meta?.isEmpty == true ? null : meta,
    command: normalizedCommand?.isEmpty == true ? null : normalizedCommand,
    output: normalizedOutput?.isEmpty == true ? null : normalizedOutput,
  );
}

String formatToolDisplayLabel(
  String toolName,
  String? detail,
  AppLocalizations l10n,
) {
  final normalizedDetail = detail?.trim();
  if (toolName == 'Skill' ||
      (normalizedDetail != null && normalizedDetail.endsWith(' 技能'))) {
    return normalizedDetail ?? l10n.activityReadSkill;
  }
  if (toolName == 'Agent') {
    return normalizedDetail ?? l10n.activityStartSubagent;
  }
  if ((toolName == 'WebSearch' || toolName == 'WebFetch') &&
      normalizedDetail != null &&
      normalizedDetail.isNotEmpty) {
    final verb = _toolVerbLabel(toolName, l10n) ?? toolName;
    return '$verb · $normalizedDetail';
  }
  if (normalizedDetail != null && normalizedDetail.isNotEmpty) {
    return normalizedDetail;
  }
  return _toolVerbLabel(toolName, l10n) ?? toolName;
}

class WebSearchCardDisplay {
  const WebSearchCardDisplay({
    required this.kind,
    required this.title,
    required this.query,
    this.meta,
    this.status,
    this.actionType,
    this.actionLabel,
    this.url,
    this.pattern,
    this.queries = const [],
  });

  final String kind;
  final String title;
  final String query;
  final String? meta;
  final String? status;
  final String? actionType;
  final String? actionLabel;
  final String? url;
  final String? pattern;
  final List<String> queries;
}

WebSearchCardDisplay? resolveWebSearchCardDisplayFromTool(
  ThreadRunToolMetadata tool,
  AppLocalizations l10n,
) {
  if (tool.name != 'WebSearch' && tool.name != 'WebFetch') return null;
  final structured = tool.webSearch;
  final kind = tool.name == 'WebFetch' || structured?.mode == 'fetch'
      ? 'fetch'
      : 'search';
  final query = structured?.query?.trim().isNotEmpty == true
      ? structured!.query!.trim()
      : kind == 'fetch' && structured?.url?.trim().isNotEmpty == true
      ? structured!.url!.trim()
      : tool.detail?.trim() ?? '';
  final queryCandidate = query.isNotEmpty
      ? query
      : structured?.queries.firstOrNull ?? structured?.url ?? '';
  final displayQuery = queryCandidate.isNotEmpty
      ? queryCandidate
      : kind == 'fetch'
      ? l10n.activityWebSearchFetch
      : l10n.activityWebSearch;
  final actionType =
      structured?.actionType ?? (kind == 'fetch' ? 'fetch' : 'search');
  final url = structured?.url?.trim().isNotEmpty == true
      ? structured!.url!.trim()
      : kind == 'fetch' && queryCandidate.startsWith('http')
      ? queryCandidate
      : null;
  final pattern = structured?.pattern?.trim();
  final queries = structured?.queries ?? const <String>[];
  final actionLabel = _formatWebSearchActionLabel(
    actionType: actionType,
    url: url,
    pattern: pattern,
    queries: queries,
    l10n: l10n,
  );
  return WebSearchCardDisplay(
    kind: kind,
    title: formatToolDisplayLabel(
      tool.name,
      queryCandidate.isNotEmpty ? queryCandidate : null,
      l10n,
    ),
    query: displayQuery,
    meta: tool.durationMs != null && tool.durationMs! >= 0
        ? '${(tool.durationMs! / 1000).toStringAsFixed(1)}s'
        : null,
    status: tool.status,
    actionType: actionType,
    actionLabel: actionLabel,
    url: url,
    pattern: pattern?.isNotEmpty == true ? pattern : null,
    queries: queries,
  );
}

String? _formatWebSearchActionLabel({
  required String actionType,
  required String? url,
  required String? pattern,
  required List<String> queries,
  required AppLocalizations l10n,
}) {
  if (actionType == 'openPage') {
    return url == null
        ? l10n.activityWebSearchOpenPage
        : '${l10n.activityWebSearchOpenPage} · $url';
  }
  if (actionType == 'findInPage') {
    final target = [
      if (pattern != null && pattern.isNotEmpty) '"$pattern"',
      if (url != null && url.isNotEmpty) url,
    ].join(' · ');
    return target.isEmpty
        ? l10n.activityWebSearchFindInPage
        : '${l10n.activityWebSearchFindInPage} · $target';
  }
  if (actionType == 'fetch') {
    return url == null
        ? l10n.activityWebSearchFetch
        : '${l10n.activityWebSearchFetch} · $url';
  }
  return queries.length > 1
      ? '${queries.length} ${l10n.activityWebSearchQueries}'
      : null;
}

String parseToolActionDisplayLabel(String raw, AppLocalizations l10n) {
  final text = stripSubagentBracketPrefix(raw.trim());
  if (text.isEmpty) return raw.trim();

  for (final item in _progressPatterns) {
    final match = item.pattern.firstMatch(text);
    if (match != null && match.groupCount >= 1) {
      final target = match.group(1)?.trim();
      if (target != null && target.isNotEmpty) {
        return pathBasename(target);
      }
    }
  }

  final toolMatch = _toolLinePattern.firstMatch(text);
  if (toolMatch != null) {
    final tool = toolMatch.group(1) ?? '';
    var detail = toolMatch.group(2)?.trim() ?? toolMatch.group(3)?.trim();
    if (detail != null && RegExp(r'^\(\d+(?:\.\d+)?s\)$').hasMatch(detail)) {
      detail = null;
    } else if (detail != null) {
      detail = detail
          .replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '')
          .trim();
      if (detail.isEmpty) detail = null;
    }
    return formatToolDisplayLabel(tool, detail, l10n);
  }

  final bareMatch = RegExp(
    r'^([A-Za-z][A-Za-z0-9_]*)\s*·\s*(.+)$',
  ).firstMatch(text);
  if (bareMatch != null) {
    final tool = bareMatch.group(1)!;
    final detail = bareMatch
        .group(2)!
        .replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '')
        .trim();
    return formatToolDisplayLabel(tool, detail, l10n);
  }

  return text;
}

ActivityActionIcon iconForToolName(String toolName) {
  switch (toolName) {
    case 'Grep':
    case 'Glob':
      return ActivityActionIcon.search;
    case 'WebSearch':
    case 'WebFetch':
      return ActivityActionIcon.network;
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return ActivityActionIcon.edit;
    case 'Bash':
      return ActivityActionIcon.terminal;
    case 'Agent':
      return ActivityActionIcon.agent;
    default:
      return ActivityActionIcon.file;
  }
}

bool looksLikeToolActionMessage(String message) {
  final stripped = stripSubagentBracketPrefix(message.trim());
  if (stripped.startsWith('Tool:')) return true;
  for (final item in _progressPatterns) {
    if (item.pattern.hasMatch(stripped)) return true;
  }
  return RegExp(r'^[A-Za-z][A-Za-z0-9_]*\s*·\s*.+$').hasMatch(stripped);
}

ActivityActionIcon iconForActivityMessage(String message) {
  final stripped = stripSubagentBracketPrefix(message.trim());
  final toolMatch = _toolLinePattern.firstMatch(stripped);
  if (toolMatch != null) {
    return iconForToolName(toolMatch.group(1) ?? '');
  }
  for (final item in _progressPatterns) {
    if (item.pattern.hasMatch(stripped)) {
      switch (item.kind) {
        case _ProgressKind.search:
          return ActivityActionIcon.search;
        case _ProgressKind.edit:
        case _ProgressKind.write:
          return ActivityActionIcon.edit;
        case _ProgressKind.command:
          return ActivityActionIcon.terminal;
        case _ProgressKind.read:
          return ActivityActionIcon.file;
      }
    }
  }
  return ActivityActionIcon.file;
}

ParsedReconnectActivity? parseReconnectActivityMessage(
  String message,
  AppLocalizations l10n,
) {
  final trimmed = message.trim();

  final connectionFailed = _connectionFailedPattern.firstMatch(trimmed);
  if (connectionFailed != null) {
    final body = connectionFailed.group(1)?.trim() ?? '';
    final httpMatch = RegExp(
      r'^HTTP\s*(\d{3})\s*(?:[：:]\s*([\s\S]*))?$',
    ).firstMatch(body);
    if (httpMatch != null) {
      final detail = httpMatch.group(2)?.trim();
      return ParsedReconnectActivity(
        summary: l10n.activityConnectionFailedHttp(httpMatch.group(1)!),
        detail: detail == null || detail.isEmpty ? null : detail,
      );
    }
    return ParsedReconnectActivity(
      summary: l10n.activityConnectionFailed,
      detail: body.isEmpty ? null : body,
    );
  }

  return null;
}

ParsedReconnectActivity? resolveReconnectPhaseDisplay({
  required String text,
  Map<String, dynamic>? metadata,
  int? apiErrorStatusCode,
  required AppLocalizations l10n,
}) {
  final origin = metadata?['activityOrigin'];
  if (origin == 'sdk.api_retry') {
    final retry = metadata?['retry'];
    if (retry is Map) {
      final attempt = retry['attempt'];
      final maxRetries = retry['maxRetries'];
      if (attempt is num && maxRetries is num) {
        return ParsedReconnectActivity(
          summary: l10n.activityReconnectAttempt(
            attempt.toInt(),
            maxRetries.toInt(),
          ),
        );
      }
    }
  }
  if (origin == 'proxy.connection_error' && apiErrorStatusCode != null) {
    return ParsedReconnectActivity(
      summary: l10n.activityConnectionFailedHttp(apiErrorStatusCode),
    );
  }
  return parseReconnectActivityMessage(text, l10n);
}

bool isReconnectActivityOrigin(String? origin) {
  return origin == 'sdk.api_retry' || origin == 'proxy.connection_error';
}

bool isReconnectActivityMessage(String message) {
  return _connectionFailedPattern.hasMatch(message.trim());
}

final _reconnectClearSystemNoise = <RegExp>[
  RegExp(r'^Local model router ready:', caseSensitive: false),
  RegExp(r'^Claude Agent SDK ready', caseSensitive: false),
  RegExp(r'^Agent session started', caseSensitive: false),
  RegExp(r'^Agent run completed', caseSensitive: false),
  RegExp(r'^Compacting context', caseSensitive: false),
  RegExp(r'^API retry ', caseSensitive: false),
  RegExp(r'^Usage recorded', caseSensitive: false),
  RegExp(r'^Run finished', caseSensitive: false),
  RegExp(r'^已从异常退出恢复'),
];

final _reconnectInProgressPatterns = <RegExp>[
  RegExp(r'^Requesting model', caseSensitive: false),
  RegExp(r'^API error', caseSensitive: false),
];

bool shouldClearReconnectActivity({required String message, String role = ''}) {
  if (isReconnectActivityMessage(message)) {
    return false;
  }

  final trimmed = message.trim();
  if (trimmed.isEmpty ||
      trimmed == '状态已更新' ||
      RegExp(r'^状态已更新\s').hasMatch(trimmed)) {
    return false;
  }
  if (_reconnectClearSystemNoise.any((pattern) => pattern.hasMatch(trimmed))) {
    return false;
  }
  if (_reconnectInProgressPatterns.any(
    (pattern) => pattern.hasMatch(trimmed),
  )) {
    return false;
  }

  if (isSubagentMissionEnvelope(trimmed)) {
    return true;
  }
  if (RegExp(r'^正在刷新上下文用量').hasMatch(trimmed)) {
    return false;
  }
  if (RegExp(r'^Tool:', caseSensitive: false).hasMatch(trimmed) &&
      !RegExp(r'^Tool failed:', caseSensitive: false).hasMatch(trimmed)) {
    return true;
  }
  if (RegExp(r'^【\d+/\d+】').hasMatch(trimmed)) {
    return true;
  }
  if (RegExp(
    r'^(Reading|Writing|Editing|Searching|Running)\s+',
    caseSensitive: false,
  ).hasMatch(trimmed)) {
    return true;
  }
  if (role == 'thinking' && trimmed.isNotEmpty) {
    return true;
  }

  return false;
}

class ParsedReconnectActivity {
  const ParsedReconnectActivity({required this.summary, this.detail});

  final String summary;
  final String? detail;
}

String resolveSubagentRunDisplayTitle(String role, AppLocalizations l10n) {
  final normalized = normalizeAgentDisplayRole(role) ?? role;
  return switch (normalized) {
    'vision' => l10n.roleVision,
    'explore' => l10n.roleExplore,
    'architect' => l10n.roleArchitect,
    'coder' => l10n.roleCoder,
    'reviewer' => l10n.roleReviewer,
    'tester' => l10n.roleTester,
    _ => normalized,
  };
}

/// Format Codex `task_name`: split `_`, capitalize each word's first letter.
String formatSubagentTaskNameLabel(String taskName) {
  final trimmed = taskName.trim();
  if (trimmed.isEmpty) return '';
  return trimmed
      .split('_')
      .map((part) => part.trim())
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String resolveSubagentActivityTitle(String roleLabel, String? taskName) {
  final formatted = taskName == null || taskName.trim().isEmpty
      ? ''
      : formatSubagentTaskNameLabel(taskName);
  return formatted.isEmpty ? roleLabel : '$roleLabel $formatted';
}

String resolveSubagentDetailTitle({
  required String roleLabel,
  String? nickname,
  String? taskName,
}) {
  final name = nickname?.trim().isNotEmpty == true
      ? nickname!.trim()
      : roleLabel;
  final formattedTaskName = taskName == null || taskName.trim().isEmpty
      ? ''
      : formatSubagentTaskNameLabel(taskName);
  return formattedTaskName.isEmpty ? name : '$name · $formattedTaskName';
}

Color subagentMissionBorderColor(
  String role, {
  SubagentThemeSource? themeSource,
}) {
  return subagent_theme.subagentMissionBorderColor(
    role,
    agents: themeSource?.agents ?? const [],
  );
}
