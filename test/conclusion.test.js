import test from "node:test";
import assert from "node:assert/strict";
import { makeService, TEST_LAW_VERSIONS } from "./support.js";
import { ExitCase } from "../src/domain/exit-case.js";
import { conclusionsEqual } from "../src/domain/conclusion.js";

/** 构造一个走完"简易→异议成立→普通→注销"全流程的案件 */
function buildFullCase(service) {
  service.openCase({ caseId: "C1", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  service.declareClaim("C1", { creditorId: "甲公司", basis: "HT-1", amount: 50000, category: "货款", at: "2024-06-01" });
  service.declareClaim("C1", { creditorId: "甲公司", basis: "HT-1", amount: 50000, category: "货款", at: "2024-06-02" }); // 重复件
  const claimId = service.getCase("C1").claims.list().find((c) => c.counted).id;
  service.withdrawClaim("C1", claimId, "2024-06-02"); // 达成和解后撤回
  service.transition("C1", "审查", { at: "2024-06-02" });
  service.transition("C1", "公告中", { at: "2024-06-03" });
  service.fileObjection("C1", { by: "乙公司", reason: "尚有服务费未结", at: "2024-06-04" });
  const objectionId = service.getCase("C1").objections[0].id;
  service.ruleObjection("C1", objectionId, { upheld: true, at: "2024-06-06", reason: "债权属实" });
  service.record("C1", "liquidation", { kind: "清算报告", detail: "债务已清偿完毕" }, "2024-06-10");
  service.transition("C1", "决定", { at: "2024-06-13" });
  service.transition("C1", "已退出", { at: "2024-06-14" });
  return "C1";
}

test("退出结论可从全部事件重新构建", () => {
  const service = makeService();
  buildFullCase(service);
  const result = service.verifyConclusion("C1");
  assert.equal(result.consistent, true);
});

test("结论内容覆盖法律基准、公告、债权、异议、通知与清算证据", () => {
  const service = makeService();
  buildFullCase(service);
  const conclusion = service.conclusion("C1");

  assert.equal(conclusion.outcome, "已退出");
  assert.equal(conclusion.procedure, "主动注销");
  assert.equal(conclusion.legalBasis.lawVersionId, "test-v1");
  assert.equal(conclusion.legalBasis.entityType, "有限责任公司");

  assert.equal(conclusion.announcements.length, 2);
  assert.equal(conclusion.announcements[0].kind, "simplified");
  assert.equal(conclusion.announcements[0].status, "已终止");
  assert.equal(conclusion.announcements[1].kind, "ordinary");
  assert.equal(conclusion.announcements[1].status, "已完成");
  assert.equal(conclusion.announcements[1].completedAt, "2024-06-13");

  assert.equal(conclusion.claims.declared, 2);
  assert.equal(conclusion.claims.duplicates, 1);
  assert.equal(conclusion.claims.outstandingTotal, 0);

  assert.equal(conclusion.objections.length, 1);
  assert.equal(conclusion.objections[0].ruling, "成立");

  const noticeKinds = conclusion.notices.map((n) => n.kind);
  for (const kind of ["受理通知", "公告通知", "程序转换通知", "决定通知", "注销通知"]) {
    assert.ok(noticeKinds.includes(kind), `缺少通知: ${kind}`);
  }

  assert.equal(conclusion.liquidationEvidence.length, 1);
  assert.equal(conclusion.liquidationEvidence[0].kind, "清算报告");

  assert.ok(conclusion.procedurePath.some((t) => t.to.procedure === "主动注销"));
  assert.equal(conclusion.decision.decidedAt, "2024-06-13");
  assert.equal(conclusion.decision.exitedAt, "2024-06-14");
});

test("事件被篡改时重建结论与案卷结论不一致", () => {
  const service = makeService();
  buildFullCase(service);
  const exitCase = service.getCase("C1");

  // 抽走清算证据
  const withoutLiquidation = exitCase.exportEvents().filter((e) => e.category !== "liquidation");
  const rebuilt = ExitCase.replay(exitCase.meta, withoutLiquidation, {
    lawVersions: TEST_LAW_VERSIONS,
    holidays: new Set(),
  });
  assert.equal(conclusionsEqual(exitCase.conclusion(), rebuilt.conclusion()), false);
  assert.equal(rebuilt.conclusion().liquidationEvidence.length, 0);

  // 改动债权金额
  const tampered = exitCase.exportEvents().map((e) =>
    e.category === "claim" && e.action === "declare" && e.amount === 50000 ? { ...e, amount: 99000 } : e);
  const rebuilt2 = ExitCase.replay(exitCase.meta, tampered, {
    lawVersions: TEST_LAW_VERSIONS,
    holidays: new Set(),
  });
  assert.equal(conclusionsEqual(exitCase.conclusion(), rebuilt2.conclusion()), false);
});

test("法律版本漂移时拒绝重建", () => {
  const service = makeService();
  buildFullCase(service);
  const exitCase = service.getCase("C1");
  // 让 v2 提前生效, 使同一申请日解析出不同版本
  const shiftedVersions = TEST_LAW_VERSIONS.map((v) =>
    v.id === "test-v2" ? { ...v, effectiveFrom: "2024-01-01" } : v);
  assert.throws(
    () => ExitCase.replay(exitCase.meta, exitCase.exportEvents(), { lawVersions: shiftedVersions, holidays: new Set() }),
    /法律版本漂移/,
  );
});
