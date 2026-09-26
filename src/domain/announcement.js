import { assertDate, addDays } from "./dates.js";

/**
 * 公告期时钟。
 *
 * 计时规则(程序惯例):
 * - 公告发布当日不计入, 自次日起算;
 * - 法定节假日(节假日历)不计入;
 * - 暂停期间(补正、诉讼保全、异议审查)不计入, 暂停含起止日;
 * - 届满日为第 N 个计入日; 存在未结束的暂停时届满日待定(null)。
 *
 * 同一公告的暂停区间可能重叠(如补正期间又遇诉讼保全),
 * 重叠部分只扣除一次——按"当日是否被任一区间覆盖"判断, 天然去重。
 */

export const PAUSE_REASONS = Object.freeze(["补正", "诉讼保全", "异议审查"]);

const MAX_SCAN_DAYS = 3660;

export function createAnnouncement({ id, kind, startDate, requiredDays }) {
  assertDate(startDate, "公告发布日");
  if (!Number.isInteger(requiredDays) || requiredDays <= 0) {
    throw new Error(`公告天数须为正整数, 收到: ${requiredDays}`);
  }
  return {
    id,
    kind,
    startDate,
    requiredDays,
    pauses: [],
    status: "进行中", // 进行中 | 已完成 | 已终止(被后续公告替代)
    completedAt: null,
  };
}

/** 新增暂停区间; to 为 null 表示暂停尚未结束 */
export function addPause(announcement, { id, reason, from, to = null }) {
  if (!PAUSE_REASONS.includes(reason)) {
    throw new Error(`不支持的暂停事由: ${reason}`);
  }
  assertDate(from, "暂停起始日");
  if (to !== null) {
    assertDate(to, "暂停截止日");
    if (to < from) throw new Error(`暂停截止日 ${to} 早于起始日 ${from}`);
  }
  const pause = { id: id ?? `${announcement.id}-P${announcement.pauses.length + 1}`, reason, from, to };
  announcement.pauses.push(pause);
  return pause;
}

/** 结束指定暂停: to 为暂停最后一日(当日仍不计入, 次日起恢复计时) */
export function closePause(announcement, pauseId, to) {
  const pause = announcement.pauses.find((p) => p.id === pauseId);
  if (!pause) throw new Error(`暂停记录不存在: ${pauseId}`);
  if (pause.to !== null) throw new Error(`暂停 ${pauseId} 已结束`);
  assertDate(to, "恢复日");
  if (to < pause.from) throw new Error(`恢复日 ${to} 早于暂停起始日 ${pause.from}`);
  pause.to = to;
  return pause;
}

export function findOpenPause(announcement, reason = null) {
  return announcement.pauses.find((p) => p.to === null && (reason === null || p.reason === reason)) ?? null;
}

export function hasOpenPause(announcement) {
  return announcement.pauses.some((p) => p.to === null);
}

function isNonCountingDay(announcement, day, holidays) {
  if (holidays.has(day)) return true;
  return announcement.pauses.some((p) => p.from <= day && (p.to === null || day <= p.to));
}

/** 截至 asOf(含)已计入的公告天数 */
export function elapsedDays(announcement, asOf, holidays = new Set()) {
  assertDate(asOf, "截止日期");
  let count = 0;
  let day = announcement.startDate;
  while (day < asOf) {
    day = addDays(day, 1);
    if (!isNonCountingDay(announcement, day, holidays)) count += 1;
  }
  return count;
}

export function remainingDays(announcement, asOf, holidays = new Set()) {
  return Math.max(0, announcement.requiredDays - elapsedDays(announcement, asOf, holidays));
}

export function isComplete(announcement, asOf, holidays = new Set()) {
  return elapsedDays(announcement, asOf, holidays) >= announcement.requiredDays;
}

/**
 * 届满日: 第 N 个计入日。
 * 存在未结束的暂停且剩余天数不足时返回 null(期限待定),
 * 待暂停结束后可重新计算确定。
 */
export function deadline(announcement, holidays = new Set()) {
  let count = 0;
  let day = announcement.startDate;
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    day = addDays(day, 1);
    if (!isNonCountingDay(announcement, day, holidays)) {
      count += 1;
      if (count >= announcement.requiredDays) return day;
    } else if (hasOpenPause(announcement) && day >= announcement.startDate) {
      // 进入未结束的暂停区间, 之后不再有计入日, 无需继续扫描
      const open = announcement.pauses.find((p) => p.to === null);
      if (open && day >= open.from) return null;
    }
  }
  return null;
}
