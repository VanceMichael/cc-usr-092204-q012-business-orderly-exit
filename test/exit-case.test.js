import test from "node:test";
import assert from "node:assert/strict";
import { computeAnnouncement } from "../src/domain/announcement.js";
import { projectEvents, ROLE } from "../src/domain/access.js";
import {
  applyEvent,
  deriveConclusion,
  evaluateTransfer,
  openCase,
  rebuildConclusion,
  replay,
  sortEvents,
} from "../src/domain/case.js";
import { buildNotices } from "../src/domain/notice.js";

let seq = 0;
function ev(type, occurredAt, payload = {}, extra = {}) {
  seq += 1;
  return { id: `e${seq}`, type, occurredAt, ...extra, payload };
}

function openSimplified(appliedAt, overrides = {}) {
  return openCase(
    ev("application", appliedAt, {
      caseId: "C-1",
      entityType: "有限责任公司",
      path: "simplified",
      ...overrides,
    }),
  );
}

// 1. 主体类型与适用法律按申请时版本快照
test("适用法律按申请时版本快照，后续修法不回溯", () => {
  const before = openSimplified("2024-06-30");
  assert.equal(before.lawVersion, "2021-规");
  const after = openSimplified("2024-07-01");
  assert.equal(after.lawVersion, "2024-规");

  // 2024-06-01 立案（旧法 45 天），公告发布时新法已生效，仍按旧法
  let state = openSimplified("2024-06-01");
  state = applyEvent(state, ev("application_accepted", "2024-06-05"));
  state = applyEvent(state, ev("announcement_published", "2024-08-03", { startDate: "2024-08-05" }));
  assert.equal(state.announcement.days, 45);
  assert.equal(state.lawVersion, "2021-规");
});

// 2. 公告期：补正、诉讼保全中止，跨节假日顺延
test("公告期基础时长与周末顺延", () => {
  // 2026-03-02 周一 + 20 天 = 2026-03-22 周日 → 顺延至周一 03-23
  const a = computeAnnouncement({ start: "2026-03-02", days: 20 });
  assert.deepEqual(a, {
    start: "2026-03-02",
    days: 20,
    end: "2026-03-23",
    suspendedDays: 0,
    holidayShiftDays: 1,
  });
});

test("补正期间中止公告期", () => {
  // 03-02 + 20 = 03-22；补正 03-10 → 03-15 中止 5 天 → 03-27 周五
  const a = computeAnnouncement({
    start: "2026-03-02",
    days: 20,
    suspensions: [{ reason: "correction", from: "2026-03-10", to: "2026-03-15" }],
  });
  assert.equal(a.end, "2026-03-27");
  assert.equal(a.suspendedDays, 5);
});

test("诉讼保全中止并与节假日顺延叠加", () => {
  // 03-05 + 20 = 03-25 周三；保全 03-10 → 03-13 中止 3 天 → 03-28 周六 → 顺延至 03-30 周一
  const a = computeAnnouncement({
    start: "2026-03-05",
    days: 20,
    suspensions: [{ reason: "preservation", from: "2026-03-10", to: "2026-03-13" }],
  });
  assert.equal(a.end, "2026-03-30");
  assert.equal(a.suspendedDays, 3);
  assert.equal(a.holidayShiftDays, 2);
});

test("届满日落在法定节假日顺延至下一工作日", () => {
  const a = computeAnnouncement({
    start: "2026-03-02",
    days: 20,
    holidays: ["2026-03-23"],
  });
  assert.equal(a.end, "2026-03-24");
  assert.equal(a.holidayShiftDays, 2);
});

test("案件时间线中的补正与保全正确暂停公告期", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("application_accepted", "2026-03-02"));
  state = applyEvent(state, ev("announcement_published", "2026-03-02", { startDate: "2026-03-02" }));
  assert.equal(state.announcement.end, "2026-03-23"); // 20 天，跨周日顺延
  state = applyEvent(state, ev("correction_requested", "2026-03-10"));
  assert.equal(state.pause.reason, "correction");
  state = applyEvent(state, ev("correction_completed", "2026-03-15"));
  assert.equal(state.pause, null);
  assert.equal(state.announcement.end, "2026-03-27");
  state = applyEvent(state, ev("judicial_restriction", "2026-03-20", { kind: "preservation" }));
  state = applyEvent(state, ev("judicial_restriction_lifted", "2026-03-22"));
  assert.equal(state.announcement.end, "2026-03-30"); // 再中止 2 天，落周一
});

// 3. 部门回执可迟到但不能倒退案件
test("迟到回执只补充事实并标记，不倒退状态", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("application_accepted", "2026-03-02"));
  state = applyEvent(state, ev("announcement_published", "2026-03-03", { startDate: "2026-03-03" }));
  state = applyEvent(state, ev("announcement_closed", "2026-03-25"));
  assert.equal(state.status, "deciding");

  state = applyEvent(
    state,
    ev(
      "department_receipt",
      "2026-03-10", // 事实发生早于当前状态生效时间
      { department: "税务", matter: "清税证明", facts: { type: "tax_social_status", taxArrears: false } },
      { recordedAt: "2026-03-26" },
    ),
  );
  assert.equal(state.status, "deciding");
  assert.equal(state.receipts[0].late, true);
  assert.ok(state.flags.some((f) => f.code === "LATE_RECEIPT_AFTER_DECISION_STAGE"));
});

test("乱序事件触发倒退时被拦截并记录", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("application_accepted", "2026-03-02"));
  state = applyEvent(state, ev("announcement_published", "2026-03-03", { startDate: "2026-03-03" }));
  state = applyEvent(state, ev("application_accepted", "2026-03-04")); // 迟到重复
  assert.equal(state.status, "announcing");
  assert.ok(state.flags.some((f) => f.code === "REGRESSION_BLOCKED"));
});

// 4. 重复债权不得多占金额
test("同一债权人同一债权依据重复申报只计一次", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("claim_filed", "2026-03-05", { claimId: "cl-1", creditorId: "emp-1", basis: "工资单-2025-12", amount: 50000 }));
  state = applyEvent(state, ev("claim_filed", "2026-03-06", { claimId: "cl-2", creditorId: "emp-1", basis: "工资单-2025-12", amount: 50000 }));
  state = applyEvent(state, ev("claim_filed", "2026-03-07", { claimId: "cl-3", creditorId: "emp-1", basis: "经济补偿-2026", amount: 20000 }));
  const conclusion = deriveConclusion(state);
  assert.equal(conclusion.claims.recognized.length, 2);
  assert.equal(conclusion.claims.recognizedTotal, 70000);
  assert.equal(conclusion.claims.duplicatesRejected, 1);
});

// 5. 敏感举报仅向经办角色开放
test("敏感举报仅经办可见", () => {
  const events = [
    ev("application", "2026-03-01", { caseId: "C-1", entityType: "有限责任公司", path: "voluntary" }),
    ev("sensitive_report", "2026-03-05", { content: "涉嫌抽逃出资" }),
    ev("claim_filed", "2026-03-06", { claimId: "cl-1", creditorId: "b-1", basis: "合同-9", amount: 1000 }),
  ];
  for (const role of [ROLE.APPLICANT, ROLE.INTERESTED_PARTY, ROLE.AUDITOR]) {
    assert.ok(projectEvents(events, role).every((e) => e.type !== "sensitive_report"));
  }
  assert.equal(projectEvents(events, ROLE.HANDLER).length, 3);
});

// 6. 申请人与利害关系人获得一致的期限与理由
test("两类受众的通知期限与理由一致", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("application_accepted", "2026-03-02"));
  state = applyEvent(state, ev("announcement_published", "2026-03-03", { startDate: "2026-03-03" }));
  state = applyEvent(state, ev("objection_filed", "2026-03-10", { objectionId: "ob-1", by: "cred-1" }));
  state = applyEvent(state, ev("objection_resolved", "2026-03-15", { objectionId: "ob-1", outcome: "sustained" }));
  const [applicant, interested] = buildNotices(state);
  assert.equal(applicant.audience, "applicant");
  assert.equal(interested.audience, "interested_party");
  const { audience: _a, ...restA } = applicant;
  const { audience: _b, ...restB } = interested;
  assert.deepEqual(restA, restB);
  assert.equal(applicant.deadline, state.announcement.end);
  assert.deepEqual(applicant.reasons, ["SUSTAINED_OBJECTION"]);
});

// 7. 程序路径之间的转移条件
test("主动注销转简易退出需无未结债权、无欠税欠保、无法院限制、类型适格", () => {
  let state = openCase(ev("application", "2026-03-01", { caseId: "C-2", entityType: "有限责任公司", path: "voluntary" }));
  state = applyEvent(state, ev("claim_filed", "2026-03-02", { claimId: "cl-1", creditorId: "b-1", basis: "合同-1", amount: 8000 }));
  let verdict = evaluateTransfer(state, "simplified", "2026-03-03");
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons.map((r) => r.code), ["OUTSTANDING_CLAIMS"]);

  state = applyEvent(state, ev("claim_withdrawn", "2026-03-04", { claimId: "cl-1" }));
  verdict = evaluateTransfer(state, "simplified", "2026-03-05");
  assert.equal(verdict.ok, true);

  state = applyEvent(state, ev("path_transfer", "2026-03-05", { to: "simplified" }));
  assert.equal(state.path, "simplified");
});

test("主体类型不适格时拒绝转入简易退出", () => {
  // 2021-规 下农民专业合作社不在简易退出适格范围
  const state = openCase(ev("application", "2024-05-01", { caseId: "C-3", entityType: "农民专业合作社", path: "voluntary" }));
  const verdict = evaluateTransfer(state, "simplified", "2024-05-02");
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some((r) => r.code === "INELIGIBLE_ENTITY_TYPE"));
});

test("强制退出需地址失联、长期未年报且无经营迹象", () => {
  let state = openSimplified("2026-01-05");
  let verdict = evaluateTransfer(state, "forced", "2026-06-01");
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some((r) => r.code === "ADDRESS_REACHABLE"));

  state = applyEvent(state, ev("contact_attempt", "2026-02-01", { channel: "registered_address", result: "unreachable" }));
  state = applyEvent(state, ev("annual_report", "2023-06-30", { year: "2022" }));
  verdict = evaluateTransfer(state, "forced", "2026-06-01");
  assert.equal(verdict.ok, true);

  state = applyEvent(state, ev("annual_report", "2025-06-30", { year: "2024" }));
  verdict = evaluateTransfer(state, "forced", "2026-06-01");
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some((r) => r.code === "RECENT_ANNUAL_REPORT"));
});

test("歇业与恢复：受理前可歇业，公告后不可，歇业可恢复", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("application_accepted", "2026-03-02"));
  state = applyEvent(state, ev("dormancy_started", "2026-03-03"));
  assert.equal(state.status, "dormant");
  state = applyEvent(state, ev("resumption_requested", "2026-05-01"));
  assert.equal(state.status, "terminated");
  assert.equal(state.outcome, "resumed");

  let late = openSimplified("2026-03-01");
  late = applyEvent(late, ev("application_accepted", "2026-03-02"));
  late = applyEvent(late, ev("announcement_published", "2026-03-03", { startDate: "2026-03-03" }));
  const verdict = evaluateTransfer(late, "dormancy", "2026-03-04");
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons.map((r) => r.code), ["TOO_LATE_FOR_DORMANCY"]);
});

// 8. 退出决定的程序守卫
test("公告期未届满、存在未决异议或案件暂停时不得作出退出决定", () => {
  let state = openSimplified("2026-03-01");
  state = applyEvent(state, ev("application_accepted", "2026-03-02"));
  state = applyEvent(state, ev("announcement_published", "2026-03-03", { startDate: "2026-03-03" }));
  state = applyEvent(state, ev("decision", "2026-03-10", { outcome: "exited" }));
  assert.equal(state.status, "announcing");
  assert.ok(state.flags.some((f) => f.code === "DECISION_BLOCKED" && f.reasons.some((r) => r.code === "ANNOUNCEMENT_NOT_ENDED")));

  state = applyEvent(state, ev("objection_filed", "2026-03-11", { objectionId: "ob-1", by: "cred-1" }));
  state = applyEvent(state, ev("decision", "2026-03-30", { outcome: "exited" }));
  assert.equal(state.status, "announcing");
  assert.ok(state.flags.some((f) => f.code === "DECISION_BLOCKED" && f.reasons.some((r) => r.code === "OPEN_OBJECTIONS")));

  state = applyEvent(state, ev("objection_resolved", "2026-03-31", { objectionId: "ob-1", outcome: "overruled" }));
  state = applyEvent(state, ev("decision", "2026-04-01", { outcome: "exited" }));
  assert.equal(state.status, "exited");
  assert.equal(state.outcome, "exited");
});

// 9. 退出结论可从全部事件重新构建
test("结论由事件流重放重建，与增量维护一致且与事件顺序无关", () => {
  const events = [
    ev("application", "2026-03-02", { caseId: "C-9", entityType: "有限责任公司", path: "simplified" }),
    ev("application_accepted", "2026-03-03"),
    ev("announcement_published", "2026-03-04", { startDate: "2026-03-04" }),
    ev("correction_requested", "2026-03-10"),
    ev("correction_completed", "2026-03-13"),
    ev("claim_filed", "2026-03-11", { claimId: "cl-1", creditorId: "emp-1", basis: "工资单-001", amount: 50000 }),
    ev("claim_filed", "2026-03-12", { claimId: "cl-2", creditorId: "emp-1", basis: "工资单-001", amount: 50000 }),
    ev("claim_withdrawn", "2026-03-24", { claimId: "cl-1" }),
    ev("objection_filed", "2026-03-15", { objectionId: "ob-1", by: "emp-1" }),
    ev("objection_resolved", "2026-03-20", { objectionId: "ob-1", outcome: "overruled" }),
    ev("liquidation_evidence", "2026-03-25", { docId: "liq-1", kind: "清算报告", settledAmount: 50000 }),
    ev("notice_issued", "2026-03-05", { audience: "applicant", deadline: "2026-03-27", reasons: [] }),
    ev("notice_issued", "2026-03-05", { audience: "interested_party", deadline: "2026-03-27", reasons: [] }),
    ev("department_receipt", "2026-03-18", { department: "税务", matter: "清税证明" }, { recordedAt: "2026-03-26" }),
    ev("decision", "2026-03-30", { outcome: "exited" }),
  ];

  // 增量维护（按时间线顺序）
  const sorted = sortEvents(events);
  let state = openCase(sorted[0]);
  for (const event of sorted.slice(1)) state = applyEvent(state, event);
  const incremental = deriveConclusion(state);

  // 重放重建（打乱顺序）
  const shuffled = [...events].reverse();
  const rebuilt = rebuildConclusion(shuffled);

  assert.deepEqual(rebuilt, incremental);
  assert.equal(rebuilt.status, "exited");
  assert.equal(rebuilt.announcement.end, "2026-03-27"); // 补正中止 3 天
  assert.equal(rebuilt.claims.recognizedTotal, 0); // 唯一登记债权已撤回
  assert.equal(rebuilt.claims.duplicatesRejected, 1);
  assert.equal(rebuilt.objections.overruled, 1);
  assert.equal(rebuilt.evidence.length, 1);
  assert.equal(rebuilt.notices.length, 2);
});

test("缺少 application 事件无法重建", () => {
  assert.throws(() => replay([ev("claim_filed", "2026-03-01", {})]), /application/);
});
