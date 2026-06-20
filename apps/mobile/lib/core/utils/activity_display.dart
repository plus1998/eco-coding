import 'dart:ui' show Color;

import 'subagent_session_timing.dart';

const subagentDisplayRoles = {
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
  '探索': 'explore',
  '架构': 'architect',
  '编码': 'coder',
  '审查': 'reviewer',
  '测试': 'tester',
};

const _toolVerbLabels = {
  'Read': '读取',
  'Write': '写入',
  'Edit': '编辑',
  'MultiEdit': '编辑',
  'Grep': '搜索',
  'Glob': '查找',
  'Bash': '运行命令',
  'Agent': '调用',
  'TodoWrite': '更新任务',
  'TaskCreate': '创建任务',
  'TaskUpdate': '更新任务',
  'TaskList': '列出任务',
  'TaskOutput': '读取任务输出',
  'AskUserQuestion': '澄清问题',
  'WebSearch': '网络搜索',
  'WebFetch': '获取网页',
  'Skill': '读取技能',
};

final _subagentBracketPrefix = RegExp(r'^【[^】]+】\s*');

final _activityNoisePattern = RegExp(
  r'^(?:Tool:|Running tool:|Requesting model|Compacting context|API retry |Usage recorded|Run finished|Agent session started|Agent run completed|Claude Agent SDK ready|状态已更新|已从异常退出恢复|【\d+/\d+】|Creating isolated worktree|Isolated worktree ready:|Local model router ready:|Working in project directory:|已清理隔离工作树|工具调用被拒绝|Permission denied for )',
  caseSensitive: false,
);

final _internalActivityMessagePattern = RegExp(
  r'^(?:标题已更新|标题更新|运行投影已更新|运行投影更新|执行完成。|执行完成，变更已写入项目目录。|执行完成，工作树内无相对基线的文件变更。|正在启动 Claude Agent SDK|等待工具读取确认|等待 Bash 执行确认|读取已确认，继续执行|读取已拒绝，等待 Agent 调整|Bash 已确认，继续执行|Bash 已拒绝，等待 Agent 调整)',
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

final _progressPatterns = <({RegExp pattern, String verb})>[
  (pattern: RegExp(r'^Reading\s+(.+?)(?:\s*·\s*Read)?\s*$', caseSensitive: false), verb: '读取'),
  (pattern: RegExp(r'^Writing\s+(.+?)(?:\s*·\s*Write)?\s*$', caseSensitive: false), verb: '写入'),
  (pattern: RegExp(r'^Editing\s+(.+?)(?:\s*·\s*Edit)?\s*$', caseSensitive: false), verb: '编辑'),
  (pattern: RegExp(r'^Searching\s+(.+?)(?:\s*·\s*Grep)?\s*$', caseSensitive: false), verb: '搜索'),
  (pattern: RegExp(r'^Running\s+(.+?)(?:\s*·\s*Bash)?\s*$', caseSensitive: false), verb: '运行命令'),
];

final _autoRetryPattern = RegExp(r'^【自动重试\s*(\d+)/(\d+)】\s*([\s\S]*)$');
final _connectionFailedPattern = RegExp(r'^【连接失败】\s*([\s\S]*)$');

enum ActivityActionIcon { search, file, edit, terminal, agent }

enum ToolActionLifecycle {
  approvalPending,
  approvalApproved,
  approvalRejected,
  running,
  completed,
  failed,
}

class ParsedBashApprovalActivityText {
  const ParsedBashApprovalActivityText({
    required this.toolName,
    required this.phase,
    this.detail,
  });

  final String toolName;
  final String? detail;
  final ToolActionLifecycle phase;
}

final _bashApprovalActivityPattern = RegExp(
  r'^(?:等待确认|已允许本次|已拒绝|Bash 已拒绝：)\s*([A-Za-z][A-Za-z0-9_]*)(?:[：:]\s*(.+))?$',
);

String activityActionKey({
  String? subagent,
  required String label,
  ActivityActionIcon? icon,
}) {
  return '${subagent ?? ''}\x00${icon?.name ?? ''}\x00${normalizeActivityActionLabel(label)}';
}

String normalizeActivityActionLabel(String raw) {
  return parseToolActionDisplayLabel(raw);
}

ParsedBashApprovalActivityText? parseBashApprovalActivityText(String text) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.startsWith('Bash 已拒绝：')) {
    return ParsedBashApprovalActivityText(
      toolName: 'Bash',
      detail: trimmed.substring('Bash 已拒绝：'.length).trim(),
      phase: ToolActionLifecycle.approvalRejected,
    );
  }
  final match = _bashApprovalActivityPattern.firstMatch(trimmed);
  if (match == null || match.group(1) == null) {
    return null;
  }
  final toolName = match.group(1)!;
  final detail = match.group(2)?.trim();
  if (trimmed.startsWith('等待确认')) {
    return ParsedBashApprovalActivityText(
      toolName: toolName,
      detail: detail,
      phase: ToolActionLifecycle.approvalPending,
    );
  }
  if (trimmed.startsWith('已允许本次')) {
    return ParsedBashApprovalActivityText(
      toolName: toolName,
      detail: detail,
      phase: ToolActionLifecycle.approvalApproved,
    );
  }
  if (trimmed.startsWith('已拒绝')) {
    return ParsedBashApprovalActivityText(
      toolName: toolName,
      detail: detail,
      phase: ToolActionLifecycle.approvalRejected,
    );
  }
  return null;
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
  return _threadOperationalStatusPatterns.any((pattern) => pattern.hasMatch(trimmed));
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

  final withoutEco =
      trimmed.startsWith('eco_') ? trimmed.substring(4) : trimmed;
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
    this.body,
  });

  final String title;
  final String? meta;
  final String? body;
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
    if (item.verb != '运行命令') continue;
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
      detail = detail.replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '').trim();
      if (detail.isEmpty) detail = null;
    }
    return ParsedActivityToolInvocation(
      toolName: toolName,
      detail: detail,
      durationMs: parseToolDurationMsFromMessage(text),
      rawMessage: text,
    );
  }

  final bareMatch = RegExp(r'^([A-Za-z][A-Za-z0-9_]*)\s*·\s*(.+)$').firstMatch(text);
  if (bareMatch != null) {
    final toolName = bareMatch.group(1)!;
    final detail = bareMatch.group(2)!
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
    if (durationMs == null) return '';
    final seconds = durationMs / 1000;
    return seconds < 60
        ? '${seconds.toStringAsFixed(1)}s'
        : formatDurationMs(durationMs);
  }
  final segments = trimmed.split(RegExp(r'\s*(?:&&|\|\||;)\s*'));
  final firstToken = segments.first.trim().split(RegExp(r'\s+')).first;
  final parts = <String>[];
  if (firstToken.isNotEmpty) parts.add(firstToken);
  if (segments.length > 1) parts.add('${segments.length - 1}+');
  if (durationMs != null) {
    final seconds = durationMs / 1000;
    parts.add(
      seconds < 60
          ? '${seconds.toStringAsFixed(1)}s'
          : formatDurationMs(durationMs),
    );
  }
  return parts.join(', ');
}

String _deriveBashTitleFromCommand(String? command) {
  final trimmed = command?.trim();
  if (trimmed == null || trimmed.isEmpty) return '运行命令';
  final segments = trimmed
      .split(RegExp(r'\s*(?:&&|\|\||;)\s*'))
      .map((segment) => segment.trim())
      .where((segment) => segment.isNotEmpty)
      .toList();
  final lastSegment = segments.isEmpty ? trimmed : segments.last;
  final normalized = lastSegment.replaceAll(RegExp(r'\s+'), ' ');
  if (normalized.length <= 48) return normalized;
  final tokens = normalized.split(RegExp(r'\s+')).where((part) => part.isNotEmpty);
  final list = tokens.toList();
  if (list.length >= 2) {
    return clampActivityPreviewLine('${list[0]} ${list[1]}', 48);
  }
  return clampActivityPreviewLine(list.first, 48);
}

bool _looksLikeShellCommand(String text) {
  return RegExp(
    r'^(?:cd|bun|npm|pnpm|yarn|git|curl|make|docker|python|node|\./|/)',
    caseSensitive: false,
  ).hasMatch(text) ||
      text.contains('&&') ||
      text.contains('|');
}

String _normalizeBashSummaryCandidate(String? summaryText) {
  final trimmed = summaryText?.trim();
  if (trimmed == null || trimmed.isEmpty) return '';
  final toolLine = RegExp(
    r'^Tool:\s*Bash(?:\s*·\s*([\s\S]+))?$',
    caseSensitive: false,
  ).firstMatch(trimmed);
  if (toolLine != null) {
    final detail = toolLine.group(1)
        ?.replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '')
        .trim();
    return detail ?? '';
  }
  return trimmed;
}

String formatMeaningfulBashTitle({String? command, String? summaryText}) {
  final summary = _normalizeBashSummaryCandidate(summaryText);
  if (summary.isNotEmpty &&
      !_looksLikeShellCommand(summary) &&
      !RegExp(r'^Tool:\s*', caseSensitive: false).hasMatch(summary)) {
    return clampActivityPreviewLine(summary, 48);
  }
  return _deriveBashTitleFromCommand(command);
}

BashRunCardDisplay? resolveBashRunCardDisplay({
  String? toolName,
  String? command,
  String? summaryText,
  String? output,
  int? durationMs,
}) {
  if (toolName != 'Bash') return null;
  final normalizedCommand = command?.trim();
  final normalizedOutput = output?.trim();
  final normalizedSummary = summaryText?.trim();
  final title = formatMeaningfulBashTitle(
    command: normalizedCommand,
    summaryText: normalizedSummary,
  );
  final meta = normalizedCommand == null || normalizedCommand.isEmpty
      ? null
      : formatBashRunMeta(normalizedCommand, durationMs: durationMs);
  final body = normalizedOutput ?? normalizedCommand;
  return BashRunCardDisplay(
    title: title,
    meta: meta?.isEmpty == true ? null : meta,
    body: body?.isEmpty == true ? null : body,
  );
}

String formatToolDisplayLabel(String toolName, [String? detail]) {
  final normalizedDetail = detail?.trim();
  if (toolName == 'Skill' ||
      (normalizedDetail != null && normalizedDetail.endsWith(' 技能'))) {
    return normalizedDetail ?? '读取技能';
  }
  if (toolName == 'Agent') {
    return normalizedDetail ?? '启动子代理';
  }
  if (normalizedDetail != null && normalizedDetail.isNotEmpty) {
    return normalizedDetail;
  }
  return _toolVerbLabels[toolName] ?? toolName;
}

String parseToolActionDisplayLabel(String raw) {
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
      detail = detail.replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '').trim();
      if (detail.isEmpty) detail = null;
    }
    return formatToolDisplayLabel(tool, detail);
  }

  final bareMatch = RegExp(r'^([A-Za-z][A-Za-z0-9_]*)\s*·\s*(.+)$').firstMatch(text);
  if (bareMatch != null) {
    final tool = bareMatch.group(1)!;
    final detail = bareMatch.group(2)!
        .replaceFirst(RegExp(r'\s+\(\d+(?:\.\d+)?s\)\s*$'), '')
        .trim();
    return formatToolDisplayLabel(tool, detail);
  }

  return text;
}

ActivityActionIcon iconForToolName(String toolName) {
  switch (toolName) {
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
      return ActivityActionIcon.search;
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
      switch (item.verb) {
        case '搜索':
          return ActivityActionIcon.search;
        case '编辑':
        case '写入':
          return ActivityActionIcon.edit;
        case '运行命令':
          return ActivityActionIcon.terminal;
        default:
          return ActivityActionIcon.file;
      }
    }
  }
  return ActivityActionIcon.file;
}

ParsedReconnectActivity? parseReconnectActivityMessage(String message) {
  final trimmed = message.trim();
  final autoRetry = _autoRetryPattern.firstMatch(trimmed);
  if (autoRetry != null) {
    final detail = autoRetry.group(3)?.trim();
    return ParsedReconnectActivity(
      summary: '正在重新连接 ${autoRetry.group(1)}/${autoRetry.group(2)}',
      detail: detail == null || detail.isEmpty ? null : detail,
    );
  }

  final connectionFailed = _connectionFailedPattern.firstMatch(trimmed);
  if (connectionFailed != null) {
    final body = connectionFailed.group(1)?.trim() ?? '';
    final httpMatch =
        RegExp(r'^HTTP\s*(\d{3})\s*(?:[：:]\s*([\s\S]*))?$').firstMatch(body);
    if (httpMatch != null) {
      final detail = httpMatch.group(2)?.trim();
      return ParsedReconnectActivity(
        summary: '连接失败 · HTTP ${httpMatch.group(1)}',
        detail: detail == null || detail.isEmpty ? null : detail,
      );
    }
    return ParsedReconnectActivity(
      summary: '连接失败',
      detail: body.isEmpty ? null : body,
    );
  }

  return null;
}

class ParsedReconnectActivity {
  const ParsedReconnectActivity({required this.summary, this.detail});

  final String summary;
  final String? detail;
}

String resolveSubagentRunDisplayTitle(String role) {
  const labels = {
    'explore': '探索',
    'architect': '架构',
    'coder': '编码',
    'reviewer': '审查',
    'tester': '测试',
  };
  final normalized = normalizeAgentDisplayRole(role) ?? role;
  return labels[normalized] ?? normalized;
}

Color subagentMissionBorderColor(String role) {
  switch (normalizeAgentDisplayRole(role) ?? role) {
    case 'explore':
      return const Color(0x4738BDF8);
    case 'architect':
      return const Color(0x47A78BFA);
    case 'coder':
      return const Color(0x474ADE80);
    case 'reviewer':
      return const Color(0x47FBBF24);
    case 'tester':
      return const Color(0x47FB7185);
    default:
      return const Color(0x4760A5FA);
  }
}
