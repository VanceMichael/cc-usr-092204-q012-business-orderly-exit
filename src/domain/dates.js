/**
 * 日期工具。领域内所有日期一律使用 YYYY-MM-DD 字符串(日粒度),
 * 比较与加减均按 UTC 日历日处理, 避免时区干扰。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value) {
  return typeof value === "string" && DATE_RE.test(value);
}

export function assertDate(value, name = "日期") {
  if (!isDateString(value)) {
    throw new Error(`${name}须为 YYYY-MM-DD 格式, 收到: ${value}`);
  }
  return value;
}

/** date + n 天, 返回 YYYY-MM-DD */
export function addDays(date, n) {
  assertDate(date);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** b - a 的天数(b 在 a 之后为正) */
export function diffDays(a, b) {
  assertDate(a, "起始日");
  assertDate(b, "截止日");
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
