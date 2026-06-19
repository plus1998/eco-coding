import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentTemplateCapabilityOption } from "./agent-template-form";
import { parseList, toggleAgentTemplateAdvancedDisallowedTool, toggleAgentTemplateListValue } from "./agent-template-form";
import {
  matchesToolCapabilityPreset,
  TOOL_CAPABILITY_PRESETS,
  type ToolCapabilityFieldValues,
} from "./tool-capability-groups";

export interface ToolCapabilityPanelProps {
  values: ToolCapabilityFieldValues;
  disabled?: boolean | undefined;
  capabilityOptions: {
    tools: AgentTemplateCapabilityOption[];
    mcpServers: AgentTemplateCapabilityOption[];
    mcpTools: AgentTemplateCapabilityOption[];
  };
  showDelegation?: boolean;
  showTaskProgress?: boolean;
  showPresets?: boolean;
  onChange: (patch: Partial<ToolCapabilityFieldValues>) => void;
}

export function ToolCapabilityPanel({
  values,
  disabled,
  capabilityOptions,
  showDelegation = true,
  showTaskProgress = true,
  showPresets = true,
  onChange,
}: ToolCapabilityPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activePresetId = useMemo(
    () => TOOL_CAPABILITY_PRESETS.find((preset) => matchesToolCapabilityPreset(values, preset))?.id,
    [values],
  );
  const selectedMcpServers = parseList(values.mcpServers);
  const mcpTools = parseList(values.mcpTools);
  const advancedDisallowed = parseList(values.advancedDisallowedTools);

  function applyPreset(preset: (typeof TOOL_CAPABILITY_PRESETS)[number]) {
    onChange({
      ...preset.values,
      bashCommandAllowlist: values.bashCommandAllowlist,
      bashCommandDenylist: values.bashCommandDenylist,
      advancedDisallowedTools: values.advancedDisallowedTools,
      mcpServers: values.mcpServers,
      mcpTools: values.mcpTools,
      allowDelegation: values.allowDelegation,
    });
  }

  return (
    <div className="models-tool-capability-panel">
      {showPresets ? (
        <div className="models-agent-template-preset-grid">
          {TOOL_CAPABILITY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={
                activePresetId === preset.id
                  ? "models-agent-template-preset active"
                  : "models-agent-template-preset"
              }
              disabled={disabled}
              onClick={() => applyPreset(preset)}
              title={preset.hint}
            >
              <span>{preset.label}</span>
              <small>{preset.hint}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="models-tool-capability-list">
        <CapabilityToggle
          label="读取代码库"
          description="浏览与搜索仓库文件（Read、Glob、Grep 等）。"
          checked={values.readCodebase}
          disabled={disabled}
          onChange={(readCodebase) => onChange({ readCodebase })}
        />
        {values.readCodebase ? (
          <label className="mcp-field models-tool-capability-subfield">
            <span className="mcp-field-label">读取范围</span>
            <select
              className="mcp-field-input"
              value={values.readScope}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  readScope: event.target.value as ToolCapabilityFieldValues["readScope"],
                })
              }
            >
              <option value="workspace">工作区</option>
              <option value="extra_dirs">工作区+扩展</option>
            </select>
          </label>
        ) : null}

        <CapabilityToggle
          label="修改代码库"
          description="创建和编辑文件（Write、Edit 等）。"
          checked={values.writeCodebase}
          disabled={disabled}
          onChange={(writeCodebase) => onChange({ writeCodebase })}
        />

        <CapabilityToggle
          label="运行命令"
          description="执行 Bash 命令。"
          checked={values.bash}
          disabled={disabled}
          onChange={(bash) => onChange({ bash })}
        />
        {values.bash ? (
          <>
            <label className="mcp-field models-tool-capability-subfield">
              <span className="mcp-field-label">命令白名单</span>
              <input
                className="mcp-field-input"
                value={values.bashCommandAllowlist}
                disabled={disabled}
                onChange={(event) => onChange({ bashCommandAllowlist: event.target.value })}
              />
            </label>
            <label className="mcp-field models-tool-capability-subfield">
              <span className="mcp-field-label">命令黑名单</span>
              <input
                className="mcp-field-input"
                value={values.bashCommandDenylist}
                disabled={disabled}
                onChange={(event) => onChange({ bashCommandDenylist: event.target.value })}
              />
            </label>
          </>
        ) : null}

        <CapabilityToggle
          label="联网检索"
          description="Web 搜索与网页抓取。"
          checked={values.network}
          disabled={disabled}
          onChange={(network) => onChange({ network })}
        />

        {showTaskProgress ? (
          <CapabilityToggle
            label="更新执行进度"
            description="同步 Composer 任务列表（TaskCreate、TaskUpdate）。"
            checked={values.taskProgress}
            disabled={disabled}
            onChange={(taskProgress) => onChange({ taskProgress })}
          />
        ) : null}

        {showDelegation ? (
          <CapabilityToggle
            label="继续委派"
            description="调用其他子代理（Agent、Task 等）。"
            checked={values.allowDelegation}
            disabled={disabled}
            onChange={(allowDelegation) => onChange({ allowDelegation })}
          />
        ) : null}

        <CapabilityToggle
          label="加载 Skill"
          description="加载已配置的 Claude Skill。"
          checked={values.skill}
          disabled={disabled}
          onChange={(skill) => onChange({ skill })}
        />

        <CapabilityToggle
          label="询问用户"
          description="向用户发起选择题或补充信息请求。"
          checked={values.askUser}
          disabled={disabled}
          onChange={(askUser) => onChange({ askUser })}
        />
      </div>

      <SelectableTokenGroup
        label="MCP Servers"
        options={capabilityOptions.mcpServers}
        selectedValues={selectedMcpServers}
        disabled={disabled}
        emptyText="当前模板库没有可选 MCP Server。"
        onToggle={(value, checked) =>
          onChange({ mcpServers: toggleAgentTemplateListValue(values.mcpServers, value, checked) })
        }
      />
      <SelectableTokenGroup
        label="MCP Tools"
        options={capabilityOptions.mcpTools}
        selectedValues={mcpTools}
        disabled={disabled}
        emptyText="当前模板库没有可选 MCP Tool。"
        onToggle={(value, checked) =>
          onChange({ mcpTools: toggleAgentTemplateListValue(values.mcpTools, value, checked) })
        }
      />

      <button
        type="button"
        className="models-tool-capability-advanced-toggle"
        disabled={disabled}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        {advancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>高级：按工具细调</span>
        {advancedDisallowed.length > 0 ? <small>{advancedDisallowed.length} 项禁用</small> : null}
      </button>

      {advancedOpen ? (
        <SelectableTokenGroup
          label="高级禁用工具"
          tone="danger"
          options={capabilityOptions.tools}
          selectedValues={advancedDisallowed}
          disabled={disabled}
          emptyText="没有可单独细调的工具。"
          onToggle={(value, checked) =>
            onChange({
              advancedDisallowedTools: toggleAgentTemplateAdvancedDisallowedTool(
                values.advancedDisallowedTools,
                value,
                checked,
              ),
            })
          }
        />
      ) : null}
    </div>
  );
}

function CapabilityToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
	}: {
	  label: string;
	  description: string;
	  checked: boolean;
	  disabled?: boolean | undefined;
	  onChange: (checked: boolean) => void;
	}) {
  return (
    <div className="models-agent-template-delegation-card">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <label className="mcp-toggle" title={checked ? "已启用" : "已禁用"}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="mcp-toggle-track" aria-hidden />
      </label>
    </div>
  );
}

function SelectableTokenGroup({
  label,
  options,
  selectedValues,
  disabled,
  tone,
  emptyText = "暂无可选项。",
  onToggle,
}: {
  label: string;
  options: AgentTemplateCapabilityOption[];
  selectedValues: string[];
  disabled?: boolean | undefined;
  tone?: "danger" | undefined;
  emptyText?: string;
  onToggle: (value: string, checked: boolean) => void;
}) {
  const selected = new Set(selectedValues);
  return (
    <section className="models-agent-token-group">
      <div className="models-agent-token-group-head">
        <span>{label}</span>
        <small>{selectedValues.length} 已选</small>
      </div>
      {options.length === 0 ? (
        <p className="models-agent-token-empty">{emptyText}</p>
      ) : (
        <div className="models-agent-token-options">
          {options.map((option) => {
            const active = selected.has(option.value);
            const optionDisabled = disabled || (option.disabled && !active);
            const className = [
              "models-agent-token-option",
              active ? "active" : "",
              tone === "danger" ? "danger" : "",
              optionDisabled ? "is-disabled" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <label key={option.value} className={className} title={option.description ?? option.label}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={optionDisabled}
                  onChange={(event) => onToggle(option.value, event.target.checked)}
                />
                <span className="models-agent-token-option-label">{option.label}</span>
                <span className="models-agent-token-option-meta">{option.sourceLabel}</span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
