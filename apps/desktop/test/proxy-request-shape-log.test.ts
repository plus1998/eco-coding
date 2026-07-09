import { expect, test } from "bun:test";
import { summarizeJsonBodyShape } from "../src/main/proxy-request-shape-log";

test("summarizeJsonBodyShape records sizes without raw message text", () => {
  const summary = summarizeJsonBodyShape({
    model: "eco-planner",
    max_tokens: 1024,
    system: "SYSTEM SECRET TEXT",
    tools: [{ name: "Read", description: "READ SECRET TEXT" }],
    messages: [
      { role: "user", content: "USER SECRET TEXT" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ASSISTANT SECRET TEXT" },
          { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/tmp/a" } },
        ],
      },
    ],
  });

  const serialized = JSON.stringify(summary);
  expect(summary.messageCount).toBe(2);
  expect(summary.system?.chars).toBe("SYSTEM SECRET TEXT".length);
  expect(summary.tools?.count).toBe(1);
  expect(summary.tools?.names).toEqual(["Read"]);
  expect(summary.largestMessages?.[0]?.bytes).toBeGreaterThan(0);
  expect(serialized).not.toContain("USER SECRET TEXT");
  expect(serialized).not.toContain("ASSISTANT SECRET TEXT");
  expect(serialized).not.toContain("SYSTEM SECRET TEXT");
  expect(serialized).not.toContain("READ SECRET TEXT");
});

test("summarizeJsonBodyShape tolerates undefined top-level fields", () => {
  const summary = summarizeJsonBodyShape({
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    temperature: undefined,
  });

  expect(summary.model).toBe("gpt-5.5");
  expect(summary.largestTopLevelFields.find((field) => field.key === "temperature")?.bytes).toBe(0);
});
