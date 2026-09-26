import { deadline } from "./announcement.js";

/**
 * 退出结论构建。
 *
 * 结论是全部时间线事件的纯函数: 通知、异议、债权、清算证据、
 * 公告与回执共同决定结论内容, 不依赖任何案卷外状态。
 * 因此回放事件流(ExitCase.replay)即可重新构建同一份结论,
 * 供审计人员复核"结论可由证据重建"。
 */
export function buildConclusion(exitCase) {
  const transitions = exitCase.timeline.filter((e) => e.category === "transition");
  const decisionAt = [...transitions].reverse().find((t) => t.to?.stage === "决定")?.at ?? null;
  const exitedAt = [...transitions].reverse().find((t) => t.to?.stage === "已退出")?.at ?? null;

  return {
    caseId: exitCase.meta.caseId,
    outcome: exitCase.stage,
    procedure: exitCase.procedure,
    legalBasis: {
      lawVersionId: exitCase.meta.lawVersionId,
      lawTitle: exitCase.law.title,
      entityType: exitCase.meta.entityTypeLabel,
    },
    procedurePath: transitions.map((t) => ({ from: t.from, to: t.to, at: t.at, cause: t.cause ?? null })),
    announcements: exitCase.announcements.map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      startDate: a.startDate,
      requiredDays: a.requiredDays,
      pauses: a.pauses.map((p) => ({ ...p })),
      deadline: deadline(a, exitCase.holidays),
      completedAt: a.completedAt,
    })),
    claims: exitCase.claims.summary(),
    claimItems: exitCase.claims.list().map((c) => ({
      id: c.id,
      creditorId: c.creditorId,
      basis: c.basis,
      amount: c.amount,
      status: c.status,
      counted: c.counted,
      duplicateOf: c.duplicateOf,
    })),
    objections: exitCase.objections.map((o) => ({
      id: o.id,
      by: o.by,
      reason: o.reason,
      ruling: o.ruling,
      rulingAt: o.rulingAt,
    })),
    notices: exitCase.timeline
      .filter((e) => e.category === "notice")
      .map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
    liquidationEvidence: exitCase.timeline
      .filter((e) => e.category === "liquidation")
      .map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
    receipts: exitCase.receipts.map((r) => ({
      id: r.id,
      department: r.department,
      stage: r.stage,
      late: r.late,
      receivedAt: r.receivedAt,
    })),
    decision: { decidedAt: decisionAt, exitedAt },
  };
}

/** 结论一致性比较: 结论由同一代码路径产出, 键序稳定, 可直接序列化比较 */
export function conclusionsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
