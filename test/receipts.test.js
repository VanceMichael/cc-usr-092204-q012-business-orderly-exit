import test from "node:test";
import assert from "node:assert/strict";
import { makeService, openSimplifiedAnnouncing } from "./support.js";

test("迟到回执登记在案但不倒退案件阶段", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1"); // 当前阶段: 公告中

  const receipt = service.applyReceipt("C1", {
    department: "税务部门", stage: "审查", content: "税务清查无异常",
    issuedAt: "2024-06-02", at: "2024-06-05",
  });
  assert.equal(receipt.late, true);
  assert.equal(service.view("C1", "经办人", "2024-06-05").stage, "公告中");
});

test("当前阶段的回执不标记迟到", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  const receipt = service.applyReceipt("C1", {
    department: "社保部门", stage: "公告中", content: "社保无欠费",
    issuedAt: "2024-06-04", at: "2024-06-04",
  });
  assert.equal(receipt.late, false);
});

test("负面回执转为风险标记: 阻断决定但不倒退案件", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");

  service.applyReceipt("C1", {
    department: "税务部门", stage: "审查",
    adverse: { detail: "发现欠税 5000 元" },
    issuedAt: "2024-06-02", at: "2024-06-05",
  });

  // 案件仍在公告中, 未倒退; 但决定被风险标记阻断
  assert.equal(service.view("C1", "经办人", "2024-06-08").stage, "公告中");
  assert.throws(() => service.transition("C1", "决定", { at: "2024-06-08" }), /风险标记/);

  const flagId = service.getCase("C1").riskFlags[0].id;
  service.clearRiskFlag("C1", flagId, "2024-06-09");
  service.transition("C1", "决定", { at: "2024-06-09" });
  assert.equal(service.view("C1", "经办人", "2024-06-09").stage, "决定");
});

test("决定之后收到的回执只登记不改写", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.transition("C1", "决定", { at: "2024-06-08" });

  const receipt = service.applyReceipt("C1", {
    department: "法院", stage: "公告中", content: "无在诉案件",
    issuedAt: "2024-06-06", at: "2024-06-10",
  });
  assert.equal(receipt.late, true);
  assert.equal(service.view("C1", "经办人", "2024-06-10").stage, "决定");
});
