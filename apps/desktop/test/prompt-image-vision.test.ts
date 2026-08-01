import { describe, expect, test } from "bun:test";
import {
  buildPromptWithVisionAnalysis,
  buildVisionAnalysisRequestBody,
  readVisionAnalysisResponse,
} from "../src/shared/prompt-image-vision";

describe("prompt image vision isolation", () => {
  test("builds a bounded one-shot vision request", () => {
    const body = buildVisionAnalysisRequestBody({
      model: "eco-vision-model",
      prompt: "检查截图中的错误",
      imageCount: 2,
    });

    expect(body.model).toBe("eco-vision-model");
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(1600);
    expect(body.system).toContain("You are the built-in vision subagent");
    expect(body.messages[0]?.content[0]?.text).toContain("There are 2 image(s) in this turn");
    expect(JSON.stringify(body)).not.toContain("base64");
  });

  test("passes only the textual vision report into the main prompt", () => {
    const prompt = buildPromptWithVisionAnalysis({
      prompt: "修复这个界面",
      report: "按钮与标题发生重叠。",
      imageCount: 1,
    });

    expect(prompt).toContain('<vision_analysis image_count="1">');
    expect(prompt).toContain("按钮与标题发生重叠。");
    expect(prompt).not.toContain("builtin-vision-subagent");
    expect(prompt).not.toContain("独立看图子代理");
    expect(prompt).not.toContain("data:image");
  });

  test("extracts text blocks and rejects empty reports", () => {
    expect(
      readVisionAnalysisResponse({
        content: [
          { type: "text", text: "## 总览\n界面截图" },
          { type: "tool_use", id: "ignored" },
          { type: "text", text: "## 不确定项\n无" },
        ],
      }),
    ).toBe("## 总览\n界面截图\n\n## 不确定项\n无");
    expect(() => readVisionAnalysisResponse({ content: [] })).toThrow("did not return a usable text report");
  });
});
