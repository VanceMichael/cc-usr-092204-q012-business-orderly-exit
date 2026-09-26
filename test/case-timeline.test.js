import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { projectEvents, ROLE } from "../src/domain/access.js";
import { rebuildConclusion } from "../src/domain/case.js";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/case-timeline.json", import.meta.url), "utf8"),
);

test("样例时间线可重建退出结论", () => {
  const conclusion = rebuildConclusion(fixture.events);
  assert.equal(conclusion.caseId, "CASE-2026-0001");
  assert.equal(conclusion.lawVersion, "2024-规"); // 申请时有效版本
  assert.equal(conclusion.status, "exited");
  assert.equal(conclusion.announcement.end, "2026-03-27"); // 补正中止 3 天
  assert.equal(conclusion.claims.recognizedTotal, 0); // 唯一登记债权已撤回
  assert.equal(conclusion.claims.duplicatesRejected, 1); // 重复申报未多占
  assert.equal(conclusion.objections.overruled, 1);
  assert.equal(conclusion.notices.length, 2);
  assert.equal(conclusion.evidence.length, 1);
});

test("样例中的敏感举报仅经办可见", () => {
  assert.ok(fixture.events.some((e) => e.type === "sensitive_report"));
  assert.ok(projectEvents(fixture.events, ROLE.INTERESTED_PARTY).every((e) => e.type !== "sensitive_report"));
  assert.ok(projectEvents(fixture.events, ROLE.HANDLER).some((e) => e.type === "sensitive_report"));
});
