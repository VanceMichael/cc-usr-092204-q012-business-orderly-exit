import test from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server.js";
import { ExitService } from "../src/service.js";
import { TEST_LAW_VERSIONS } from "./support.js";

async function withServer(run) {
  const service = new ExitService({ lawVersions: TEST_LAW_VERSIONS, holidays: [] });
  const server = buildServer(service);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, path, body, role) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
    body: JSON.stringify(body ?? {}),
  });

test("HTTP 接口: 健康检查与领域资料", async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.status, "ok");
    const context = await fetch(`${base}/context`).then((r) => r.json());
    assert.equal(context.project, "经营主体有序退出");
    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
  });
});

test("HTTP 接口: 立案、推进、期限查询与结论校验", async () => {
  await withServer(async (base) => {
    const created = await post(base, "/cases", {
      caseId: "HTTP-1", entityType: "company", procedure: "简易退出",
      appliedAt: "2024-06-01", applicant: "张某",
    });
    assert.equal(created.status, 201);

    await post(base, "/cases/HTTP-1/transitions", { target: "审查", at: "2024-06-02" });
    await post(base, "/cases/HTTP-1/transitions", { target: "公告中", at: "2024-06-03" });

    // 公告期未届满 → 409 并携带理由
    const early = await post(base, "/cases/HTTP-1/transitions", { target: "决定", at: "2024-06-05" });
    assert.equal(early.status, 409);
    const earlyBody = await early.json();
    assert.ok(earlyBody.reasons.some((r) => r.includes("公告期未届满")));

    // 各角色期限一致
    const applicant = await fetch(`${base}/cases/HTTP-1?role=申请人&asOf=2024-06-05`).then((r) => r.json());
    const handler = await fetch(`${base}/cases/HTTP-1?role=经办人&asOf=2024-06-05`).then((r) => r.json());
    assert.deepEqual(applicant.deadlines, handler.deadlines);
    assert.equal(applicant.deadlines.deadline, "2024-06-08");

    // 敏感举报仅经办可见
    await post(base, "/cases/HTTP-1/events", { category: "report", content: "敏感线索", at: "2024-06-04" });
    const publicView = await fetch(`${base}/cases/HTTP-1?role=利害关系人&asOf=2024-06-05`).then((r) => r.json());
    assert.equal(publicView.timeline.filter((e) => e.category === "report").length, 0);

    const done = await post(base, "/cases/HTTP-1/transitions", { target: "决定", at: "2024-06-08" });
    assert.equal(done.status, 200);
    await post(base, "/cases/HTTP-1/transitions", { target: "已退出", at: "2024-06-09" });

    const conclusion = await fetch(`${base}/cases/HTTP-1/conclusion`).then((r) => r.json());
    assert.equal(conclusion.outcome, "已退出");
    const verify = await fetch(`${base}/cases/HTTP-1/conclusion/verify`).then((r) => r.json());
    assert.equal(verify.consistent, true);
  });
});

test("HTTP 接口: 债权申报与重复件标记", async () => {
  await withServer(async (base) => {
    await post(base, "/cases", {
      caseId: "HTTP-2", entityType: "company", procedure: "主动注销",
      appliedAt: "2024-06-01", applicant: "张某",
    });
    const first = await post(base, "/cases/HTTP-2/claims", {
      creditorId: "甲公司", basis: "HT-1", amount: 10000, at: "2024-06-02",
    }).then((r) => r.json());
    assert.equal(first.counted, true);
    const dup = await post(base, "/cases/HTTP-2/claims", {
      creditorId: "甲公司", basis: "HT-1", amount: 10000, at: "2024-06-03",
    }).then((r) => r.json());
    assert.equal(dup.counted, false);
    assert.equal(dup.duplicateOf, first.id);

    const view = await fetch(`${base}/cases/HTTP-2?role=申请人&asOf=2024-06-03`).then((r) => r.json());
    assert.equal(view.claims.outstandingTotal, 10000);
    assert.equal(view.claims.duplicates, 1);
  });
});
