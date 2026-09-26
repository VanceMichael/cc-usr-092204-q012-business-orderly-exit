// 适用法律版本表：主体类型与适用规则按申请时有效的版本快照，
// 后续法规变化不回溯影响已立案案件。
export const DEFAULT_LAW_TABLE = [
  {
    version: "2021-规",
    effectiveFrom: "2021-03-01",
    simplifiedAnnouncementDays: 45,
    forcedAnnouncementDays: 60,
    generalAnnouncementDays: 45,
    simplifiedEligibleTypes: ["有限责任公司", "个人独资企业", "合伙企业"],
  },
  {
    version: "2024-规",
    effectiveFrom: "2024-07-01",
    simplifiedAnnouncementDays: 20,
    forcedAnnouncementDays: 60,
    generalAnnouncementDays: 45,
    simplifiedEligibleTypes: ["有限责任公司", "个人独资企业", "合伙企业", "农民专业合作社"],
  },
];

export function resolveLawVersion(appliedAt, table = DEFAULT_LAW_TABLE) {
  const eligible = table
    .filter((v) => v.effectiveFrom <= appliedAt)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  if (eligible.length === 0) {
    throw new Error(`申请日 ${appliedAt} 之前无有效法律版本`);
  }
  return eligible[eligible.length - 1];
}
