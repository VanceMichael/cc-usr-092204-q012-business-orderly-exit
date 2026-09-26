import { ExitCase, TransitionError } from "./domain/exit-case.js";
import { conclusionsEqual } from "./domain/conclusion.js";
import { LAW_VERSIONS } from "./domain/law-versions.js";
import { SAMPLE_HOLIDAYS_2026, toHolidaySet } from "./domain/holidays.js";

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

const defaultClock = () => new Date().toISOString().slice(0, 10);

/**
 * 有序退出服务: 案件存储与命令/查询入口。
 * 内存实现, 便于窗口与协作单位联调; 领域规则全部在 domain/ 内。
 */
export class ExitService {
  constructor({ lawVersions = LAW_VERSIONS, holidays = SAMPLE_HOLIDAYS_2026, clock = defaultClock } = {}) {
    this.lawVersions = lawVersions;
    this.holidays = toHolidaySet(holidays);
    this.clock = clock;
    this.cases = new Map();
    this.caseSeq = 0;
  }

  openCase(params) {
    const caseId = params.caseId ?? `CASE-${String((this.caseSeq += 1)).padStart(4, "0")}`;
    if (this.cases.has(caseId)) throw new Error(`案件编号已存在: ${caseId}`);
    const exitCase = ExitCase.open(
      { ...params, caseId },
      { lawVersions: this.lawVersions, holidays: this.holidays },
    );
    this.cases.set(caseId, exitCase);
    return exitCase;
  }

  getCase(caseId) {
    const exitCase = this.cases.get(caseId);
    if (!exitCase) throw new NotFoundError(`案件不存在: ${caseId}`);
    return exitCase;
  }

  record(caseId, category, payload, at = this.clock()) {
    return this.getCase(caseId).record(category, payload, at);
  }

  declareClaim(caseId, payload) {
    return this.getCase(caseId).declareClaim({ ...payload, at: payload.at ?? this.clock() });
  }

  withdrawClaim(caseId, claimId, at = this.clock()) {
    return this.getCase(caseId).withdrawClaim(claimId, { at });
  }

  fileObjection(caseId, payload) {
    return this.getCase(caseId).fileObjection({ ...payload, at: payload.at ?? this.clock() });
  }

  ruleObjection(caseId, objectionId, payload) {
    return this.getCase(caseId).ruleObjection(objectionId, {
      ...payload,
      at: payload.at ?? this.clock(),
    });
  }

  applyReceipt(caseId, payload) {
    return this.getCase(caseId).applyReceipt({ ...payload, at: payload.at ?? this.clock() });
  }

  clearRiskFlag(caseId, flagId, at = this.clock()) {
    return this.getCase(caseId).clearRiskFlag(flagId, { at });
  }

  pauseAnnouncement(caseId, payload) {
    return this.getCase(caseId).pauseAnnouncement(payload);
  }

  resumeAnnouncement(caseId, at = this.clock()) {
    return this.getCase(caseId).resumeAnnouncement({ at });
  }

  transition(caseId, target, payload = {}) {
    return this.getCase(caseId).transition(target, { ...payload, at: payload.at ?? this.clock() });
  }

  view(caseId, role, asOf = this.clock()) {
    return this.getCase(caseId).view(role, asOf);
  }

  conclusion(caseId) {
    return this.getCase(caseId).conclusion();
  }

  exportEvents(caseId) {
    return this.getCase(caseId).exportEvents();
  }

  /** 从全部事件重新构建结论并与当前结论比对 */
  verifyConclusion(caseId) {
    const exitCase = this.getCase(caseId);
    const rebuilt = ExitCase.replay(exitCase.meta, exitCase.timeline, {
      lawVersions: this.lawVersions,
      holidays: this.holidays,
    });
    const conclusion = exitCase.conclusion();
    const reconstructed = rebuilt.conclusion();
    const consistent = conclusionsEqual(conclusion, reconstructed);
    return consistent
      ? { consistent, conclusion }
      : { consistent, conclusion, reconstructed };
  }
}

export { TransitionError };
