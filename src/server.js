import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { loadContext } from "./catalog.js";
import { rebuildConclusion } from "./domain/case.js";

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url === "/context") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(await loadContext()));
    return;
  }
  if (request.url === "/conclusion") {
    const fixture = JSON.parse(
      await readFile(new URL("../fixtures/case-timeline.json", import.meta.url), "utf8"),
    );
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(rebuildConclusion(fixture.events)));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(8000, "127.0.0.1");
