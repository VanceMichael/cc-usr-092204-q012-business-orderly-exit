import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { loadContext } from "./catalog.js";
import { ExitService, NotFoundError, TransitionError } from "./service.js";

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求体须为 JSON");
  }
}

/**
 * HTTP 入口。保留 /health 与 /context, 案件接口挂在 /cases 下。
 * 角色通过 ?role= 或 x-role 头传入, 默认申请人(最小可见性)。
 */
export function buildServer(service = new ExitService()) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const segments = url.pathname.split("/").filter(Boolean);
    const method = request.method;

    try {
      if (method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (method === "GET" && url.pathname === "/context") {
        sendJson(response, 200, await loadContext());
        return;
      }

      if (segments[0] === "cases") {
        const role = url.searchParams.get("role") ?? request.headers["x-role"] ?? "申请人";
        const asOf = url.searchParams.get("asOf") ?? undefined;

        // POST /cases 立案
        if (method === "POST" && segments.length === 1) {
          const body = await readBody(request);
          const exitCase = service.openCase(body);
          sendJson(response, 201, service.view(exitCase.meta.caseId, role, body.appliedAt));
          return;
        }

        const caseId = segments[1];
        const sub = segments[2];
        const subId = segments[3];

        if (caseId && method === "GET" && segments.length === 2) {
          sendJson(response, 200, service.view(caseId, role, asOf));
          return;
        }
        if (caseId && method === "POST" && sub === "events") {
          const body = await readBody(request);
          const { category, at, ...payload } = body;
          sendJson(response, 201, service.record(caseId, category, payload, at));
          return;
        }
        if (caseId && method === "POST" && sub === "claims" && !subId) {
          sendJson(response, 201, service.declareClaim(caseId, await readBody(request)));
          return;
        }
        if (caseId && method === "POST" && sub === "claims" && subId && segments[4] === "withdraw") {
          const body = await readBody(request);
          sendJson(response, 200, service.withdrawClaim(caseId, subId, body.at));
          return;
        }
        if (caseId && method === "POST" && sub === "objections" && !subId) {
          sendJson(response, 201, service.fileObjection(caseId, await readBody(request)));
          return;
        }
        if (caseId && method === "POST" && sub === "objections" && subId && segments[4] === "ruling") {
          sendJson(response, 200, service.ruleObjection(caseId, subId, await readBody(request)));
          return;
        }
        if (caseId && method === "POST" && sub === "receipts") {
          sendJson(response, 201, service.applyReceipt(caseId, await readBody(request)));
          return;
        }
        if (caseId && method === "POST" && sub === "risk-flags" && subId && segments[4] === "clear") {
          const body = await readBody(request);
          sendJson(response, 200, service.clearRiskFlag(caseId, subId, body.at));
          return;
        }
        if (caseId && method === "POST" && sub === "announcement" && subId === "pause") {
          sendJson(response, 200, service.pauseAnnouncement(caseId, await readBody(request)));
          return;
        }
        if (caseId && method === "POST" && sub === "announcement" && subId === "resume") {
          const body = await readBody(request);
          sendJson(response, 200, service.resumeAnnouncement(caseId, body.at));
          return;
        }
        if (caseId && method === "POST" && sub === "transitions") {
          const body = await readBody(request);
          sendJson(response, 200, service.transition(caseId, body.target, body));
          return;
        }
        if (caseId && method === "GET" && sub === "conclusion" && !subId) {
          sendJson(response, 200, service.conclusion(caseId));
          return;
        }
        if (caseId && method === "GET" && sub === "conclusion" && subId === "verify") {
          sendJson(response, 200, service.verifyConclusion(caseId));
          return;
        }
      }

      sendJson(response, 404, { error: "接口不存在" });
    } catch (error) {
      if (error instanceof NotFoundError) {
        sendJson(response, 404, { error: error.message });
      } else if (error instanceof TransitionError) {
        sendJson(response, 409, { error: error.message, reasons: error.reasons });
      } else {
        sendJson(response, 400, { error: error.message });
      }
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  buildServer().listen(8000, "127.0.0.1", () => {
    console.log("有序退出服务已启动: http://127.0.0.1:8000");
  });
}
