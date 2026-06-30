import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../theme/eco_icons.dart';
import 'adaptive_toolbar_icon.dart'
    show AdaptiveToolbarIcon, sessionToolbarButtonGap, sessionToolbarButtonSize;
import '../../features/projects/project_menu_sheets.dart';

/// Top-right shell actions: optional open-project, then switch-PC.
class ShellToolbarActions extends ConsumerWidget {
  const ShellToolbarActions({
    super.key,
    this.showOpenProject = false,
  });

  final bool showOpenProject;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showOpenProject) ...[
            AdaptiveToolbarIcon(
              tooltip: '打开项目',
              icon: EcoIcons.folderOpen,
              size: sessionToolbarButtonSize,
              onPressed: () => showOpenProjectSheet(
                context: context,
                ref: ref,
              ),
            ),
            const SizedBox(width: sessionToolbarButtonGap),
          ],
          AdaptiveToolbarIcon(
            tooltip: '切换 PC',
            icon: EcoIcons.desktop,
            size: sessionToolbarButtonSize,
            onPressed: () => context.push('/connect'),
          ),
        ],
      ),
    );
  }
}
