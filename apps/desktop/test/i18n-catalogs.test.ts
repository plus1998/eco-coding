import { expect, test } from "bun:test";
import {
  expectedIpcErrorKey,
  i18nCatalogs,
  translateCatalog,
} from "../src/shared/i18n-catalogs";

test("desktop catalogs expose the same keys in both supported languages", () => {
  const chineseKeys = Object.keys(i18nCatalogs["zh-CN"].translation).sort();
  const englishKeys = Object.keys(i18nCatalogs["en-US"].translation).sort();
  expect(chineseKeys).toEqual(englishKeys);
});

test("catalog translation interpolates variables without changing raw detail", () => {
  const detail = "git push origin feature/raw-output";
  expect(translateCatalog("en-US", "notification.bashApproval", { detail })).toBe(
    `Waiting for action approval: ${detail}`,
  );
  expect(translateCatalog("zh-CN", "notification.bashApproval", { detail })).toContain(detail);
});

test("known application IPC errors localize without raw Chinese in en-US", () => {
  const messages = [
    "子代理模板名称不能为空。",
    "导入文件没有包含智能体配置。",
    "内置子代理模板不可直接修改，请先复制为用户模板。",
    "没有可提交的变更。",
    "模型未能生成有效的提交信息，请手动填写。",
    "未指定 Git 提交模型，无法生成提交信息。请在提交窗口中选择生成模型。",
    "Git 提交模型已不在候选模型列表中：candidate-1",
    "排队的后续消息缺少可发送内容。",
    "该节点缺少 SDK 检查点，无法安全回滚。",
  ];

  for (const message of messages) {
    const key = expectedIpcErrorKey(message);
    expect(key).toBeDefined();
    expect(translateCatalog("en-US", key!)).not.toMatch(/[\u3400-\u9fff]/);
  }
});

test("ACP follow-up IPC errors localize without raw Chinese in en-US", () => {
  const messages = [
    "Cursor ACP 暂不支持带图后续消息。",
    "Cursor ACP 不支持中断当前轮次插入后续消息；消息会在本轮结束后发送。",
  ];
  for (const message of messages) {
    const key = expectedIpcErrorKey(message);
    expect(key).toBeDefined();
    expect(translateCatalog("en-US", key!)).not.toMatch(/[\u3400-\u9fff]/);
  }
});

test("external Git, SDK, provider, runtime, prompt, protocol, and history details remain verbatim", () => {
  const unmatched = [
    "fatal: 无法访问远程仓库",
    "SDK 响应不是合法 JSON",
    "Provider API key is required.",
    "Runtime driver crashed: 上游超时",
    "User prompt: 子代理模板名称不能为空。",
    "JSON-RPC error: 配置 JSON 必须是对象。",
    "History entry says: 没有可提交的变更。",
  ];

  for (const message of unmatched) {
    expect(expectedIpcErrorKey(message)).toBeUndefined();
  }
});
