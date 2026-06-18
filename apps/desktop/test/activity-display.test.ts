import { expect, test } from "bun:test";
import {
  parseBashApprovalActivityText,
  readBashApprovalMetadata,
} from "../src/shared/activity-display";

test("parseBashApprovalActivityText parses filesystem approval messages", () => {
  expect(parseBashApprovalActivityText("等待确认 Grep：/outside/file.txt")).toEqual({
    toolName: "Grep",
    detail: "/outside/file.txt",
    phase: "approval-pending",
  });
  expect(parseBashApprovalActivityText("已允许本次 Read：/etc/hosts")).toEqual({
    toolName: "Read",
    detail: "/etc/hosts",
    phase: "approval-approved",
  });
  expect(parseBashApprovalActivityText("已拒绝 Bash：rm -rf /")).toEqual({
    toolName: "Bash",
    detail: "rm -rf /",
    phase: "approval-rejected",
  });
  expect(parseBashApprovalActivityText("Bash 已拒绝：policy blocked")).toEqual({
    toolName: "Bash",
    detail: "policy blocked",
    phase: "approval-rejected",
  });
});

test("readBashApprovalMetadata reads structured projection metadata", () => {
  expect(
    readBashApprovalMetadata({
      liveType: "bash_approval.approved",
      bashApproval: {
        toolUseId: "toolu_1",
        phase: "approved",
        toolName: "Grep",
        detail: "/tmp/file.txt",
      },
    }),
  ).toEqual({
    toolUseId: "toolu_1",
    phase: "approved",
    toolName: "Grep",
    detail: "/tmp/file.txt",
  });
});
