// 程序状态机：状态秩单调递增，部门回执等迟到事件只能补充事实，不能让案件倒退。
export const STATUS = {
  FILED: "filed", // 已申请/已立案
  ACCEPTED: "accepted", // 已受理
  ANNOUNCING: "announcing", // 公告中
  DORMANT: "dormant", // 歇业中
  DECIDING: "deciding", // 待决定
  EXITED: "exited", // 已退出（终态）
  TERMINATED: "terminated", // 程序终止（终态：撤回、驳回、恢复经营等）
};

export const RANK = {
  filed: 1,
  accepted: 2,
  announcing: 3,
  dormant: 3,
  deciding: 4,
  exited: 5,
  terminated: 5,
};

export const TERMINAL = new Set([STATUS.EXITED, STATUS.TERMINATED]);

// 只允许沿秩前进；终态不再迁移。
export function canEnter(current, next) {
  if (TERMINAL.has(current)) return false;
  return RANK[next] >= RANK[current];
}

// 四种程序路径
export const PATH = {
  VOLUNTARY: "voluntary", // 主动注销
  SIMPLIFIED: "simplified", // 简易退出
  FORCED: "forced", // 强制退出
  DORMANCY: "dormancy", // 歇业（含恢复）
};
