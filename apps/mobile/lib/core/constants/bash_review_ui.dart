class BashReviewUiOption {
  const BashReviewUiOption({
    required this.value,
    required this.title,
    required this.description,
  });

  final String value;
  final String title;
  final String description;
}

const bashReviewUiOptions = [
  BashReviewUiOption(
    value: 'always',
    title: '每次确认',
    description: '执行命令或访问工作区外路径前都询问',
  ),
  BashReviewUiOption(
    value: 'auto',
    title: '风险时确认',
    description: '低风险自动执行；高风险命令或外路径访问仍询问',
  ),
  BashReviewUiOption(
    value: 'allow_all',
    title: '自动执行',
    description: '跳过确认（仍受当前模式、Profile 与安全策略限制）',
  ),
];

BashReviewUiOption bashReviewUi(String mode) {
  return bashReviewUiOptions.firstWhere(
    (entry) => entry.value == mode,
    orElse: () => bashReviewUiOptions.first,
  );
}
