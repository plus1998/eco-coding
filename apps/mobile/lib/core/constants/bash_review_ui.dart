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
    title: '请求批准',
    description: '执行 Bash 命令时始终询问',
  ),
  BashReviewUiOption(
    value: 'auto',
    title: '替我审批',
    description: '仅对检测到的风险操作请求批准',
  ),
  BashReviewUiOption(
    value: 'allow_all',
    title: '完全访问权限',
    description: '自动批准 Bash 命令（仍需智能体配置允许 Bash 工具）',
  ),
];

BashReviewUiOption bashReviewUi(String mode) {
  return bashReviewUiOptions.firstWhere(
    (entry) => entry.value == mode,
    orElse: () => bashReviewUiOptions.first,
  );
}
