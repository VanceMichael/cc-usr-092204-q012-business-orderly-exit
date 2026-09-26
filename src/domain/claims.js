/**
 * 债权申报登记。
 *
 * 核心规则: 重复债权不得多占金额。
 * 同一债权人基于同一债权依据(合同号、判决号等)的再次申报视为重复件:
 * 登记在案但标记 counted=false, 不计入未了结债权总额。
 * 原始件被撤回后, 重复件不自动转有效, 须经办核实后重新申报。
 */
export class ClaimRegistry {
  #claims = new Map();

  declare({ id, creditorId, basis, amount, category = "其他", at }) {
    if (!creditorId) throw new Error("债权人不能为空");
    if (!basis) throw new Error("债权依据不能为空");
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`债权金额必须为正数, 收到: ${amount}`);
    }
    const key = `${creditorId}::${basis}`;
    const original = [...this.#claims.values()].find(
      (c) => c.key === key && c.status !== "已撤回",
    );
    const claim = {
      id,
      key,
      creditorId,
      basis,
      amount,
      category,
      declaredAt: at,
      status: "已申报", // 已申报 | 已确认 | 已驳回 | 已撤回
      counted: !original,
      duplicateOf: original ? original.id : null,
    };
    this.#claims.set(id, claim);
    return claim;
  }

  get(id) {
    const claim = this.#claims.get(id);
    if (!claim) throw new Error(`债权申报不存在: ${id}`);
    return claim;
  }

  withdraw(id) {
    const claim = this.get(id);
    if (claim.status === "已撤回") throw new Error(`债权 ${id} 已撤回`);
    claim.status = "已撤回";
    return claim;
  }

  confirm(id) {
    const claim = this.get(id);
    if (claim.status !== "已申报") throw new Error(`债权 ${id} 当前状态不可确认: ${claim.status}`);
    claim.status = "已确认";
    return claim;
  }

  reject(id) {
    const claim = this.get(id);
    if (claim.status !== "已申报") throw new Error(`债权 ${id} 当前状态不可驳回: ${claim.status}`);
    claim.status = "已驳回";
    claim.counted = false;
    return claim;
  }

  /** 未了结债权: 计入且处于已申报/已确认状态 */
  get outstandingItems() {
    return [...this.#claims.values()].filter(
      (c) => c.counted && (c.status === "已申报" || c.status === "已确认"),
    );
  }

  get outstandingTotal() {
    return this.outstandingItems.reduce((sum, c) => sum + c.amount, 0);
  }

  summary() {
    const all = [...this.#claims.values()];
    return {
      declared: all.length,
      duplicates: all.filter((c) => c.duplicateOf !== null).length,
      outstandingCount: this.outstandingItems.length,
      outstandingTotal: this.outstandingTotal,
    };
  }

  list() {
    return [...this.#claims.values()].map((c) => ({ ...c }));
  }
}
