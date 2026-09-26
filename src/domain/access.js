/**
 * 角色与可见性。
 *
 * 敏感举报仅向经办角色开放: 其他角色(申请人、利害关系人、审计人员)
 * 在时间线视图中完全看不到敏感举报事件。
 * 期限与理由对所有角色一致——由同一时钟与同一守卫求值产生,
 * 角色差异只体现在敏感内容的可见性上。
 */

export const ROLES = Object.freeze({
  APPLICANT: "申请人",
  INTERESTED_PARTY: "利害关系人",
  HANDLER: "经办人",
  AUDITOR: "审计人员",
});

const ROLE_LIST = Object.values(ROLES);

export function assertRole(role) {
  if (!ROLE_LIST.includes(role)) {
    throw new Error(`未知角色: ${role}, 应为 ${ROLE_LIST.join("/")}`);
  }
  return role;
}

export function canViewSensitiveReports(role) {
  return role === ROLES.HANDLER;
}

export function isSensitiveEvent(event) {
  return event.category === "report" && event.sensitive !== false;
}

/** 按角色过滤时间线: 敏感举报仅经办可见 */
export function viewTimeline(events, role) {
  assertRole(role);
  const visible = canViewSensitiveReports(role)
    ? events
    : events.filter((e) => !isSensitiveEvent(e));
  return visible.map((e) => ({ ...e }));
}
