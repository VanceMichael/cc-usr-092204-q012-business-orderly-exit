/**
 * 退出程序状态机。
 *
 * 四类程序: 主动注销(普通程序)、简易退出、强制退出、歇业(含恢复)。
 * 程序间转移条件集中在本文件, 以守卫(_GUARD)形式显式声明;
 * 守卫未满足时返回中文理由, 作为申请人与利害关系人可见的一致理由。
 */

export const PROCEDURES = Object.freeze({
  VOLUNTARY: "主动注销",
  SIMPLIFIED: "简易退出",
  FORCED: "强制退出",
  SUSPENSION: "歇业",
});

export const STAGES = Object.freeze({
  ACCEPTED: "受理",
  REVIEW: "审查",
  ANNOUNCING: "公告中",
  OBJECTION_REVIEW: "异议审查",
  DECIDED: "决定",
  EXITED: "已退出",
  SUSPENDED: "歇业中",
  RESUMED: "已恢复",
  REJECTED: "已驳回",
  TERMINATED: "已终止",
});

export const TERMINAL_STAGES = Object.freeze(new Set(["已退出", "已恢复", "已驳回", "已终止"]));

/** 阶段序号: 部门回执据此判断"迟到", 案件进度只进不退 */
export const STAGE_RANK = Object.freeze({
  受理: 1,
  审查: 2,
  公告中: 3,
  异议审查: 3,
  歇业中: 3,
  决定: 4,
  已退出: 5,
  已恢复: 5,
  已驳回: 5,
  已终止: 5,
});

/**
 * 从时间线事件推导案件事实。
 * 同一事实以最新事件为准(联系记录、经营迹象、税务社保、司法限制)。
 */
export function deriveFacts(events) {
  const facts = {
    missingAnnualReports: 0,
    contactLost: false,
    businessActive: false,
    taxStatus: "正常",
    socialSecurityStatus: "正常",
    taxArrears: 0,
    wageArrears: 0,
    judicialRestrictionActive: false,
    hasLiquidationReport: false,
  };
  const restrictions = new Map();
  for (const e of events) {
    switch (e.category) {
      case "annualReport":
        if (e.filed === false) facts.missingAnnualReports += 1;
        break;
      case "contact":
        facts.contactLost = e.result === "失联";
        break;
      case "businessSign":
        facts.businessActive = Boolean(e.active);
        break;
      case "taxSocial":
        if (e.taxStatus !== undefined) facts.taxStatus = e.taxStatus;
        if (e.socialSecurityStatus !== undefined) facts.socialSecurityStatus = e.socialSecurityStatus;
        if (e.taxArrears !== undefined) facts.taxArrears = e.taxArrears;
        if (e.wageArrears !== undefined) facts.wageArrears = e.wageArrears;
        break;
      case "judicialRestriction":
        restrictions.set(e.restrictionId, e.active !== false);
        break;
      case "liquidation":
        if (e.kind === "清算报告") facts.hasLiquidationReport = true;
        break;
      default:
        break;
    }
  }
  facts.judicialRestrictionActive = [...restrictions.values()].some(Boolean);
  return facts;
}

/**
 * 转移条件守卫。每个守卫返回 null(满足)或理由字符串(不满足)。
 * ctx: { facts, law, outstandingClaims, announcementComplete, pendingObjections, activeRiskFlags }
 */
export const GUARDS = {
  noOutstandingClaims: (c) =>
    c.outstandingClaims > 0 ? `存在未了结债权申报 ${c.outstandingClaims} 件` : null,
  noArrears: (c) =>
    c.facts.taxArrears > 0 || c.facts.wageArrears > 0 ? "存在欠税或欠薪, 须先行清缴" : null,
  noJudicialRestriction: (c) =>
    c.facts.judicialRestrictionActive ? "存在有效的司法限制, 暂不得退出" : null,
  noActiveBusiness: (c) =>
    c.facts.businessActive ? "存在经营迹象, 不符合长期未经营条件" : null,
  noRiskFlags: (c) =>
    c.activeRiskFlags > 0 ? `存在未核销的风险标记 ${c.activeRiskFlags} 项` : null,
  noPendingObjection: (c) => (c.pendingObjections ? "存在未裁定的异议" : null),
  announcementComplete: (c) => (c.announcementComplete ? null : "公告期未届满"),
  liquidationDone: (c) => (c.facts.hasLiquidationReport ? null : "缺少清算报告"),
  forcedEligibility: (c) => {
    const rule = c.law.forcedExit;
    const reasons = [];
    if (c.facts.missingAnnualReports < rule.minMissingAnnualReports) {
      reasons.push(`未年报 ${c.facts.missingAnnualReports} 次, 不足 ${rule.minMissingAnnualReports} 次`);
    }
    if (rule.requireContactLost && !c.facts.contactLost) reasons.push("未确认登记住所失联");
    if (rule.requireTaxAbnormal && c.facts.taxStatus === "正常") reasons.push("税务状态未见异常");
    return reasons.length > 0 ? reasons.join("; ") : null;
  },
};

export function evaluateGuards(names, ctx) {
  return names.map((n) => GUARDS[n](ctx)).filter(Boolean);
}

export class TransitionError extends Error {
  constructor(reasons) {
    super(reasons.join("; "));
    this.name = "TransitionError";
    this.reasons = reasons;
  }
}

/**
 * 评估程序/阶段转移。
 * state: { procedure, stage, ...guardCtx }
 * 返回 { ok, reasons, to, effects } —— effects 由聚合根落地为事件。
 */
export function evaluateTransition(state, target) {
  const { procedure, stage } = state;
  const fail = (reasons) => ({ ok: false, reasons, to: null, effects: [] });
  const pass = (to, effects = []) => ({ ok: true, reasons: [], to, effects });

  if (TERMINAL_STAGES.has(stage)) return fail([`案件已终结(${stage}), 不可再转移`]);

  switch (target) {
    case "审查":
      if (stage !== "受理") return fail([`仅受理阶段可进入审查, 当前为${stage}`]);
      return pass({ procedure, stage: "审查" });

    case "公告中": {
      if (stage !== "审查") return fail([`仅审查阶段可启动公告, 当前为${stage}`]);
      if (procedure === "歇业") return fail(["歇业程序无公告环节"]);
      const guards =
        procedure === "简易退出"
          ? ["noOutstandingClaims", "noArrears", "noJudicialRestriction"]
          : procedure === "强制退出"
            ? ["forcedEligibility", "noActiveBusiness", "noArrears", "noOutstandingClaims", "noJudicialRestriction"]
            : ["noJudicialRestriction"];
      const reasons = evaluateGuards(guards, state);
      if (reasons.length > 0) return fail(reasons);
      return pass({ procedure, stage: "公告中" }, ["startAnnouncement"]);
    }

    case "决定": {
      if (stage !== "公告中") return fail([`仅公告中可作出决定, 当前为${stage}`]);
      const guards = ["announcementComplete", "noPendingObjection", "noJudicialRestriction", "noRiskFlags"];
      if (procedure === "简易退出" || procedure === "强制退出") {
        guards.push("noOutstandingClaims", "noArrears");
      }
      if (procedure === "主动注销") guards.push("liquidationDone");
      const reasons = evaluateGuards(guards, state);
      if (reasons.length > 0) return fail(reasons);
      return pass({ procedure, stage: "决定" });
    }

    case "已退出":
      if (stage !== "决定") return fail([`须先作出退出决定, 当前为${stage}`]);
      return pass({ procedure, stage: "已退出" });

    case "歇业中":
      if (procedure !== "歇业" || stage !== "受理") {
        return fail(["仅歇业程序受理后可备案歇业"]);
      }
      return pass({ procedure, stage: "歇业中" });

    case "已恢复":
      if (procedure !== "歇业" || stage !== "歇业中") {
        return fail(["仅歇业中可申请恢复经营"]);
      }
      return pass({ procedure, stage: "已恢复" });

    case "主动注销": {
      // 程序转换: 歇业中转注销; 强制退出中主体现身主动申请注销
      const allowed =
        (procedure === "歇业" && stage === "歇业中") ||
        (procedure === "强制退出" && !TERMINAL_STAGES.has(stage));
      if (!allowed) return fail([`当前程序(${procedure}/${stage})不允许转主动注销`]);
      return pass({ procedure: "主动注销", stage: "受理" });
    }

    case "已终止":
      // 申请人撤回或经办终止, 任何非终结阶段均可
      return pass({ procedure, stage: "已终止" });

    default:
      return fail([`未知转移目标: ${target}`]);
  }
}
