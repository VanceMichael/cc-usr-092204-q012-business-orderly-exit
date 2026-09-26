import { computeAnnouncement } from "./announcement.js";
import { openClaims, recognizedTotal, registerClaim, withdrawClaim } from "./claims.js";
import { resolveLawVersion } from "./law.js";
import { canEnter, PATH, RANK, STATUS } from "./machine.js";

// 案件聚合：以事件溯源方式维护程序时间线。
// 事件信封：{ id, type, occurredAt, recordedAt?, payload }。
// occurredAt 为事实发生时间，recordedAt 为登记时间（部门回执可迟到）。

const DEFAULT_ANNOUNCEMENT_DAYS = {
  [PATH.SIMPLIFIED]: (law) => law.simplifiedAnnouncementDays,
  [PATH.FORCED]: (law) => law.forcedAnnouncementDays,
  [PATH.VOLUNTARY]: (law) => law.generalAnnouncementDays,
};

export function openCase(applicationEvent, { lawTable } = {}) {
  const { caseId, entityType, path, applicant = null, holidays = [] } = applicationEvent.payload;
  const law = resolveLawVersion(applicationEvent.occurredAt, lawTable);
  return {
    caseId,
    entityType, // 主体类型按申请时快照
    applicant,
    lawVersion: law.version, // 适用法律按申请时版本快照
    law,
    path,
    status: STATUS.FILED,
    statusSince: applicationEvent.occurredAt,
    pause: null, // { reason: "correction" | "preservation", since }
    suspensions: [], // 公告期中止区间 { reason, from, to }
    holidays,
    announcement: null,
    claims: new Map(),
    duplicateClaims: 0,
    objections: new Map(),
    receipts: [],
    facts: [],
    sensitiveReports: [],
    evidence: [],
    notifications: [],
    flags: [],
    reasons: [],
    outcome: null,
  };
}

function enter(state, next, at) {
  if (!canEnter(state.status, next)) {
    // 迟到或乱序事件不得让案件倒退
    state.flags.push({ code: "REGRESSION_BLOCKED", from: state.status, to: next, at });
    return false;
  }
  state.status = next;
  state.statusSince = at;
  return true;
}

function refreshAnnouncement(state) {
  if (!state.announcement) return;
  state.announcement = computeAnnouncement({
    start: state.announcement.start,
    days: state.announcement.days,
    suspensions: state.suspensions,
    holidays: state.holidays,
  });
}

function openSuspension(state, reason, at) {
  state.pause = { reason, since: at };
  state.suspensions.push({ reason, from: at, to: null });
}

function closeSuspension(state, reason, at) {
  if (state.pause?.reason === reason) state.pause = null;
  const open = state.suspensions.find((s) => s.reason === reason && s.to === null);
  if (open) {
    open.to = at;
    refreshAnnouncement(state);
  }
}

function hasActiveRestriction(state) {
  return state.facts.some((f) => f.type === "judicial_restriction" && !f.lifted);
}

function latestTaxSocial(state) {
  const list = state.facts.filter((f) => f.type === "tax_social_status");
  return list.length ? list[list.length - 1] : null;
}

// 强制退出适格性：地址失联 + 长期未年报 + 长期无经营迹象，三者齐备。
export function forcedExitEligible(state, asOf) {
  const reasons = [];
  const unreachable = state.facts.some(
    (f) => f.type === "contact_attempt" && f.result === "unreachable",
  );
  if (!unreachable) reasons.push({ code: "ADDRESS_REACHABLE" });
  const asOfYear = Number(asOf.slice(0, 4));
  const recentReport = state.facts.some(
    (f) => f.type === "annual_report" && asOfYear - Number(f.year) <= 2,
  );
  if (recentReport) reasons.push({ code: "RECENT_ANNUAL_REPORT" });
  const recentSign = state.facts.some(
    (f) => f.type === "business_sign" && f.occurredAt.slice(0, 4) >= String(asOfYear - 2),
  );
  if (recentSign) reasons.push({ code: "RECENT_BUSINESS_SIGN" });
  return { ok: reasons.length === 0, reasons };
}

// 程序路径之间的转移条件（显式守卫，拒绝时给出理由码）。
export function evaluateTransfer(state, to, asOf) {
  const from = state.path;
  const reasons = [];
  if (from === to) return { ok: false, reasons: [{ code: "SAME_PATH" }] };

  if (to === PATH.SIMPLIFIED && from === PATH.VOLUNTARY) {
    if (openClaims(state.claims).length > 0) reasons.push({ code: "OUTSTANDING_CLAIMS" });
    const tax = latestTaxSocial(state);
    if (tax && (tax.taxArrears || tax.socialSecurityArrears)) {
      reasons.push({ code: "TAX_OR_SOCIAL_ARREARS" });
    }
    if (hasActiveRestriction(state)) reasons.push({ code: "JUDICIAL_RESTRICTION" });
    if (!state.law.simplifiedEligibleTypes.includes(state.entityType)) {
      reasons.push({ code: "INELIGIBLE_ENTITY_TYPE" });
    }
    return { ok: reasons.length === 0, reasons };
  }

  if (to === PATH.VOLUNTARY && from === PATH.SIMPLIFIED) {
    const sustained = [...state.objections.values()].some((o) => o.status === "sustained");
    if (!sustained && openClaims(state.claims).length === 0) {
      reasons.push({ code: "NO_TRANSFER_GROUNDS" });
    }
    return { ok: reasons.length === 0, reasons };
  }

  if (to === PATH.FORCED) {
    return forcedExitEligible(state, asOf);
  }

  if (to === PATH.DORMANCY) {
    if (RANK[state.status] > RANK[STATUS.ACCEPTED]) {
      reasons.push({ code: "TOO_LATE_FOR_DORMANCY" });
    }
    return { ok: reasons.length === 0, reasons };
  }

  return { ok: false, reasons: [{ code: "UNKNOWN_TRANSFER" }] };
}

export function applyEvent(state, event) {
  const s = structuredClone(state);
  const p = event.payload ?? {};
  switch (event.type) {
    case "application_accepted":
      enter(s, STATUS.ACCEPTED, event.occurredAt);
      break;
    case "announcement_published": {
      const days = p.days ?? DEFAULT_ANNOUNCEMENT_DAYS[s.path]?.(s.law);
      s.announcement = computeAnnouncement({
        start: p.startDate ?? event.occurredAt,
        days,
        suspensions: s.suspensions,
        holidays: s.holidays,
      });
      enter(s, STATUS.ANNOUNCING, event.occurredAt);
      break;
    }
    case "correction_requested":
      openSuspension(s, "correction", event.occurredAt);
      break;
    case "announcement_closed":
      enter(s, STATUS.DECIDING, event.occurredAt);
      break;    case "correction_completed":
      closeSuspension(s, "correction", event.occurredAt);
      break;
    case "judicial_restriction":
      s.facts.push({ type: "judicial_restriction", occurredAt: event.occurredAt, lifted: false, ...p });
      if (p.kind === "preservation") openSuspension(s, "preservation", event.occurredAt);
      break;
    case "judicial_restriction_lifted":
      for (const f of s.facts) {
        if (f.type === "judicial_restriction" && !f.lifted) f.lifted = true;
      }
      closeSuspension(s, "preservation", event.occurredAt);
      break;
    case "claim_filed": {
      const { duplicate } = registerClaim(s.claims, { filedAt: event.occurredAt, ...p });
      if (duplicate) s.duplicateClaims += 1;
      break;
    }
    case "claim_withdrawn":
      withdrawClaim(s.claims, p.claimId);
      break;
    case "objection_filed":
      s.objections.set(p.objectionId, { by: p.by, status: "open", filedAt: event.occurredAt });
      break;
    case "objection_resolved": {
      const objection = s.objections.get(p.objectionId);
      if (objection) objection.status = p.outcome; // sustained | overruled
      if (p.outcome === "sustained") {
        s.reasons.push({ code: "SUSTAINED_OBJECTION", objectionId: p.objectionId });
      }
      break;
    }
    case "department_receipt": {
      // 回执可迟到：只补充事实，永不倒退案件状态
      const late = event.occurredAt < s.statusSince;
      s.receipts.push({ ...p, occurredAt: event.occurredAt, late });
      if (late && RANK[s.status] >= RANK[STATUS.DECIDING]) {
        s.flags.push({ code: "LATE_RECEIPT_AFTER_DECISION_STAGE", department: p.department });
      }
      if (p.facts) s.facts.push({ ...p.facts, occurredAt: event.occurredAt });
      break;
    }
    case "annual_report":
    case "business_sign":
    case "contact_attempt":
    case "tax_social_status":
      s.facts.push({ type: event.type, occurredAt: event.occurredAt, ...p });
      break;
    case "sensitive_report":
      s.sensitiveReports.push({ occurredAt: event.occurredAt, ...p });
      break;
    case "liquidation_evidence":
      s.evidence.push({ occurredAt: event.occurredAt, ...p });
      break;
    case "notice_issued":
      s.notifications.push({ occurredAt: event.occurredAt, ...p });
      break;
    case "path_transfer": {
      const verdict = evaluateTransfer(s, p.to, event.occurredAt);
      if (verdict.ok) {
        s.path = p.to;
        s.reasons.push({ code: "PATH_TRANSFERRED", to: p.to });
      } else {
        s.flags.push({ code: "TRANSFER_REJECTED", to: p.to, reasons: verdict.reasons });
      }
      break;
    }
    case "dormancy_started":
      enter(s, STATUS.DORMANT, event.occurredAt);
      break;
    case "resumption_requested":
      if (enter(s, STATUS.TERMINATED, event.occurredAt)) s.outcome = "resumed";
      break;
    case "decision": {
      const blockers = [];
      if (s.pause) blockers.push({ code: "CASE_SUSPENDED", reason: s.pause.reason });
      if (s.announcement && event.occurredAt < s.announcement.end) {
        blockers.push({ code: "ANNOUNCEMENT_NOT_ENDED", end: s.announcement.end });
      }
      const openObjection = [...s.objections.values()].some((o) => o.status === "open");
      if (openObjection) blockers.push({ code: "OPEN_OBJECTIONS" });
      if (blockers.length > 0) {
        s.flags.push({ code: "DECISION_BLOCKED", reasons: blockers });
        break;
      }
      if (enter(s, p.outcome === "exited" ? STATUS.EXITED : STATUS.TERMINATED, event.occurredAt)) {
        s.outcome = p.outcome;
      }
      break;
    }
    default:
      s.flags.push({ code: "UNKNOWN_EVENT", type: event.type });
  }
  return s;
}

// 重放排序：事实发生时间优先，其次登记时间，最后按事件 id 稳定排序。
export function sortEvents(events) {
  return [...events].sort((a, b) => {
    const ka = `${a.occurredAt}|${a.recordedAt ?? a.occurredAt}|${a.id}`;
    const kb = `${b.occurredAt}|${b.recordedAt ?? b.occurredAt}|${b.id}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// 从全部事件（通知、异议、清算证据等）重建案件状态。
export function replay(events, options) {
  const sorted = sortEvents(events);
  const application = sorted.find((e) => e.type === "application");
  if (!application) throw new Error("缺少 application 事件，无法立案");
  let state = openCase(application, options);
  for (const event of sorted) {
    if (event.type === "application") continue;
    state = applyEvent(state, event);
  }
  return state;
}

// 退出结论：由时间线重新构建，可核对、可审计。
export function deriveConclusion(state) {
  const claims = [...state.claims.values()];
  const objections = [...state.objections.values()];
  return {
    caseId: state.caseId,
    entityType: state.entityType,
    lawVersion: state.lawVersion,
    path: state.path,
    status: state.status,
    outcome: state.outcome,
    claims: {
      recognized: claims.filter((c) => c.status === "filed"),
      recognizedTotal: recognizedTotal(state.claims),
      duplicatesRejected: state.duplicateClaims,
    },
    objections: {
      filed: objections.length,
      sustained: objections.filter((o) => o.status === "sustained").length,
      overruled: objections.filter((o) => o.status === "overruled").length,
      open: objections.filter((o) => o.status === "open").length,
    },
    announcement: state.announcement,
    notices: state.notifications,
    evidence: state.evidence,
    reasons: state.reasons,
    flags: state.flags,
  };
}

export function rebuildConclusion(events, options) {
  return deriveConclusion(replay(events, options));
}
