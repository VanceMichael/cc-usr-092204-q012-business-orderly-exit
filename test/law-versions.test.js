import test from "node:test";
import assert from "node:assert/strict";
import { LAW_VERSIONS, resolveLawVersion } from "../src/domain/law-versions.js";
import { makeService } from "./support.js";

test("按申请日解析适用法律版本", () => {
  assert.equal(resolveLawVersion("2022-03-01").id, "exit-rules-2022");
  assert.equal(resolveLawVersion("2024-06-30").id, "exit-rules-2022");
  assert.equal(resolveLawVersion("2024-07-01").id, "exit-rules-2024");
  assert.throws(() => resolveLawVersion("2020-01-01"), /没有有效的适用法律版本/);
});

test("案件锁定申请时版本, 后续修订不影响在办案件", () => {
  const service = makeService();
  // v1 简易公告 5 天; v2 简易公告 3 天
  service.openCase({ caseId: "C-OLD", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  service.openCase({ caseId: "C-NEW", entityType: "company", procedure: "简易退出", appliedAt: "2026-01-05", applicant: "李某" });

  assert.equal(service.getCase("C-OLD").meta.lawVersionId, "test-v1");
  assert.equal(service.getCase("C-NEW").meta.lawVersionId, "test-v2");

  service.transition("C-OLD", "审查", { at: "2024-06-02" });
  service.transition("C-OLD", "公告中", { at: "2024-06-03" });
  service.transition("C-NEW", "审查", { at: "2026-01-06" });
  service.transition("C-NEW", "公告中", { at: "2026-01-07" });

  const oldDeadlines = service.view("C-OLD", "申请人", "2024-06-04").deadlines;
  const newDeadlines = service.view("C-NEW", "申请人", "2026-01-08").deadlines;
  assert.equal(oldDeadlines.requiredDays, 5);
  assert.equal(oldDeadlines.deadline, "2024-06-08");
  assert.equal(newDeadlines.requiredDays, 3);
  assert.equal(newDeadlines.deadline, "2026-01-10");
});

test("主体类型按申请时版本确定", () => {
  const service = makeService();
  service.openCase({ caseId: "C-IND-OLD", entityType: "individual", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  service.openCase({ caseId: "C-IND-NEW", entityType: "individual", procedure: "简易退出", appliedAt: "2026-01-05", applicant: "李某" });
  assert.equal(service.view("C-IND-OLD", "申请人", "2024-06-01").entityType, "个体工商业户");
  assert.equal(service.view("C-IND-NEW", "申请人", "2026-01-05").entityType, "个体工商户");
});

test("主体类型不适用的程序不得立案", () => {
  const service = makeService();
  assert.throws(
    () => service.openCase({ caseId: "C-X", entityType: "individual", procedure: "强制退出", appliedAt: "2024-06-01", applicant: "张某" }),
    /不适用强制退出程序/,
  );
});
