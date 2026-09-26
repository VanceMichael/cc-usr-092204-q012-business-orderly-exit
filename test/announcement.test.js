import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnnouncement,
  addPause,
  closePause,
  elapsedDays,
  remainingDays,
  isComplete,
  deadline,
} from "../src/domain/announcement.js";

const NO_HOLIDAYS = new Set();

test("公告期自发布次日起算, 无暂停无节假日时按期届满", () => {
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  assert.equal(deadline(a, NO_HOLIDAYS), "2026-03-07");
  assert.equal(elapsedDays(a, "2026-03-05", NO_HOLIDAYS), 3);
  assert.equal(remainingDays(a, "2026-03-05", NO_HOLIDAYS), 2);
  assert.equal(isComplete(a, "2026-03-06", NO_HOLIDAYS), false);
  assert.equal(isComplete(a, "2026-03-07", NO_HOLIDAYS), true);
});

test("公告期跨节假日时暂停计时, 届满日相应顺延", () => {
  const holidays = new Set(["2026-03-04", "2026-03-05"]);
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  assert.equal(deadline(a, holidays), "2026-03-09");
  assert.equal(elapsedDays(a, "2026-03-05", holidays), 1);
});

test("补正期间暂停计时(含起止日)", () => {
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  addPause(a, { reason: "补正", from: "2026-03-03", to: "2026-03-05" });
  // 03-03~03-05 不计入, 计入日为 06,07,08,09,10
  assert.equal(deadline(a, NO_HOLIDAYS), "2026-03-10");
});

test("重叠暂停区间只扣除一次", () => {
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  addPause(a, { reason: "补正", from: "2026-03-03", to: "2026-03-05" });
  addPause(a, { reason: "诉讼保全", from: "2026-03-04", to: "2026-03-06" });
  // 非计入日为 03,04,05,06(重叠的 04,05 不重复扣)
  assert.equal(deadline(a, NO_HOLIDAYS), "2026-03-11");
});

test("未结束的暂停使届满日待定, 恢复后重新确定", () => {
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  const pause = addPause(a, { reason: "诉讼保全", from: "2026-03-04" });
  assert.equal(deadline(a, NO_HOLIDAYS), null);
  assert.equal(elapsedDays(a, "2026-03-10", NO_HOLIDAYS), 1);
  closePause(a, pause.id, "2026-03-08");
  // 计入日: 03-03, 03-09, 03-10, 03-11, 03-12
  assert.equal(deadline(a, NO_HOLIDAYS), "2026-03-12");
});

test("诉讼保全通知迟到登记后, 届满日按暂停区间重算", () => {
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  assert.equal(deadline(a, NO_HOLIDAYS), "2026-03-07");
  // 03-09 才收到 03-05 起生效的保全通知
  addPause(a, { reason: "诉讼保全", from: "2026-03-05", to: "2026-03-07" });
  assert.equal(deadline(a, NO_HOLIDAYS), "2026-03-10");
});

test("暂停参数校验", () => {
  const a = createAnnouncement({ id: "A1", kind: "simplified", startDate: "2026-03-02", requiredDays: 5 });
  assert.throws(() => addPause(a, { reason: "其他", from: "2026-03-03" }), /不支持的暂停事由/);
  assert.throws(() => addPause(a, { reason: "补正", from: "2026-03-05", to: "2026-03-03" }), /早于/);
  const pause = addPause(a, { reason: "补正", from: "2026-03-03" });
  assert.throws(() => closePause(a, pause.id, "2026-03-01"), /早于/);
});
