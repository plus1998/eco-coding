import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/thread_title.dart';

void main() {
  test('sanitizeThreadTitle strips title prefix and parses JSON', () {
    expect(sanitizeThreadTitle('标题：任务状态面板', prompt: '实现 TODO 列表'), '任务状态面板');
    expect(sanitizeThreadTitle('会话标题：修复登录', prompt: '修复登录 bug'), '修复登录');
    expect(sanitizeThreadTitle('{"title":"导出筛选"}', prompt: '实现导出'), '导出筛选');
    expect(
      displayThreadTitle(title: '新编码任务', prompt: '修复登录 bug', fallback: '会话'),
      '修复登录 bug',
    );
    expect(
      displayThreadTitle(title: '新任务', prompt: '修复登录 bug', fallback: '会话'),
      '修复登录 bug',
    );
    expect(
      displayThreadTitle(
        title: 'New Task',
        prompt: 'fix login bug',
        fallback: 'Session',
      ),
      'fix login bug',
    );
  });

  test('isThreadTitlePending matches empty and placeholder titles', () {
    expect(isThreadTitlePending(null), isTrue);
    expect(isThreadTitlePending(''), isTrue);
    expect(isThreadTitlePending('  '), isTrue);
    expect(isThreadTitlePending('新任务'), isTrue);
    expect(isThreadTitlePending('New Task'), isTrue);
    expect(isThreadTitlePending('新编码任务'), isTrue);
    expect(isThreadTitlePending('修复登录 bug'), isFalse);
  });
}
