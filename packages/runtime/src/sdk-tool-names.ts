export const SDK_SKILL_TOOL_NAME = "Skill";
export const SDK_FILESYSTEM_READ_TOOL_NAMES = ["Read", "Glob", "Grep", "LS", "NotebookRead"] as const;
export const SDK_FILESYSTEM_WRITE_TOOL_NAMES = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
// TaskOutput was removed in Claude Code 2.1.277. TaskGet/List describe tracked
// work and do not launch subagents, so keep them with the progress tools.
export const SDK_DELEGATION_SUPPORT_TOOL_NAMES = [] as const;
export const SDK_TASK_READ_TOOL_NAMES = ["TaskList", "TaskGet"] as const;
export const SDK_TASK_PROGRESS_TOOL_NAMES = [
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "TodoWrite",
] as const;
