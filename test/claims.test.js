import test from "node:test";
import assert from "node:assert/strict";
import { ClaimRegistry } from "../src/domain/claims.js";

test("重复债权(同债权人同依据)不多占金额", () => {
  const registry = new ClaimRegistry();
  registry.declare({ id: "C1", creditorId: "甲公司", basis: "合同HT-1", amount: 100000, at: "2024-06-01" });
  const dup = registry.declare({ id: "C2", creditorId: "甲公司", basis: "合同HT-1", amount: 100000, at: "2024-06-02" });

  assert.equal(dup.counted, false);
  assert.equal(dup.duplicateOf, "C1");
  assert.equal(registry.outstandingTotal, 100000);
  assert.equal(registry.summary().duplicates, 1);
  assert.equal(registry.summary().outstandingCount, 1);
});

test("不同依据或不同债权人的申报分别计入", () => {
  const registry = new ClaimRegistry();
  registry.declare({ id: "C1", creditorId: "甲公司", basis: "合同HT-1", amount: 100000, at: "2024-06-01" });
  registry.declare({ id: "C2", creditorId: "甲公司", basis: "合同HT-2", amount: 50000, at: "2024-06-01" });
  registry.declare({ id: "C3", creditorId: "乙公司", basis: "合同HT-1", amount: 30000, at: "2024-06-01" });
  assert.equal(registry.outstandingTotal, 180000);
});

test("撤回后不再占用金额, 重复件不自动转有效", () => {
  const registry = new ClaimRegistry();
  registry.declare({ id: "C1", creditorId: "甲公司", basis: "合同HT-1", amount: 100000, at: "2024-06-01" });
  registry.declare({ id: "C2", creditorId: "甲公司", basis: "合同HT-1", amount: 100000, at: "2024-06-02" });
  registry.withdraw("C1");
  assert.equal(registry.outstandingTotal, 0);
  assert.equal(registry.get("C2").counted, false);
});

test("驳回的债权不计入", () => {
  const registry = new ClaimRegistry();
  registry.declare({ id: "C1", creditorId: "甲公司", basis: "HT-1", amount: 80000, at: "2024-06-01" });
  registry.reject("C1");
  assert.equal(registry.outstandingTotal, 0);
});

test("金额必须为正数, 债权人与依据必填", () => {
  const registry = new ClaimRegistry();
  assert.throws(() => registry.declare({ id: "C1", creditorId: "甲", basis: "HT-1", amount: 0, at: "2024-06-01" }), /正数/);
  assert.throws(() => registry.declare({ id: "C2", creditorId: "甲", basis: "HT-1", amount: -5, at: "2024-06-01" }), /正数/);
  assert.throws(() => registry.declare({ id: "C3", creditorId: "", basis: "HT-1", amount: 1, at: "2024-06-01" }), /债权人/);
  assert.throws(() => registry.declare({ id: "C4", creditorId: "甲", basis: "", amount: 1, at: "2024-06-01" }), /依据/);
});
