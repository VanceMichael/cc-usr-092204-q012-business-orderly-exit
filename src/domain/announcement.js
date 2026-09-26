import { addDays, diffDays, nextWorkingDay } from "./calendar.js";

// 公告期计算：
// - 基础时长为自然日；
// - 中止区间（补正、诉讼保全，[from, to) 半开区间）不计入公告期，顺延等量天数；
// - 届满日落在周末或法定节假日的，顺延至下一工作日；
// - 顺延可能跨过新的中止区间或节假日，迭代至不动点。
export function computeAnnouncement({ start, days, suspensions = [], holidays = [] }) {
  let end = addDays(start, days);
  for (let i = 0; i < 100; i += 1) {
    let suspended = 0;
    for (const s of suspensions) {
      if (!s.to) continue; // 未闭合的中止区间不参与计算（此时案件应处于暂停态）
      const from = s.from > start ? s.from : start;
      const to = s.to < end ? s.to : end;
      if (from < to) suspended += diffDays(from, to);
    }
    let next = addDays(start, days + suspended);
    next = nextWorkingDay(next, holidays);
    if (next === end) {
      return {
        start,
        days,
        end,
        suspendedDays: suspended,
        holidayShiftDays: diffDays(addDays(start, days + suspended), next),
      };
    }
    end = next;
  }
  throw new Error("公告期计算未收敛");
}
