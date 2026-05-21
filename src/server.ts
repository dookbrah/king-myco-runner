import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { DeepPartial, LiveOpsConfig } from "./platform/liveOps";
import { KingMycoEcosystemHub } from "./platform/ecosystemHub";

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  const data = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(data);
};

const readBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  const merged = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(merged) as T;
};

const requiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field: ${fieldName}`);
  }

  return value;
};

const start = async (): Promise<void> => {
  const statePath = process.env.KINGMYCO_STATE_PATH ?? "data/kingmyco-state.json";
  const adminKey = process.env.KINGMYCO_ADMIN_KEY ?? "dev-admin-key";
  const hub = await KingMycoEcosystemHub.create(statePath);

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const parsedUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = parsedUrl.pathname;

      if (method === "GET" && pathname === "/health") {
        return sendJson(response, 200, {
          status: "ok",
          service: "king-myco-ecosystem-hub",
        });
      }

      if (method === "POST" && pathname === "/api/identity/link") {
        const body = await readBody<Record<string, unknown>>(request);
        const snapshot = await hub.linkIdentity({
          source: requiredString(body.source, "source") as never,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
        });

        return sendJson(response, 200, snapshot);
      }

      if (method === "POST" && pathname === "/api/run/generate") {
        const body = await readBody<Record<string, unknown>>(request);
        const snapshot = await hub.generateRun({
          source: requiredString(body.source, "source") as never,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          seed: typeof body.seed === "string" ? body.seed : undefined,
          encounters: typeof body.encounters === "number" ? body.encounters : undefined,
        });

        return sendJson(response, 200, snapshot);
      }

      if (method === "POST" && pathname === "/api/session/record") {
        const body = await readBody<Record<string, unknown>>(request);
        const receipt = await hub.recordSession({
          source: requiredString(body.source, "source") as never,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          mode: typeof body.mode === "string" ? body.mode : undefined,
          score: typeof body.score === "number" ? body.score : undefined,
          telemetry: body.telemetry as never,
        });

        return sendJson(response, 200, receipt);
      }

      if (method === "POST" && pathname === "/api/mycoai/coach") {
        const body = await readBody<Record<string, unknown>>(request);
        const coaching = await hub.generateCoaching({
          source: requiredString(body.source, "source") as never,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          prompt: typeof body.prompt === "string" ? body.prompt : undefined,
        });

        return sendJson(response, 200, coaching);
      }

      if (method === "GET" && pathname === "/api/liveops") {
        return sendJson(response, 200, hub.getLiveOps());
      }

      if (method === "POST" && pathname === "/api/liveops") {
        const incoming = request.headers["x-admin-key"];
        if (incoming !== adminKey) {
          return sendJson(response, 403, {
            error: "forbidden",
            message: "missing or invalid x-admin-key",
          });
        }

        const body = await readBody<DeepPartial<LiveOpsConfig>>(request);
        const config = await hub.updateLiveOps(body);
        return sendJson(response, 200, config);
      }

      const playerMatch = pathname.match(/^\/api\/player\/([^/]+)$/);
      if (method === "GET" && playerMatch) {
        const playerId = decodeURIComponent(playerMatch[1]);
        return sendJson(response, 200, hub.getPlayerSnapshot(playerId));
      }

      const leaderboardMatch = pathname.match(/^\/api\/leaderboard\/([^/]+)$/);
      if (method === "GET" && leaderboardMatch) {
        const mode = decodeURIComponent(leaderboardMatch[1]);
        const includeQuarantined = parsedUrl.searchParams.get("includeQuarantined") === "true";
        return sendJson(response, 200, hub.getLeaderboard(mode, includeQuarantined));
      }

      return sendJson(response, 404, {
        error: "not_found",
        message: `No route for ${method} ${pathname}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      return sendJson(response, 400, {
        error: "bad_request",
        message,
      });
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`King Myco ecosystem hub listening on :${port}`);
  });
};

void start();
