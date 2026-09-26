import { assertDate } from "./dates.js";

/**
 * 适用法律版本库(示例配置)。
 *
 * 核心规则: 主体类型与适用法律按"申请时"有效的版本判断。
 * 案件受理时锁定版本快照(公告天数、强制退出门槛、主体类型目录),
 * 之后的法规修订不影响在办案件; 新申请则适用新版本。
 *
 * 版本内容由主管部门维护, 此处数据仅用于演示与测试。
 */
export const LAW_VERSIONS = Object.freeze([
  {
    id: "exit-rules-2022",
    title: "经营主体退出管理规定(示例)2022版",
    effectiveFrom: "2022-03-01",
    effectiveTo: "2024-06-30",
    announcementDays: { simplified: 20, ordinary: 45, forced: 60 },
    forcedExit: {
      minMissingAnnualReports: 2,
      requireContactLost: true,
      requireTaxAbnormal: true,
    },
    entityTypes: [
      { code: "company", label: "有限责任公司", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "partnership", label: "合伙企业", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "sole", label: "个人独资企业", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "individual", label: "个体工商业户", eligibleProcedures: ["主动注销", "简易退出", "歇业"] },
      { code: "coop", label: "农民专业合作社", eligibleProcedures: ["主动注销", "强制退出", "歇业"] },
    ],
  },
  {
    id: "exit-rules-2024",
    title: "经营主体退出管理规定(示例)2024版",
    effectiveFrom: "2024-07-01",
    effectiveTo: null,
    announcementDays: { simplified: 15, ordinary: 45, forced: 45 },
    forcedExit: {
      minMissingAnnualReports: 3,
      requireContactLost: true,
      requireTaxAbnormal: true,
    },
    entityTypes: [
      { code: "company", label: "有限责任公司", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "partnership", label: "合伙企业", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "sole", label: "个人独资企业", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "individual", label: "个体工商户", eligibleProcedures: ["主动注销", "简易退出", "歇业"] },
      { code: "coop", label: "农民专业合作社", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
    ],
  },
]);

/**
 * 按申请日解析适用的法律版本。
 * 同一日存在多个版本时取生效日最新者; 无有效版本时抛错。
 */
export function resolveLawVersion(appliedAt, versions = LAW_VERSIONS) {
  assertDate(appliedAt, "申请日");
  const candidates = versions.filter(
    (v) => v.effectiveFrom <= appliedAt && (v.effectiveTo === null || appliedAt <= v.effectiveTo),
  );
  if (candidates.length === 0) {
    throw new Error(`申请日 ${appliedAt} 没有有效的适用法律版本`);
  }
  candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return candidates[0];
}
