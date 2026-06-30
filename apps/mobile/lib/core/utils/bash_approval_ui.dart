String formatBashApprovalRememberPrefix(String command, {int maxLength = 48}) {
  final trimmed = command.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return '${trimmed.substring(0, maxLength - 1)}…';
}

const bashApprovalRememberPrefixIntro = '是，且对于以后续内容开头的命令不再询问 ';

String buildBashApprovalRememberPrefixLabel(String command) {
  return '$bashApprovalRememberPrefixIntro${formatBashApprovalRememberPrefix(command)}';
}

const bashApprovalDenyOptionLabel = '否，请告知 Eco 如何调整';

enum BashApprovalChoice { approve, approveRememberPrefix, deny }

String bashApprovalDecisionValue(BashApprovalChoice choice) {
  return switch (choice) {
    BashApprovalChoice.approve => 'approved',
    BashApprovalChoice.approveRememberPrefix => 'approved_remember_prefix',
    BashApprovalChoice.deny => 'denied',
  };
}
