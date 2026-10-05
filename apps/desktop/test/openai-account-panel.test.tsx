import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OpenAIAccountProfileFields,
  OpenAIAccountSwitchStatus,
} from "../src/renderer/components/OpenAIAccountsPanel";

test("account profile editor renders all four fields and masks secrets by default", () => {
  const markup = renderToStaticMarkup(createElement(OpenAIAccountProfileFields, {
    email: "demo@example.test",
    password: "fictional password",
    pickupUrl: "https://pickup.example.test/?key=demo",
    twoFactorSecret: "JBSWY3DPEHPK3PXP",
    instanceKey: "test-account",
    onEmailChange: () => undefined,
    onPasswordChange: () => undefined,
    onPickupUrlChange: () => undefined,
    onTwoFactorSecretChange: () => undefined,
  }));

  expect(markup).toMatch(/type="email"[^>]*value="demo@example\.test"/u);
  expect(markup).toContain('type="url"');
  expect(markup).toContain('value="https://pickup.example.test/?key=demo"');
  expect(markup).toMatch(/type="password"[^>]*value="fictional password"/u);
  expect(markup).toMatch(/type="password"[^>]*value="JBSWY3DPEHPK3PXP"/u);
  expect(markup).toContain('aria-label="显示内容"');
  expect(markup).toContain('aria-label="复制密码"');
  expect(markup).toContain('aria-label="复制2FA 密钥"');
});

test("pending account switch shows the last target and a cancel action", () => {
  const markup = renderToStaticMarkup(createElement(OpenAIAccountSwitchStatus, {
    activeAccountId: "account-current",
    activeAccountName: "当前账号",
    pendingAccountId: "account-target",
    pendingAccountName: "目标账号",
    busy: false,
    onCancel: () => undefined,
  }));

  expect(markup).toContain("待切换：目标账号");
  expect(markup).toContain("取消切换");
  expect(markup).toContain('class="codex-active-summary"');
});

test("credential replacement on the active account has a distinct pending label", () => {
  const markup = renderToStaticMarkup(createElement(OpenAIAccountSwitchStatus, {
    activeAccountId: "account-current",
    activeAccountName: "当前账号",
    pendingAccountId: "account-current",
    pendingAccountName: "当前账号",
    busy: false,
    onCancel: () => undefined,
  }));

  expect(markup).toContain("凭据待应用：当前账号");
  expect(markup).toContain("取消凭据更新");
});
