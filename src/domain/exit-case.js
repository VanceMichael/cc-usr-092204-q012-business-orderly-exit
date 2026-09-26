import { assertDate } from "./dates.js";
import {
  createAnnouncement,
  addPause,
  closePause,
  findOpenPause,
  hasOpenPause,
  elapsedDays,
  remainingDays,
  deadline,
  isComplete,
} from "./announcement.js";
import { ClaimRegistry } from "./claims.js";
import {
  PROCEDURES,
  TERMINAL_STAGES,
  STAGE_RANK,
  deriveFacts,
  evaluateTransition,
  TransitionError,
} from "./procedures.js";
import { LAW_VERSIONS, resolveLawVersion } from "./law-versions.js";
import { assertRole, viewTimeline } from "./access.js";
import { buildConclusion } from "./conclusion.js";

/**
 * 退出案件聚合根(事件溯源)。
 *
 * 案件的一切状态变化都先落地为时间线事件, 再由事件驱动状态;
 * 回放全部事件即可重建案件与退出结论。
 * 命令方法(declareClaim、transition 等)负责校验并产生事件,
 * applyEvent 只做字面应用, 保证回放结果与正放一致。
 */

const RECORDABLE_CATEGORIES = new Set([
  "annualReport", // 年报
  "businessSign", // 经营迹象
  "contact", // 联系记录
  "taxSocial", // 税务社保状态
  "judicialRestriction", // 司法限制
  "liquidation", // 清算证据
  "report", // 举报(默认敏感)
  "notice", // 通知
]);

const RECORD_VALIDATORS = {
  annualReport: (p) => {
    if (!Number.isInteger(p.year)) throw new Error("年报事件须携带整数 year");
    if (typeof p.filed !== "boolean") throw new Error("年报事件须携带布尔 filed");
  },
  contact: (p) => {
    if (!["成功", "失联"].includes(p.result)) throw new Error("联系结果须为 成功/失联");
  },
  businessSign: (p) => {
    if (typeof p.active !== "boolean") throw new Error("经营迹象事件须携带布尔 active");
  },
  taxSocial: (p) => {
    if (p.taxStatus !== undefined && !["正常", "非正常"].includes(p.taxStatus)) {
      throw new Error("税务状态须为 正常/非正常");
    }
    if (p.socialSecurityStatus !== undefined && !["正常", "欠费"].includes(p.socialSecurityStatus)) {
      throw new Error("社保状态须为 正常/欠费");
    }
    for (const key of ["taxArrears", "wageArrears"]) {
      if (p[key] !== undefined && (typeof p[key] !== "number" || p[key] < 0)) {
        throw new Error(`${key} 须为非负数字`);
      }
    }
    if (
      p.taxStatus === undefined && p.socialSecurityStatus === undefined &&
      p.taxArrears === undefined && p.wageArrears === undefined
    ) {
      throw new Error("税务社保事件须至少携带一项状态");
    }
  },
  judicialRestriction: (p) => {
    if (!p.restrictionId) throw new Error("司法限制事件须携带 restrictionId");
    if (!["股权冻结", "诉讼保全", "被执行", "其他"].includes(p.kind)) {
      throw new Error("司法限制类型须为 股权冻结/诉讼保全/被执行/其他");
    }
  },
  liquidation: (p) => {
    if (!["清算组备案", "清算报告"].includes(p.kind)) {
      throw new Error("清算证据类型须为 清算组备案/清算报告");
    }
  },
  report: (p) => {
    if (!p.content) throw new Error("举报事件须携带 content");
  },
  notice: (p) => {
    if (!p.kind || !p.content) throw new Error("通知事件须携带 kind 与 content");
  },
};

const ANNOUNCEMENT_KIND_BY_PROCEDURE = {
  [PROCEDURES.SIMPLIFIED]: "simplified",
  [PROCEDURES.VOLUNTARY]: "ordinary",
  [PROCEDURES.FORCED]: "forced",
};

export class ExitCase {
  constructor({ caseId, entityType, procedure, appliedAt, applicant, lawVersion, holidays = new Set() }) {
    this.meta = {
      caseId,
      entityType,
      entityTypeLabel: lawVersion.entityTypes.find((t) => t.code === entityType).label,
      initialProcedure: procedure,
      appliedAt,
      applicant,
      lawVersionId: lawVersion.id,
    };
    this.law = lawVersion;
    this.holidays = holidays;
    this.procedure = procedure;
    this.stage = "受理";
    this.timeline = [];
    this.claims = new ClaimRegistry();
    this.announcements = [];
    this.objections = [];
    this.receipts = [];
    this.riskFlags = [];
    this.seq = 0;
  }

  /**
   * 立案: 按申请日解析适用法律版本与主体类型, 之后锁定不变。
   */
  static open(
    { caseId, entityType, procedure, appliedAt, applicant },
    { lawVersions = LAW_VERSIONS, holidays = new Set() } = {},
  ) {
    assertDate(appliedAt, "申请日");
    if (!caseId) throw new Error("案件编号不能为空");
    if (!applicant) throw new Error("申请人不能为空");
    const law = resolveLawVersion(appliedAt, lawVersions);
    const typeDef = law.entityTypes.find((t) => t.code === entityType);
    if (!typeDef) throw new Error(`主体类型 ${entityType} 在 ${law.id} 中未定义`);
    if (!typeDef.eligibleProcedures.includes(procedure)) {
      throw new Error(`${typeDef.label}不适用${procedure}程序`);
    }
    const exitCase = new ExitCase({
      caseId, entityType, procedure, appliedAt, applicant, lawVersion: law, holidays,
    });
    exitCase.#emit("notice", {
      kind: "受理通知",
      to: "applicant",
      content: `${typeDef.label}${procedure}申请已受理, 适用${law.title}`,
    }, appliedAt);
    return exitCase;
  }

  /** 回放全部事件重建案件(审计与结论复核用) */
  static replay(meta, events, { lawVersions = LAW_VERSIONS, holidays = new Set() } = {}) {
    const law = resolveLawVersion(meta.appliedAt, lawVersions);
    if (law.id !== meta.lawVersionId) {
      throw new Error(`法律版本漂移: 案件锁定 ${meta.lawVersionId}, 当前解析为 ${law.id}`);
    }
    const exitCase = new ExitCase({
      caseId: meta.caseId,
      entityType: meta.entityType,
      procedure: meta.initialProcedure,
      appliedAt: meta.appliedAt,
      applicant: meta.applicant,
      lawVersion: law,
      holidays,
    });
    for (const event of events) exitCase.applyEvent(structuredClone(event));
    return exitCase;
  }

  // ---------- 事件落地 ----------

  #emit(category, payload, at) {
    assertDate(at, "事件日期");
    const event = {
      id: `${this.meta.caseId}-E${String(this.seq + 1).padStart(4, "0")}`,
      seq: this.seq + 1,
      caseId: this.meta.caseId,
      category,
      at,
      ...payload,
    };
    return this.applyEvent(event);
  }

  /** 字面应用事件, 不做业务校验; 回放与正放共用此路径 */
  applyEvent(event) {
    this.seq = Math.max(this.seq, event.seq ?? 0);
    switch (event.category) {
      case "claim":
        if (event.action === "declare") {
          this.claims.declare({
            id: event.id,
            creditorId: event.creditorId,
            basis: event.basis,
            amount: event.amount,
            category: event.claimCategory,
            at: event.at,
          });
        } else if (event.action === "withdraw") this.claims.withdraw(event.claimId);
        else if (event.action === "confirm") this.claims.confirm(event.claimId);
        else if (event.action === "reject") this.claims.reject(event.claimId);
        break;

      case "objection":
        if (event.action === "file") {
          this.objections.push({
            id: event.id,
            by: event.by,
            reason: event.reason,
            filedAt: event.at,
            ruling: null,
            rulingAt: null,
            rulingReason: null,
          });
        } else if (event.action === "rule") {
          const objection = this.objections.find((o) => o.id === event.objectionId);
          if (objection) {
            objection.ruling = event.upheld ? "成立" : "不成立";
            objection.rulingAt = event.at;
            objection.rulingReason = event.reason ?? null;
          }
        }
        break;

      case "announcement":
        if (event.action === "start") {
          this.announcements.push(createAnnouncement({
            id: event.announcementId,
            kind: event.kind,
            startDate: event.startDate,
            requiredDays: event.requiredDays,
          }));
        } else if (event.action === "pause") {
          addPause(this.#findAnnouncement(event.announcementId), {
            id: event.pauseId, reason: event.reason, from: event.from, to: event.to ?? null,
          });
        } else if (event.action === "resume") {
          closePause(this.#findAnnouncement(event.announcementId), event.pauseId, event.at);
        } else if (event.action === "archive") {
          this.#findAnnouncement(event.announcementId).status = "已终止";
        }
        break;

      case "receipt": {
        // 回执只登记不倒车: 迟到回执标记 late, 案件阶段保持不变
        const late = (STAGE_RANK[event.stage] ?? 0) < (STAGE_RANK[this.stage] ?? 0);
        this.receipts.push({
          id: event.id,
          department: event.department,
          stage: event.stage,
          content: event.content ?? null,
          adverse: event.adverse ?? null,
          issuedAt: event.issuedAt,
          receivedAt: event.at,
          late,
        });
        if (event.adverse) {
          this.riskFlags.push({
            id: `RF-${event.id}`,
            source: event.department,
            detail: event.adverse.detail ?? event.content ?? "部门回执提示风险",
            active: true,
            createdAt: event.at,
            clearedAt: null,
          });
        }
        break;
      }

      case "riskFlag":
        if (event.action === "clear") {
          const flag = this.riskFlags.find((f) => f.id === event.flagId);
          if (flag) {
            flag.active = false;
            flag.clearedAt = event.at;
          }
        }
        break;

      case "transition": {
        if (event.to?.procedure) this.procedure = event.to.procedure;
        if (event.to?.stage) this.stage = event.to.stage;
        if (this.stage === "决定") {
          const current = this.currentAnnouncement();
          if (current) {
            current.completedAt = deadline(current, this.holidays);
            current.status = "已完成";
          }
        }
        break;
      }

      default:
        // 年报、联系、税务社保、经营迹象、司法限制、清算、举报、通知: 仅入时间线
        break;
    }
    this.timeline.push(event);
    return event;
  }

  // ---------- 命令 ----------

  /** 登记时间线事实(年报/经营迹象/联系/税务社保/司法限制/清算/举报/通知) */
  record(category, payload, at) {
    if (!RECORDABLE_CATEGORIES.has(category)) throw new Error(`不支持的事件类别: ${category}`);
    RECORD_VALIDATORS[category](payload);
    const events = [this.#emit(category, payload, at)];
    // 诉讼保全登记/解除时, 公告期自动暂停/恢复
    if (category === "judicialRestriction" && payload.kind === "诉讼保全") {
      const current = this.currentAnnouncement();
      if (current) {
        if (payload.active !== false) {
          events.push(this.#pause(current, "诉讼保全", at));
        } else {
          const open = findOpenPause(current, "诉讼保全");
          if (open) events.push(this.#resume(current, open.id, at));
        }
      }
    }
    return events;
  }

  declareClaim({ creditorId, basis, amount, category, at }) {
    if (TERMINAL_STAGES.has(this.stage)) throw new Error(`案件已终结(${this.stage}), 不再受理债权申报`);
    const event = this.#emit("claim", {
      action: "declare", creditorId, basis, amount, claimCategory: category ?? "其他",
    }, at);
    return this.claims.get(event.id);
  }

  withdrawClaim(claimId, { at }) {
    this.claims.get(claimId); // 不存在则抛错
    return [this.#emit("claim", { action: "withdraw", claimId }, at)];
  }

  fileObjection({ by, reason, at }) {
    if (this.stage !== "公告中" && this.stage !== "异议审查") {
      throw new Error(`当前阶段(${this.stage})不受理异议`);
    }
    if (!by || !reason) throw new Error("异议须携带提出人与理由");
    const events = [this.#emit("objection", { action: "file", by, reason }, at)];
    if (this.stage === "公告中") {
      const from = { procedure: this.procedure, stage: this.stage };
      events.push(this.#emit("transition", {
        from, to: { procedure: this.procedure, stage: "异议审查" }, cause: "异议提出, 公告暂停",
      }, at));
      const current = this.currentAnnouncement();
      if (current) events.push(this.#pause(current, "异议审查", at));
    }
    return events;
  }

  ruleObjection(objectionId, { upheld, at, reason }) {
    const objection = this.objections.find((o) => o.id === objectionId);
    if (!objection) throw new Error(`异议不存在: ${objectionId}`);
    if (objection.ruling !== null) throw new Error(`异议 ${objectionId} 已裁定`);
    const events = [this.#emit("objection", { action: "rule", objectionId, upheld, reason }, at)];
    if (this.objections.some((o) => o.ruling === null)) return events; // 仍有待裁定异议

    const current = this.currentAnnouncement();
    const closeObjectionPause = () => {
      if (!current) return;
      const open = findOpenPause(current, "异议审查");
      if (open) events.push(this.#resume(current, open.id, at));
    };
    const from = { procedure: this.procedure, stage: this.stage };

    if (!upheld) {
      closeObjectionPause();
      events.push(this.#emit("transition", {
        from, to: { procedure: this.procedure, stage: "公告中" }, cause: "异议不成立, 恢复公告",
      }, at));
      return events;
    }

    // 异议成立
    closeObjectionPause();
    if (current) events.push(this.#emit("announcement", { action: "archive", announcementId: current.id }, at));
    if (this.procedure === PROCEDURES.SIMPLIFIED) {
      events.push(this.#emit("transition", {
        from, to: { procedure: PROCEDURES.VOLUNTARY, stage: "公告中" }, cause: "异议成立, 简易退出转普通注销程序",
      }, at));
      events.push(...this.#startAnnouncement("ordinary", at));
      events.push(this.#emit("notice", {
        kind: "程序转换通知", to: "applicant", content: "异议成立, 简易退出转为普通注销程序, 重新公告",
      }, at));
    } else if (this.procedure === PROCEDURES.FORCED) {
      events.push(this.#emit("transition", {
        from, to: { procedure: this.procedure, stage: "已终止" }, cause: "异议成立, 强制退出终止",
      }, at));
      events.push(this.#emit("notice", { kind: "终止通知", to: "applicant", content: "异议成立, 强制退出程序终止" }, at));
    } else {
      events.push(this.#emit("transition", {
        from, to: { procedure: this.procedure, stage: "已驳回" }, cause: "异议成立, 注销申请被驳回",
      }, at));
      events.push(this.#emit("notice", { kind: "驳回通知", to: "applicant", content: "异议成立, 注销申请驳回" }, at));
    }
    return events;
  }

  /** 部门回执: 可迟到(标记 late)但不倒退案件阶段; 负面回执转为风险标记 */
  applyReceipt({ department, stage, content, adverse, issuedAt, at }) {
    if (!STAGE_RANK[stage]) throw new Error(`未知回执阶段: ${stage}`);
    if (!department) throw new Error("回执须携带部门");
    assertDate(issuedAt, "回执签发日");
    const event = this.#emit("receipt", { department, stage, content, adverse, issuedAt }, at);
    return this.receipts.find((r) => r.id === event.id);
  }

  clearRiskFlag(flagId, { at }) {
    const flag = this.riskFlags.find((f) => f.id === flagId);
    if (!flag) throw new Error(`风险标记不存在: ${flagId}`);
    if (!flag.active) throw new Error(`风险标记 ${flagId} 已核销`);
    return [this.#emit("riskFlag", { action: "clear", flagId }, at)];
  }

  /** 公告暂停(补正/诉讼保全/异议审查); to 缺省表示暂停未结束 */
  pauseAnnouncement({ reason, from, to = null }) {
    const current = this.currentAnnouncement();
    if (!current) throw new Error("当前无进行中的公告");
    const events = [this.#pause(current, reason, from, to)];
    if (reason === "补正") {
      events.push(this.#emit("notice", {
        kind: "补正通知", to: "applicant", content: "申请材料需补正, 公告期自补正之日起暂停计时",
      }, from));
    }
    return events;
  }

  resumeAnnouncement({ at }) {
    const current = this.currentAnnouncement();
    if (!current) throw new Error("当前无进行中的公告");
    const open = findOpenPause(current);
    if (!open) throw new Error("当前无未结束的暂停");
    return [this.#resume(current, open.id, at)];
  }

  /** 程序/阶段转移, 转移条件不满足时抛出 TransitionError(携带理由) */
  transition(target, { at, by } = {}) {
    assertDate(at, "转移日期");
    const result = evaluateTransition(this.#guardContext(at), target);
    if (!result.ok) throw new TransitionError(result.reasons);
    const events = [this.#emit("transition", {
      from: { procedure: this.procedure, stage: this.stage },
      to: result.to,
      by: by ?? null,
    }, at)];
    if (result.effects.includes("startAnnouncement")) {
      events.push(...this.#startAnnouncement(ANNOUNCEMENT_KIND_BY_PROCEDURE[this.procedure], at));
    }
    if (result.to.stage === "决定") {
      events.push(this.#emit("notice", { kind: "决定通知", to: "applicant", content: `${this.procedure}决定已作出` }, at));
    } else if (result.to.stage === "已退出") {
      events.push(this.#emit("notice", { kind: "注销通知", to: "applicant", content: "经营主体已注销登记" }, at));
    } else if (result.to.stage === "已终止") {
      events.push(this.#emit("notice", { kind: "终止通知", to: "applicant", content: "退出程序已终止" }, at));
    }
    return events;
  }

  // ---------- 查询 ----------

  facts() {
    return deriveFacts(this.timeline);
  }

  currentAnnouncement() {
    for (let i = this.announcements.length - 1; i >= 0; i -= 1) {
      if (this.announcements[i].status === "进行中") return this.announcements[i];
    }
    return null;
  }

  #findAnnouncement(id) {
    const announcement = this.announcements.find((a) => a.id === id);
    if (!announcement) throw new Error(`公告不存在: ${id}`);
    return announcement;
  }

  #pause(announcement, reason, from, to = null) {
    const pauseId = `${announcement.id}-P${announcement.pauses.length + 1}`;
    return this.#emit("announcement", {
      action: "pause", announcementId: announcement.id, pauseId, reason, from, to,
    }, from);
  }

  #resume(announcement, pauseId, at) {
    return this.#emit("announcement", {
      action: "resume", announcementId: announcement.id, pauseId,
    }, at);
  }

  #startAnnouncement(kind, at) {
    const requiredDays = this.law.announcementDays[kind];
    if (!requiredDays) throw new Error(`未知公告类型: ${kind}`);
    const announcementId = `${this.meta.caseId}-A${this.announcements.length + 1}`;
    const start = this.#emit("announcement", {
      action: "start", announcementId, kind, startDate: at, requiredDays,
    }, at);
    const notice = this.#emit("notice", {
      kind: "公告通知", to: "all", content: `公告已发布, 公告期 ${requiredDays} 天, 自次日起算`,
    }, at);
    return [start, notice];
  }

  #guardContext(asOf) {
    const current = this.currentAnnouncement();
    return {
      procedure: this.procedure,
      stage: this.stage,
      facts: this.facts(),
      law: this.law,
      outstandingClaims: this.claims.outstandingItems.length,
      announcementComplete: current ? isComplete(current, asOf, this.holidays) : false,
      pendingObjections: this.objections.some((o) => o.ruling === null),
      activeRiskFlags: this.riskFlags.filter((f) => f.active).length,
    };
  }

  /** 公告期限视图: 申请人与利害关系人看到的就是这一份 */
  deadlines(asOf) {
    const announcement = this.currentAnnouncement()
      ?? this.announcements[this.announcements.length - 1]
      ?? null;
    if (!announcement) return null;
    return {
      announcementId: announcement.id,
      kind: announcement.kind,
      status: announcement.status,
      startDate: announcement.startDate,
      requiredDays: announcement.requiredDays,
      elapsedDays: elapsedDays(announcement, asOf, this.holidays),
      remainingDays: remainingDays(announcement, asOf, this.holidays),
      deadline: deadline(announcement, this.holidays),
      paused: hasOpenPause(announcement),
      pauses: announcement.pauses.map((p) => ({ ...p })),
    };
  }

  /** 下一步转移的未满足条件(理由); 满足则为空数组 */
  pendingReasons(asOf) {
    if (TERMINAL_STAGES.has(this.stage)) return [];
    if (this.stage === "异议审查") return ["异议待裁定"];
    const next = {
      受理: this.procedure === PROCEDURES.SUSPENSION ? "歇业中" : "审查",
      审查: "公告中",
      公告中: "决定",
      决定: "已退出",
      歇业中: null,
    }[this.stage];
    if (!next) return [];
    const result = evaluateTransition(this.#guardContext(asOf), next);
    return result.ok ? [] : result.reasons;
  }

  /** 角色视图: 期限与理由各角色一致, 仅敏感内容可见性不同 */
  view(role, asOf) {
    assertRole(role);
    assertDate(asOf, "视图日期");
    return {
      caseId: this.meta.caseId,
      procedure: this.procedure,
      stage: this.stage,
      entityType: this.meta.entityTypeLabel,
      lawVersion: this.meta.lawVersionId,
      applicant: this.meta.applicant,
      appliedAt: this.meta.appliedAt,
      asOf,
      deadlines: this.deadlines(asOf),
      reasons: this.pendingReasons(asOf),
      claims: this.claims.summary(),
      objections: this.objections.map((o) => ({
        id: o.id, by: o.by, reason: o.reason, ruling: o.ruling, rulingAt: o.rulingAt,
      })),
      timeline: viewTimeline(this.timeline, role),
    };
  }

  conclusion() {
    return buildConclusion(this);
  }

  exportEvents() {
    return structuredClone(this.timeline);
  }
}

export { TransitionError };
