import { ROLE } from "./access.js";

// 通知同源：申请人与利害关系人看到的期限与理由必须一致，
// 因此两类通知由同一份案件状态派生，只允许受众字段不同。
export function buildNotices(state) {
  const base = {
    caseId: state.caseId,
    path: state.path,
    lawVersion: state.lawVersion,
    status: state.status,
    deadline: state.announcement ? state.announcement.end : null,
    reasons: state.reasons.map((r) => r.code),
  };
  return [ROLE.APPLICANT, ROLE.INTERESTED_PARTY].map((audience) => ({ audience, ...base }));
}
