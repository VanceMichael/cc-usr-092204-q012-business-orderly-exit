import test from "node:test";
import assert from "node:assert/strict";
import { makeService, openSimplifiedAnnouncing } from "./support.js";

test("敏感举报仅经办角色可见", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.record("C1", "report", { content: "疑似抽逃出资", sensitive: true }, "2024-06-04");

  for (const role of ["申请人", "利害关系人", "审计人员"]) {
    const view = service.view("C1", role, "2024-06-05");
    assert.equal(view.timeline.filter((e) => e.category === "report").length, 0, `${role}不应看到敏感举报`);
  }
  const handlerView = service.view("C1", "经办人", "2024-06-05");
  assert.equal(handlerView.timeline.filter((e) => e.category === "report").length, 1);
});

test("非敏感举报对所有角色可见", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.record("C1", "report", { content: "公开渠道已披露的问题", sensitive: false }, "2024-06-04");
  const view = service.view("C1", "利害关系人", "2024-06-05");
  assert.equal(view.timeline.filter((e) => e.category === "report").length, 1);
});

test("各角色获得的期限与理由一致", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.pauseAnnouncement("C1", { reason: "补正", from: "2024-06-04", to: "2024-06-06" });
  service.record("C1", "report", { content: "敏感线索", sensitive: true }, "2024-06-05");

  const applicant = service.view("C1", "申请人", "2024-06-07");
  const interested = service.view("C1", "利害关系人", "2024-06-07");
  const handler = service.view("C1", "经办人", "2024-06-07");

  assert.deepEqual(applicant.deadlines, handler.deadlines);
  assert.deepEqual(interested.deadlines, handler.deadlines);
  assert.deepEqual(applicant.reasons, handler.reasons);
  assert.deepEqual(interested.reasons, handler.reasons);
  assert.equal(applicant.deadlines.deadline, "2024-06-11"); // 补正 3 天顺延
  assert.deepEqual(applicant.reasons, ["公告期未届满"]);
});

test("未知角色被拒绝", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  assert.throws(() => service.view("C1", "路人", "2024-06-05"), /未知角色/);
});
