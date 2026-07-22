const WORKSPACE_PANEL_VERTICAL_CHROME_PX = 24;

export function workspacePanelMaxHeight({
  workspaceHeight,
  toolbarClearance,
  terminalHeight,
  verticalChrome = WORKSPACE_PANEL_VERTICAL_CHROME_PX,
}: {
  workspaceHeight: number;
  toolbarClearance: number;
  terminalHeight: number;
  verticalChrome?: number;
}): number {
  return Math.max(0, workspaceHeight - toolbarClearance - terminalHeight - verticalChrome);
}
