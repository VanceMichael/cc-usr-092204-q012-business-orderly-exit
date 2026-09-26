import { ExitService } from "../src/service.js";

/**
 * 测试用法律版本: 天数与门槛刻意缩小, 并设置版本间差异
 * (简易公告 5→3 天、强制退出未年报门槛 2→3 次、主体类型称谓变化),
 * 用于验证"按申请时版本判断"。
 */
export const TEST_LAW_VERSIONS = [
  {
    id: "test-v1",
    title: "测试规定v1",
    effectiveFrom: "2020-01-01",
    effectiveTo: "2024-12-31",
    announcementDays: { simplified: 5, ordinary: 7, forced: 10 },
    forcedExit: { minMissingAnnualReports: 2, requireContactLost: true, requireTaxAbnormal: true },
    entityTypes: [
      { code: "company", label: "有限责任公司", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "individual", label: "个体工商业户", eligibleProcedures: ["主动注销", "简易退出", "歇业"] },
    ],
  },
  {
    id: "test-v2",
    title: "测试规定v2",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    announcementDays: { simplified: 3, ordinary: 7, forced: 8 },
    forcedExit: { minMissingAnnualReports: 3, requireContactLost: true, requireTaxAbnormal: true },
    entityTypes: [
      { code: "company", label: "有限责任公司", eligibleProcedures: ["主动注销", "简易退出", "强制退出", "歇业"] },
      { code: "individual", label: "个体工商户", eligibleProcedures: ["主动注销", "简易退出", "歇业"] },
    ],
  },
];

export function makeService(overrides = {}) {
  return new ExitService({
    lawVersions: TEST_LAW_VERSIONS,
    holidays: [],
    clock: () => "2024-06-01",
    ...overrides,
  });
}

/** 开立简易退出案件并推进到公告中(公告发布 2024-06-03, 5 天期, 届满 2024-06-08) */
export function openSimplifiedAnnouncing(service, caseId = "CASE-T1") {
  service.openCase({
    caseId, entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某",
  });
  service.transition(caseId, "审查", { at: "2024-06-02" });
  service.transition(caseId, "公告中", { at: "2024-06-03" });
  return caseId;
}
