class PlanModeUiOption {
  const PlanModeUiOption({
    required this.value,
    required this.title,
    required this.description,
  });

  final bool value;
  final String title;
  final String description;
}

const planModeUiOptions = [
  PlanModeUiOption(
    value: false,
    title: 'Agent',
    description: '代理直接处理任务，并按需要调用已启用的子代理。',
  ),
  PlanModeUiOption(
    value: true,
    title: 'Plan',
    description: '先生成计划并等待确认，批准后再进入执行。',
  ),
];

PlanModeUiOption planModeUi(bool planModeEnabled) {
  return planModeUiOptions.firstWhere(
    (entry) => entry.value == planModeEnabled,
    orElse: () => planModeUiOptions.first,
  );
}
