import 'session_mode.dart';

class SessionModeUiOption {
  const SessionModeUiOption({
    required this.value,
    required this.title,
    required this.description,
  });

  final SessionMode value;
  final String title;
  final String description;
}

const sessionModeUiOptions = [
  SessionModeUiOption(
    value: 'agent',
    title: 'Agent',
    description: '代理直接处理任务，并按需要调用已启用的子代理。',
  ),
  SessionModeUiOption(
    value: 'plan',
    title: 'Plan',
    description: '先生成计划并等待确认，批准后再进入执行。',
  ),
  SessionModeUiOption(
    value: 'ask',
    title: 'Ask',
    description: '只读回答与代码探索，不修改文件、不执行命令。',
  ),
];

SessionModeUiOption sessionModeUi(SessionMode mode) {
  return sessionModeUiOptions.firstWhere(
    (entry) => entry.value == mode,
    orElse: () => sessionModeUiOptions.first,
  );
}
