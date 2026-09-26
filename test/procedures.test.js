import test from "node:test";
import assert from "node:assert/strict";
import { makeService, openSimplifiedAnnouncing } from "./support.js";
import { TransitionError } from "../src/service.js";

test("简易退出: 未了结债权阻断公告启动", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  service.declareClaim("C1", { creditorId: "甲公司", basis: "HT-1", amount: 50000, at: "2024-06-01" });
  service.transition("C1", "审查", { at: "2024-06-02" });
  assert.throws(() => service.transition("C1", "公告中", { at: "2024-06-03" }), (err) => {
    assert.ok(err instanceof TransitionError);
    assert.match(err.message, /未了结债权/);
    return true;
  });
});

test("简易退出: 欠税欠薪阻断公告启动", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  service.record("C1", "taxSocial", { taxArrears: 3200 }, "2024-06-01");
  service.transition("C1", "审查", { at: "2024-06-02" });
  assert.throws(() => service.transition("C1", "公告中", { at: "2024-06-03" }), /欠税或欠薪/);
});

test("简易退出全流程: 公告届满后方可决定, 决定后注销", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");

  const view = service.view("C1", "申请人", "2024-06-05");
  assert.equal(view.deadlines.deadline, "2024-06-08");
  assert.deepEqual(view.reasons, ["公告期未届满"]);

  assert.throws(() => service.transition("C1", "决定", { at: "2024-06-07" }), /公告期未届满/);
  service.transition("C1", "决定", { at: "2024-06-08" });
  service.transition("C1", "已退出", { at: "2024-06-09" });

  const conclusion = service.conclusion("C1");
  assert.equal(conclusion.outcome, "已退出");
  assert.equal(conclusion.decision.decidedAt, "2024-06-08");
  assert.equal(conclusion.decision.exitedAt, "2024-06-09");
});

test("强制退出: 未年报次数、失联、税务异常缺一不可", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "强制退出", appliedAt: "2024-06-01", applicant: "监管窗口" });
  service.record("C1", "annualReport", { year: 2022, filed: false }, "2024-06-01");
  service.transition("C1", "审查", { at: "2024-06-02" });
  assert.throws(
    () => service.transition("C1", "公告中", { at: "2024-06-03" }),
    /未年报 1 次, 不足 2 次; 未确认登记住所失联; 税务状态未见异常/,
  );

  service.record("C1", "annualReport", { year: 2023, filed: false }, "2024-06-03");
  service.record("C1", "contact", { channel: "信函", result: "失联" }, "2024-06-03");
  service.record("C1", "taxSocial", { taxStatus: "非正常" }, "2024-06-03");
  service.transition("C1", "公告中", { at: "2024-06-04" });
  assert.equal(service.view("C1", "经办人", "2024-06-05").stage, "公告中");
});

test("强制退出: 存在经营迹象不得启动", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "强制退出", appliedAt: "2024-06-01", applicant: "监管窗口" });
  service.record("C1", "annualReport", { year: 2022, filed: false }, "2024-06-01");
  service.record("C1", "annualReport", { year: 2023, filed: false }, "2024-06-01");
  service.record("C1", "contact", { channel: "现场", result: "失联" }, "2024-06-01");
  service.record("C1", "taxSocial", { taxStatus: "非正常" }, "2024-06-01");
  service.record("C1", "businessSign", { active: true, detail: "近期有开票记录" }, "2024-06-02");
  service.transition("C1", "审查", { at: "2024-06-02" });
  assert.throws(() => service.transition("C1", "公告中", { at: "2024-06-03" }), /经营迹象/);
});

test("司法限制阻断决定, 解除后放行", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.record("C1", "judicialRestriction", { restrictionId: "JR-1", kind: "股权冻结", active: true }, "2024-06-04");
  assert.throws(() => service.transition("C1", "决定", { at: "2024-06-08" }), /司法限制/);
  service.record("C1", "judicialRestriction", { restrictionId: "JR-1", kind: "股权冻结", active: false }, "2024-06-09");
  service.transition("C1", "决定", { at: "2024-06-09" });
  assert.equal(service.view("C1", "申请人", "2024-06-09").stage, "决定");
});

test("歇业: 备案、恢复经营", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "歇业", appliedAt: "2024-06-01", applicant: "王某" });
  service.transition("C1", "歇业中", { at: "2024-06-02" });
  service.transition("C1", "已恢复", { at: "2024-09-01" });
  const view = service.view("C1", "申请人", "2024-09-01");
  assert.equal(view.stage, "已恢复");
  assert.deepEqual(view.reasons, []);
});

test("歇业中转主动注销: 普通程序须补清算报告", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "歇业", appliedAt: "2024-06-01", applicant: "王某" });
  service.transition("C1", "歇业中", { at: "2024-06-02" });
  service.transition("C1", "主动注销", { at: "2024-07-01" });
  assert.equal(service.view("C1", "申请人", "2024-07-01").procedure, "主动注销");

  service.transition("C1", "审查", { at: "2024-07-02" });
  service.transition("C1", "公告中", { at: "2024-07-03" });
  // 普通程序公告 7 天, 届满 2024-07-10; 缺少清算报告不得决定
  assert.throws(() => service.transition("C1", "决定", { at: "2024-07-10" }), /缺少清算报告/);
  service.record("C1", "liquidation", { kind: "清算报告", detail: "全体投资人确认" }, "2024-07-10");
  service.transition("C1", "决定", { at: "2024-07-10" });
  service.transition("C1", "已退出", { at: "2024-07-11" });
  assert.equal(service.conclusion("C1").outcome, "已退出");
});

test("简易退出被异议: 异议成立转普通程序并重新公告", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.fileObjection("C1", { by: "甲公司", reason: "尚有货款未结清", at: "2024-06-04" });
  assert.equal(service.view("C1", "申请人", "2024-06-04").stage, "异议审查");

  const objectionId = service.getCase("C1").objections[0].id;
  service.ruleObjection("C1", objectionId, { upheld: true, at: "2024-06-06", reason: "债权属实" });

  const view = service.view("C1", "申请人", "2024-06-06");
  assert.equal(view.procedure, "主动注销");
  assert.equal(view.stage, "公告中");
  assert.equal(view.deadlines.kind, "ordinary");
  assert.equal(view.deadlines.requiredDays, 7);
  assert.equal(view.deadlines.deadline, "2024-06-13");
});

test("简易退出被异议: 异议不成立恢复公告, 暂停期间不计入", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.fileObjection("C1", { by: "乙公司", reason: "存在纠纷", at: "2024-06-04" });
  const objectionId = service.getCase("C1").objections[0].id;
  service.ruleObjection("C1", objectionId, { upheld: false, at: "2024-06-06", reason: "查无实据" });

  const view = service.view("C1", "申请人", "2024-06-06");
  assert.equal(view.stage, "公告中");
  assert.equal(view.procedure, "简易退出");
  // 06-04~06-06 异议审查暂停, 届满日由 06-08 顺延至 06-11
  assert.equal(view.deadlines.deadline, "2024-06-11");
});

test("强制退出被异议: 异议成立则程序终止", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "强制退出", appliedAt: "2024-06-01", applicant: "监管窗口" });
  service.record("C1", "annualReport", { year: 2022, filed: false }, "2024-06-01");
  service.record("C1", "annualReport", { year: 2023, filed: false }, "2024-06-01");
  service.record("C1", "contact", { channel: "现场", result: "失联" }, "2024-06-01");
  service.record("C1", "taxSocial", { taxStatus: "非正常" }, "2024-06-01");
  service.transition("C1", "审查", { at: "2024-06-02" });
  service.transition("C1", "公告中", { at: "2024-06-03" });

  service.fileObjection("C1", { by: "经营者本人", reason: "企业仍在维系客户, 准备恢复经营", at: "2024-06-05" });
  const objectionId = service.getCase("C1").objections[0].id;
  service.ruleObjection("C1", objectionId, { upheld: true, at: "2024-06-07", reason: "经营者现身, 强制退出依据消失" });
  assert.equal(service.view("C1", "申请人", "2024-06-07").stage, "已终止");
});

test("强制退出中主体现身可转主动注销", () => {
  const service = makeService();
  service.openCase({ caseId: "C1", entityType: "company", procedure: "强制退出", appliedAt: "2024-06-01", applicant: "监管窗口" });
  service.transition("C1", "审查", { at: "2024-06-02" });
  service.transition("C1", "主动注销", { at: "2024-06-03", by: "经营者本人" });
  const view = service.view("C1", "申请人", "2024-06-03");
  assert.equal(view.procedure, "主动注销");
  assert.equal(view.stage, "受理");
});

test("诉讼保全登记自动暂停公告计时, 解除后恢复", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1"); // 公告 2024-06-03 发布, 原届满 2024-06-08

  service.record("C1", "judicialRestriction", { restrictionId: "CP-1", kind: "诉讼保全", active: true }, "2024-06-04");
  let view = service.view("C1", "申请人", "2024-06-05");
  assert.equal(view.deadlines.paused, true);
  assert.equal(view.deadlines.deadline, null); // 暂停未结束, 期限待定

  service.record("C1", "judicialRestriction", { restrictionId: "CP-1", kind: "诉讼保全", active: false }, "2024-06-07");
  view = service.view("C1", "申请人", "2024-06-07");
  assert.equal(view.deadlines.paused, false);
  // 06-04~06-07 暂停, 计入日为 06-08~06-12
  assert.equal(view.deadlines.deadline, "2024-06-12");
  service.transition("C1", "决定", { at: "2024-06-12" });
  assert.equal(service.view("C1", "申请人", "2024-06-12").stage, "决定");
});

test("终结案件不得再转移", () => {
  const service = makeService();
  openSimplifiedAnnouncing(service, "C1");
  service.transition("C1", "决定", { at: "2024-06-08" });
  service.transition("C1", "已退出", { at: "2024-06-09" });
  assert.throws(() => service.transition("C1", "已终止", { at: "2024-06-10" }), /已终结/);
});
