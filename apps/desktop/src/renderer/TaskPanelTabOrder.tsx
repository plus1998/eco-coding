import { Children, isValidElement, type ReactNode } from "react";

/** Keep a replacement in its source slot, including DOM and keyboard order. */
export function TaskPanelTabOrder({
  openTabIds,
  children,
  label,
}: {
  openTabIds: readonly string[];
  children: ReactNode;
  label: string;
}) {
  const positions = new Map(openTabIds.map((id, index) => [id, index]));
  const position = (child: ReactNode) => {
    const tabId = isValidElement<{ "data-task-panel-tab-id"?: string }>(child)
      ? child.props["data-task-panel-tab-id"]
      : undefined;
    return tabId ? (positions.get(tabId) ?? openTabIds.length) : openTabIds.length;
  };
  return (
    <div className="subagent-task-panel-tabs" role="tablist" aria-label={label}>
      {Children.toArray(children).sort((left, right) => position(left) - position(right))}
    </div>
  );
}
