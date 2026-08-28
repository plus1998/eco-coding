/**
 * Names for agent-browser `--tools core`, pinned to agent-browser@0.33.2
 * (`cli/src/mcp.rs` CORE_PROFILE_TOOLS). Used so tools/list can advertise
 * the surface without spawning a CDP child (which would mint about:blank).
 *
 * Full input schemas match agent-browser core MCP tools; Eco executes them via CLI.
 */
export const AGENT_BROWSER_CORE_TOOL_NAMES = [
  "agent_browser_tools_profiles",
  "agent_browser_open",
  "agent_browser_read",
  "agent_browser_snapshot",
  "agent_browser_back",
  "agent_browser_forward",
  "agent_browser_reload",
  "agent_browser_click",
  "agent_browser_fill",
  "agent_browser_type",
  "agent_browser_press",
  "agent_browser_check",
  "agent_browser_uncheck",
  "agent_browser_select",
  "agent_browser_scroll",
  "agent_browser_wait_ms",
  "agent_browser_wait_for_selector",
  "agent_browser_wait_for_text",
  "agent_browser_wait_for_load",
  "agent_browser_screenshot",
  "agent_browser_get_text",
  "agent_browser_get_url",
  "agent_browser_get_title",
  "agent_browser_tab_new",
  "agent_browser_tab_list",
  "agent_browser_tab_switch",
  "agent_browser_tab_close",
  "agent_browser_eval",
  "agent_browser_close",
] as const;

export function agentBrowserCoreToolsCatalog(): Array<Record<string, unknown>> {
  return AGENT_BROWSER_CORE_TOOL_NAMES.map((name) => ({
    name,
    description: `Eco built-in browser: ${name.replace(/^agent_browser_/, "").replace(/_/g, " ")}`,
    inputSchema: { type: "object", additionalProperties: true },
  }));
}
