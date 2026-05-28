import { expect, test } from "bun:test";
import {
  extractPhaseDeliverable,
  extractPlanningDeliverables,
  findPlanSectionStart,
} from "../src/phase-deliverable";

const noisyPlanTranscript = `Claude Agent SDK ready (claude-opus-4-7).
Requesting model…

The user wants product descriptions to support Markdown rendering.

Let me look at the specific code sections that will need changes.
Tool: Read · App.tsx
Tool: Read · styles.css
Requesting model…
Tool: Grep · client
Tool: Read · package.json
Requesting model…Now I have a complete picture. Here's the implementation plan:

---

## 实现计划：商品描述支持 Markdown 渲染

### 目标
- 在商品描述区域渲染 Markdown

### 步骤
1. 安装 react-markdown
`;

test("extracts plan section after tooling noise", () => {
  const plan = extractPhaseDeliverable(noisyPlanTranscript, "plan");
  expect(plan.startsWith("## 实现计划")).toBe(true);
  expect(plan).toContain("react-markdown");
  expect(plan).not.toContain("Tool: Read");
  expect(plan).not.toContain("Requesting model");
});

test("findPlanSectionStart locates markdown heading", () => {
  const index = findPlanSectionStart(noisyPlanTranscript);
  expect(noisyPlanTranscript.slice(index).startsWith("## 实现计划")).toBe(true);
});

test("splits single planning transcript into analysis and plan", () => {
  const transcript = `Tool: Grep · markdown
## 分析结果

Need react-markdown.

## 实现计划

1. Install dependency`;

  const { analysis, plan } = extractPlanningDeliverables(transcript);
  expect(analysis).toContain("## 分析结果");
  expect(analysis).not.toContain("## 实现计划");
  expect(plan).toContain("## 实现计划");
  expect(plan).toContain("Install dependency");
});

test("extracts analysis section after exploration noise", () => {
  const transcript = `Tool: Read · App.tsx
Let me explore the repo.

---

## 分析结果

**需求**：支持 Markdown。`;

  const analysis = extractPhaseDeliverable(transcript, "analysis");
  expect(analysis.startsWith("## 分析结果")).toBe(true);
  expect(analysis).not.toContain("Tool: Read");
});

test("strips tool lines from analysis fallback", () => {
  const analysis = extractPhaseDeliverable(
    `Requesting model…
Need to inspect styles.
Tool: Read · App.tsx
Tool: Grep · markdown`,
    "analysis",
  );
  expect(analysis).toContain("Need to inspect styles");
  expect(analysis).not.toContain("Tool: Read");
});
