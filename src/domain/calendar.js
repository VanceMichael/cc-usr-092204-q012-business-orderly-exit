// 工作日日历：公告期顺延与中止的日期基础。全部按 UTC 日期运算，避免时区误差。
const DAY_MS = 24 * 60 * 60 * 1000;

export function toDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(new Date(toDate(iso).getTime() + n * DAY_MS));
}

// b - a 的自然日天数（b 早于 a 时为负）
export function diffDays(a, b) {
  return Math.round((toDate(b) - toDate(a)) / DAY_MS);
}

export function isWeekend(iso) {
  const day = toDate(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function isWorkingDay(iso, holidays = []) {
  return !isWeekend(iso) && !holidays.includes(iso);
}

// 顺延到下一个工作日（当日已为工作日则返回当日）
export function nextWorkingDay(iso, holidays = []) {
  let cursor = iso;
  while (!isWorkingDay(cursor, holidays)) cursor = addDays(cursor, 1);
  return cursor;
}
