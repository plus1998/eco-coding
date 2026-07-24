import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';

import 'package:eco_mobile/core/models/git_models.dart';
import 'package:eco_mobile/features/threads/thread_session_menu.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';

final _zh = lookupAppLocalizations(const Locale('zh'));

void main() {
  test('remote sync action matches desktop fetch and pull behavior', () {
    expect(resolveGitRemoteSyncAction(0), 'fetch');
    expect(resolveGitRemoteSyncAction(2), 'pull');
  });

  test('remote sync label shows fetch or behind count', () {
    expect(resolveGitRemoteSyncLabel(null, _zh), '抓取');
    expect(resolveGitRemoteSyncLabel(_gitStatus(behindCount: 0), _zh), '抓取');
    expect(
      resolveGitRemoteSyncLabel(_gitStatus(behindCount: 3), _zh),
      '拉取（落后 3）',
    );
  });

  test('GitFetchResult parses desktop response', () {
    final result = GitFetchResult.fromJson({'output': 'Fetched origin'});
    expect(result.output, 'Fetched origin');
  });
}

GitWorkingTreeStatus _gitStatus({required int behindCount}) {
  return GitWorkingTreeStatus(
    workspacePath: '/repo',
    isGitRepository: true,
    hasGitCommits: true,
    dirtyFileCount: 0,
    insertions: 0,
    deletions: 0,
    canCommit: false,
    aheadCount: 0,
    behindCount: behindCount,
    hasUpstream: true,
    branch: 'main',
  );
}
