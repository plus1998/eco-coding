import { expect, test } from "bun:test";
import { buildPresetTemplateImportPlan, createPresetTemplateCopyBaseId } from "../src/renderer/preset-import";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInAgentTemplates,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";

function requireResearchPreset() {
  const preset = createBuiltInPresetCatalog().find((candidate) => candidate.id === "research");
  if (!preset) {
    throw new Error("Missing research preset.");
  }
  return preset;
}

test("preset import copies library templates and rewrites profile agent template references", () => {
  const preset = requireResearchPreset();
  const templates = createBuiltInAgentTemplates();
  const plan = buildPresetTemplateImportPlan(preset, templates, {
    nowIso: "2026-06-08T00:00:00.000Z",
  });

  expect(plan.templatesToSave).toHaveLength(preset.defaultAgents.length);
  expect(plan.templatesToSave.map((template) => template.id)).toEqual(
    preset.defaultAgents.map((agent) => createPresetTemplateCopyBaseId(preset.id, agent.templateId)),
  );
  expect(plan.templatesToSave.every((template) => template.source === "user")).toBe(true);
  expect(plan.templatesToSave.every((template) => template.builtIn === false)).toBe(true);
  expect(plan.templatesToSave.every((template) => template.updatedAt === "2026-06-08T00:00:00.000Z")).toBe(
    true,
  );
  expect(plan.presetForProfile.defaultAgents.map((agent) => agent.templateId)).toEqual(
    plan.templatesToSave.map((template) => template.id),
  );

  const profile = buildOrchestrationProfileFromPreset(plan.presetForProfile, {
    id: "user.research.profile",
    name: "Research Profile",
    modelRef: { providerId: "p1", modelId: "model-1" },
    templates: plan.templatesForProfile,
  });
  expect(profile.agents.map((agent) => agent.templateId)).toEqual(
    plan.presetForProfile.defaultAgents.map((agent) => agent.templateId),
  );
});

test("preset import reuses existing user template copies", () => {
  const preset = requireResearchPreset();
  const templates = createBuiltInAgentTemplates();
  const firstPresetAgent = preset.defaultAgents[0];
  if (!firstPresetAgent) {
    throw new Error("Research preset must contain at least one agent.");
  }
  const sourceTemplate = templates.find((template) => template.id === firstPresetAgent.templateId);
  if (!sourceTemplate) {
    throw new Error("Missing source template.");
  }
  const existingCopy = {
    ...sourceTemplate,
    id: createPresetTemplateCopyBaseId(preset.id, sourceTemplate.id),
    name: "Custom Researcher",
    builtIn: false,
    source: "user" as const,
    version: 3,
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  const plan = buildPresetTemplateImportPlan(preset, [...templates, existingCopy], {
    nowIso: "2026-06-08T00:00:00.000Z",
  });

  expect(plan.copiedTemplateIds[sourceTemplate.id]).toBe(existingCopy.id);
  expect(plan.templatesToSave.map((template) => template.id)).not.toContain(existingCopy.id);
  expect(plan.templatesToSave).toHaveLength(preset.defaultAgents.length - 1);
  expect(plan.presetForProfile.defaultAgents[0]?.templateId).toBe(existingCopy.id);
});

test("preset import reuses numbered user copies after base id conflicts", () => {
  const preset = requireResearchPreset();
  const templates = createBuiltInAgentTemplates();
  const firstPresetAgent = preset.defaultAgents[0];
  if (!firstPresetAgent) {
    throw new Error("Research preset must contain at least one agent.");
  }
  const sourceTemplate = templates.find((template) => template.id === firstPresetAgent.templateId);
  if (!sourceTemplate) {
    throw new Error("Missing source template.");
  }
  const baseId = createPresetTemplateCopyBaseId(preset.id, sourceTemplate.id);
  const conflictingBase = {
    ...sourceTemplate,
    id: baseId,
    builtIn: true,
    source: "built_in" as const,
  };
  const existingNumberedCopy = {
    ...sourceTemplate,
    id: `${baseId}.2`,
    name: "Custom Researcher",
    builtIn: false,
    source: "project" as const,
    version: 4,
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  const plan = buildPresetTemplateImportPlan(preset, [...templates, conflictingBase, existingNumberedCopy]);

  expect(plan.copiedTemplateIds[sourceTemplate.id]).toBe(existingNumberedCopy.id);
  expect(plan.templatesToSave.map((template) => template.id)).not.toContain(`${baseId}.3`);
  expect(plan.presetForProfile.defaultAgents[0]?.templateId).toBe(existingNumberedCopy.id);
});
