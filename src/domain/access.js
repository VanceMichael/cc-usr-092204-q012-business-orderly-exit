// 时间线可见性：敏感举报仅向经办角色开放，其余角色（申请人、利害关系人、审计）
// 在时间线投影中完全看不到该类事件。
export const ROLE = {
  APPLICANT: "applicant",
  INTERESTED_PARTY: "interested_party",
  HANDLER: "case_handler",
  AUDITOR: "auditor",
};

const HANDLER_ONLY_TYPES = new Set(["sensitive_report"]);

export function projectEvents(events, role) {
  if (role === ROLE.HANDLER) return events;
  return events.filter((e) => !HANDLER_ONLY_TYPES.has(e.type));
}
