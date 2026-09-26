import test from "node:test";
import assert from "node:assert/strict";
import { makeService } from "./support.js";
import { NotFoundError } from "../src/service.js";

test("窗口积压场景: 失联欠税主体的强制退出被阻断并给出一致理由", () => {
  const service = makeService();
  service.openCase({ caseId: "A", entityType: "company", procedure: "强制退出", appliedAt: "2024-06-01", applicant: "监管窗口" });
  service.record("A", "annualReport", { year: 2022, filed: false }, "2024-06-01");
  service.record("A", "annualReport", { year: 2023, filed: false }, "2024-06-01");
  service.record("A", "contact", { channel: "信函", result: "失联" }, "2024-06-01");
  service.record("A", "taxSocial", { taxStatus: "非正常", wageArrears: 48000 }, "2024-06-01");
  service.transition("A", "审查", { at: "2024-06-02" });
  assert.throws(() => service.transition("A", "公告中", { at: "2024-06-03" }), /欠税或欠薪/);

  // 申请人与利害关系人看到相同的理由
  const applicant = service.view("A", "申请人", "2024-06-03");
  const interested = service.view("A", "利害关系人", "2024-06-03");
  assert.deepEqual(applicant.reasons, interested.reasons);
  assert.ok(applicant.reasons.some((r) => r.includes("欠税或欠薪")));
});

test("窗口积压场景: 暂时停业主体歇业后恢复, 真实经营者不受影响", () => {
  const service = makeService();
  service.openCase({ caseId: "B", entityType: "company", procedure: "歇业", appliedAt: "2024-06-01", applicant: "创业者陈某" });
  service.transition("B", "歇业中", { at: "2024-06-02" });
  service.transition("B", "已恢复", { at: "2024-08-01" });
  assert.equal(service.view("B", "申请人", "2024-08-01").stage, "已恢复");
});

test("案件编号唯一, 缺失案件抛 NotFoundError", () => {
  const service = makeService();
  service.openCase({ caseId: "C", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  assert.throws(
    () => service.openCase({ caseId: "C", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" }),
    /已存在/,
  );
  assert.throws(() => service.getCase("NOPE"), (err) => {
    assert.ok(err instanceof NotFoundError);
    return true;
  });
});

test("导出的事件流是副本, 外部改动不影响案卷", () => {
  const service = makeService();
  service.openCase({ caseId: "D", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  const events = service.exportEvents("D");
  events.splice(0, events.length);
  assert.ok(service.exportEvents("D").length > 0);
});

test("进行中的案件同样可通过结论校验", () => {
  const service = makeService();
  service.openCase({ caseId: "E", entityType: "company", procedure: "简易退出", appliedAt: "2024-06-01", applicant: "张某" });
  service.transition("E", "审查", { at: "2024-06-02" });
  const result = service.verifyConclusion("E");
  assert.equal(result.consistent, true);
  assert.equal(result.conclusion.outcome, "审查");
});
