import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:eco_mobile/core/utils/activity_display.dart';
import 'package:eco_mobile/core/utils/feed_action_kind.dart';

void main() {
  final l10n = lookupAppLocalizations(const Locale('zh'));

  test('lowercase PI tool names classify', () {
    expect(resolveActionKind(toolName: 'bash').kind, ActionKind.command);
    expect(resolveActionKind(toolName: 'read').kind, ActionKind.read);
  });

  test('resolveActionKind maps aliases case-insensitively', () {
    expect(resolveActionKind(toolName: 'Read').kind, ActionKind.read);
    expect(resolveActionKind(toolName: 'Read').icon, ActivityActionIcon.read);
    expect(resolveActionKind(toolName: 'Write').kind, ActionKind.write);
    expect(resolveActionKind(toolName: 'WebFetch').kind, ActionKind.webFetch);
    expect(resolveActionKind(toolName: 'webfetch').kind, ActionKind.webFetch);
    expect(
      resolveActionKind(toolName: 'Bash').icon,
      ActivityActionIcon.terminal,
    );
    expect(resolveActionKind(toolName: 'bash').kind, ActionKind.command);
  });

  test('Write + fileChange stays write', () {
    final resolved = resolveActionKind(
      toolName: 'Write',
      payload: const ActionKindPayload(
        fileChange: ActionKindFileChange(
          path: '/repo/auth.ts',
          fileName: 'auth.ts',
        ),
      ),
    );
    expect(resolved.kind, ActionKind.write);
    expect(resolved.bucket, ActionGroupBucket.writtenFiles);
  });

  test('fileChange payload only applies when the name is unknown', () {
    expect(
      resolveActionKind(
        toolName: 'MysteryPatch',
        payload: const ActionKindPayload(
          fileChange: ActionKindFileChange(path: '/repo/a.ts'),
        ),
      ).kind,
      ActionKind.edit,
    );
  });

  test('mcpDiscovery.search wins before generic mcp alias', () {
    expect(
      resolveActionKind(
        toolName: 'mcp',
        payload: const ActionKindPayload(
          mcpDiscovery: ActionKindMcpDiscovery(kind: 'search'),
        ),
      ).kind,
      ActionKind.mcpSearch,
    );
  });

  test('webSearch.mode fetch upgrades webSearch to webFetch', () {
    expect(
      resolveActionKind(
        toolName: 'WebSearch',
        payload: const ActionKindPayload(
          webSearch: ActionKindWebSearch(
            mode: 'fetch',
            url: 'https://example.com',
          ),
        ),
      ).kind,
      ActionKind.webFetch,
    );
  });

  test('eco browser and image tools classify', () {
    final click = resolveActionKind(
      toolName: 'mcp__eco_agent_browser__agent_browser_click',
    );
    expect(click.kind, ActionKind.browser);
    expect(click.namedSuffix, 'agent_browser_click');
    expect(
      resolveActionKind(
        toolName: 'mcp__eco_ab_ea4a60abe66__agent_browser_open',
      ).kind,
      ActionKind.browser,
    );
    expect(
      resolveActionKind(
        toolName: 'mcp__eco_image_generation__create_image',
      ).kind,
      ActionKind.imageCreate,
    );
    expect(resolveActionKind(toolName: 'ViewImage').kind, ActionKind.imageView);
    expect(resolveActionKind(toolName: 'ViewImage').icon, ActivityActionIcon.images);
    expect(
      resolveActionKind(toolName: 'mcp__eco_image_view__view_image').kind,
      ActionKind.imageView,
    );
    expect(
      resolveActionKind(toolName: 'mcp__eco_image_view__view_image').icon,
      ActivityActionIcon.images,
    );
  });

  test('mcp tools are not stolen by skill heuristic', () {
    expect(
      resolveActionKind(toolName: 'mcp__foo__read_skill').kind,
      ActionKind.mcp,
    );
    expect(resolveActionKind(toolName: 'ReadSkill').kind, ActionKind.skill);
    expect(
      resolveActionKind(toolName: 'custom_skill_loader').kind,
      ActionKind.skill,
    );
  });

  test('unknown tools use kind tool and icon tool', () {
    final resolved = resolveActionKind(toolName: 'TotallyUnknown');
    expect(resolved.kind, ActionKind.tool);
    expect(resolved.icon, ActivityActionIcon.tool);
    expect(resolved.bucket, ActionGroupBucket.otherTools);
    expect(resolveActionKind(toolName: '').kind, ActionKind.tool);
    expect(resolveActionKind().kind, ActionKind.tool);
  });

  test('done line includes basename', () {
    expect(
      formatActionLine(
        resolved: resolveActionKind(toolName: 'Read'),
        phase: ActionLinePhase.done,
        rawTarget: '/repo/auth.ts',
        l10n: l10n,
      ),
      '读取了 auth.ts',
    );
  });

  test('done line falls back without target', () {
    expect(
      formatActionLine(
        resolved: resolveActionKind(toolName: 'Read'),
        phase: ActionLinePhase.done,
        l10n: l10n,
      ),
      '读取了文件',
    );
  });

  test('running line includes target', () {
    expect(
      formatActionLine(
        resolved: resolveActionKind(toolName: 'Read'),
        phase: ActionLinePhase.running,
        rawTarget: 'auth.ts',
        l10n: l10n,
      ),
      '正在读取 auth.ts',
    );
  });

  test('WebFetch copy is not webSearch copy', () {
    expect(
      formatActionLine(
        resolved: resolveActionKind(toolName: 'WebFetch'),
        phase: ActionLinePhase.done,
        payload: const ActionKindPayload(
          webSearch: ActionKindWebSearch(
            mode: 'fetch',
            url: 'https://huggingface.co/docs',
          ),
        ),
        l10n: l10n,
      ),
      '获取了 huggingface.co',
    );
  });

  test(
    'summarizeActionGroup counts without filenames and splits web from search',
    () {
      final items = [
        resolveActionKind(toolName: 'Read'),
        resolveActionKind(toolName: 'Read'),
        resolveActionKind(toolName: 'WebFetch'),
        resolveActionKind(toolName: 'Grep'),
      ];
      final summary = summarizeActionGroup(items, l10n);
      expect(summary.label, contains('已读取 2 个文件'));
      expect(summary.label, isNot(contains('auth.ts')));
      expect(summary.label, contains('已联网 1 次'));
      expect(summary.label, contains('已搜索代码 1 次'));
      expect(summary.label, isNot(contains('已联网搜索')));
      expect(summary.icon, ActivityActionIcon.read);
    },
  );

  test('summarizeActionGroup en joinMany does not use Chinese顿号', () {
    final en = lookupAppLocalizations(const Locale('en'));
    final items = [
      resolveActionKind(toolName: 'Read'),
      resolveActionKind(toolName: 'Edit'),
      resolveActionKind(toolName: 'Grep'),
    ];
    final summary = summarizeActionGroup(items, en);
    expect(summary.label, isNot(contains('、')));
    expect(summary.label, contains(', '));
  });

  test(
    'summarizeActionGroup icon priority uses network for mcp and browser for browser',
    () {
      expect(
        summarizeActionGroup([resolveActionKind(toolName: 'mcp')], l10n).icon,
        ActivityActionIcon.network,
      );
      expect(
        summarizeActionGroup([
          resolveActionKind(
            toolName: 'mcp__eco_agent_browser__agent_browser_click',
          ),
        ], l10n).icon,
        ActivityActionIcon.browser,
      );
      expect(
        summarizeActionGroup([
          resolveActionKind(toolName: 'Read'),
          resolveActionKind(toolName: 'mcp'),
        ], l10n).icon,
        ActivityActionIcon.read,
      );
    },
  );
}
