import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { SourceAuthService } from "./platform/auth";
import { KingMycoEcosystemHub } from "./platform/ecosystemHub";
import { DeepPartial, LiveOpsConfig } from "./platform/liveOps";
import {
  ECOSYSTEM_SOURCES,
  EcosystemSource,
  SolanaRewardClaimRequest,
  SolanaRewardTransferRequest,
  SolanaRewardTransferStatusRequest,
  SolanaTransferQueueProcessRequest,
  SolanaWalletChallengeRequest,
  SolanaWalletVerificationRequest,
  SourceScope,
} from "./platform/types";
import { WebhookVerifier } from "./platform/webhookVerifier";

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void => {
  const data = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(data);
};

const sendHtml = (
  response: ServerResponse,
  statusCode: number,
  html: string,
): void => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
};

const getHeader = (
  request: IncomingMessage,
  key: string,
): string | undefined => {
  const value = request.headers[key];

  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
};

const readRawBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return "";
  }

  return Buffer.concat(chunks).toString("utf8");
};

const parseJsonBody = <T>(rawBody: string): T => {
  if (!rawBody) {
    return {} as T;
  }

  return JSON.parse(rawBody) as T;
};

const requiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field: ${fieldName}`);
  }

  return value;
};

const requiredNumber = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected number field: ${fieldName}`);
  }

  return value;
};

const parseSource = (value: unknown): EcosystemSource => {
  const source = requiredString(value, "source");

  if (!ECOSYSTEM_SOURCES.includes(source as EcosystemSource)) {
    throw new Error(`Unsupported source: ${source}`);
  }

  return source as EcosystemSource;
};

const extractClientIp = (request: IncomingMessage): string | undefined => {
  const forwarded = getHeader(request, "x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = getHeader(request, "x-real-ip");
  if (realIp) {
    return realIp;
  }

  const remote = request.socket.remoteAddress;
  if (remote && remote.trim().length > 0) {
    return remote;
  }

  return undefined;
};

const assertAdminKey = (
  request: IncomingMessage,
  adminKey: string,
): void => {
  const incoming = getHeader(request, "x-admin-key");
  if (!incoming || incoming !== adminKey) {
    throw new Error("missing or invalid x-admin-key");
  }
};

const start = async (): Promise<void> => {
  const statePath = process.env.KINGMYCO_STATE_PATH ?? "data/kingmyco-state.json";
  const adminKey = process.env.KINGMYCO_ADMIN_KEY ?? "dev-admin-key";
  const auth = SourceAuthService.fromEnv(process.env.KINGMYCO_SOURCE_AUTH_JSON);
  const verifier = new WebhookVerifier(
    process.env.KINGMYCO_TELEGRAM_WEBHOOK_SECRET,
    process.env.OPENCLAW_WEBHOOK_SECRET,
  );
  const hub = await KingMycoEcosystemHub.create(statePath);

  const authorizeSource = (
    request: IncomingMessage,
    source: EcosystemSource,
    scope: SourceScope,
  ): void => {
    auth.assertAuthorized(source, scope, getHeader(request, "x-source-token"));
  };

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const parsedUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = parsedUrl.pathname;

      if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
        return sendJson(response, 200, {
          status: "ok",
          service: "king-myco-ecosystem-hub",
        });
      }

      if (
        method === "GET" &&
        (pathname === "/dev/myco-quest" || pathname === "/api/dev/myco-quest")
      ) {
        const html = await readFile("public/myco-quest-dev.html", "utf8");
        return sendHtml(response, 200, html);
      }

      if (method === "POST" && pathname === "/api/identity/link") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "identity:write");

        const snapshot = await hub.linkIdentity({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
        });

        return sendJson(response, 200, snapshot);
      }

      if (method === "POST" && pathname === "/api/run/generate") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "run:generate");

        const snapshot = await hub.generateRun({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          seed: typeof body.seed === "string" ? body.seed : undefined,
          encounters:
            typeof body.encounters === "number" ? body.encounters : undefined,
        });

        return sendJson(response, 200, snapshot);
      }

      if (method === "POST" && pathname === "/api/session/record") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "session:write");

        const receipt = await hub.recordSession({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          mode: typeof body.mode === "string" ? body.mode : undefined,
          score: typeof body.score === "number" ? body.score : undefined,
          telemetry: body.telemetry as never,
        });

        return sendJson(response, 200, receipt);
      }

      if (method === "POST" && pathname === "/api/mycoai/coach") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "coach:read");

        const coaching = await hub.generateCoaching({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          prompt: typeof body.prompt === "string" ? body.prompt : undefined,
        });

        return sendJson(response, 200, coaching);
      }

      if (method === "POST" && pathname === "/api/solana/challenge") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "solana:verify");

        const challenge = await hub.createSolanaWalletChallenge({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          walletAddress: requiredString(body.walletAddress, "walletAddress"),
        } satisfies SolanaWalletChallengeRequest);

        return sendJson(response, 200, challenge);
      }

      if (method === "POST" && pathname === "/api/solana/verify-link") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "solana:verify");

        const result = await hub.verifySolanaWalletLink({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          walletAddress: requiredString(body.walletAddress, "walletAddress"),
          message: requiredString(body.message, "message"),
          signature: requiredString(body.signature, "signature"),
        } satisfies SolanaWalletVerificationRequest);

        return sendJson(response, 200, result);
      }

      const solanaWalletMatch = pathname.match(/^\/api\/solana\/wallet\/([^/]+)$/);
      if (method === "GET" && solanaWalletMatch) {
        const walletAddress = decodeURIComponent(solanaWalletMatch[1]);
        const snapshot = await hub.getSolanaWalletSnapshot(walletAddress);
        return sendJson(response, 200, snapshot);
      }

      if (method === "GET" && pathname === "/api/solana/rewards/intents") {
        assertAdminKey(request, adminKey);

        const statusRaw = parsedUrl.searchParams.get("status");
        const status =
          statusRaw === "prepared" ||
          statusRaw === "submitted" ||
          statusRaw === "settled" ||
          statusRaw === "failed"
            ? statusRaw
            : undefined;
        const playerId = parsedUrl.searchParams.get("playerId") ?? undefined;
        const limitRaw = parsedUrl.searchParams.get("limit");
        const limit =
          limitRaw && Number.isFinite(Number(limitRaw))
            ? Number(limitRaw)
            : undefined;

        const intents = hub.getTransferIntents({
          status,
          playerId,
          limit,
        });
        return sendJson(response, 200, { intents });
      }

      if (method === "POST" && pathname === "/api/solana/rewards/claim") {
        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "solana:reward:prepare");

        const receipt = await hub.claimSolanaRewards({
          source,
          externalId: requiredString(body.externalId, "externalId"),
          claims: (body.claims ?? {}) as never,
          destinationWallet: requiredString(body.destinationWallet, "destinationWallet"),
          sporesToRedeem: requiredNumber(body.sporesToRedeem, "sporesToRedeem"),
          memo: typeof body.memo === "string" ? body.memo : undefined,
          idempotencyKey:
            typeof body.idempotencyKey === "string"
              ? body.idempotencyKey
              : getHeader(request, "x-idempotency-key"),
          clientIp:
            typeof body.clientIp === "string" && body.clientIp.trim().length > 0
              ? body.clientIp
              : extractClientIp(request),
          clientFingerprint:
            typeof body.clientFingerprint === "string"
              ? body.clientFingerprint
              : getHeader(request, "x-client-fingerprint"),
        } satisfies SolanaRewardClaimRequest);

        return sendJson(response, 200, receipt);
      }

      if (method === "POST" && pathname === "/api/solana/rewards/prepare") {
        assertAdminKey(request, adminKey);

        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "solana:reward:prepare");

        const intent = await hub.prepareSolanaRewardTransfer({
          playerId: requiredString(body.playerId, "playerId"),
          source,
          destinationWallet: requiredString(
            body.destinationWallet,
            "destinationWallet",
          ),
          lamports: Number(body.lamports),
          sporesDebited:
            typeof body.sporesDebited === "number"
              ? body.sporesDebited
              : undefined,
          mycoBurned:
            typeof body.mycoBurned === "number"
              ? body.mycoBurned
              : undefined,
          memo: typeof body.memo === "string" ? body.memo : undefined,
        } satisfies SolanaRewardTransferRequest);

        return sendJson(response, 200, intent);
      }

      if (method === "POST" && pathname === "/api/solana/rewards/process") {
        assertAdminKey(request, adminKey);

        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const summary = await hub.processTransferQueues({
          preparedLimit:
            typeof body.preparedLimit === "number" ? body.preparedLimit : undefined,
          submittedLimit:
            typeof body.submittedLimit === "number" ? body.submittedLimit : undefined,
          dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
        } satisfies SolanaTransferQueueProcessRequest);

        return sendJson(response, 200, summary);
      }

      if (method === "POST" && pathname === "/api/solana/rewards/status") {
        assertAdminKey(request, adminKey);

        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const source = parseSource(body.source);
        authorizeSource(request, source, "solana:reward:update");

        const receipt = await hub.updateSolanaRewardTransferStatus({
          intentId: requiredString(body.intentId, "intentId"),
          status: requiredString(body.status, "status") as "submitted" | "settled" | "failed",
          txSignature:
            typeof body.txSignature === "string" ? body.txSignature : undefined,
          failureReason:
            typeof body.failureReason === "string" ? body.failureReason : undefined,
        } satisfies SolanaRewardTransferStatusRequest);

        return sendJson(response, 200, receipt);
      }

      if (method === "POST" && pathname === "/webhooks/mycokingdom_bot") {
        const rawBody = await readRawBody(request);

        if (
          !verifier.verifyTelegramHeader(
            request.headers["x-telegram-bot-api-secret-token"],
          )
        ) {
          return sendJson(response, 401, {
            error: "unauthorized",
            message: "invalid telegram webhook secret",
          });
        }

        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const receipt = await hub.ingestWebhookEvent(
          "mycokingdom_bot",
          "telegram_update",
          {
            updateId: body.update_id,
          },
        );
        return sendJson(response, 200, receipt);
      }

      if (method === "POST" && pathname === "/webhooks/mycoai_bot") {
        const rawBody = await readRawBody(request);

        if (
          !verifier.verifyTelegramHeader(
            request.headers["x-telegram-bot-api-secret-token"],
          )
        ) {
          return sendJson(response, 401, {
            error: "unauthorized",
            message: "invalid telegram webhook secret",
          });
        }

        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const receipt = await hub.ingestWebhookEvent(
          "mycoai_bot",
          "telegram_update",
          {
            updateId: body.update_id,
          },
        );
        return sendJson(response, 200, receipt);
      }

      if (method === "POST" && pathname === "/webhooks/openclaw") {
        const rawBody = await readRawBody(request);

        if (
          !verifier.verifyOpenClawSignature(
            rawBody,
            request.headers["x-openclaw-signature"],
            request.headers["x-openclaw-timestamp"],
          )
        ) {
          return sendJson(response, 401, {
            error: "unauthorized",
            message: "invalid openclaw webhook signature",
          });
        }

        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const eventName =
          typeof body.eventName === "string"
            ? body.eventName
            : "openclaw_event";

        const receipt = await hub.ingestWebhookEvent(
          "openclaw",
          eventName,
          {
            metadata: body,
          },
        );
        return sendJson(response, 200, receipt);
      }

      if (method === "GET" && pathname === "/api/liveops") {
        return sendJson(response, 200, hub.getLiveOps());
      }

      if (method === "POST" && pathname === "/api/liveops") {
        assertAdminKey(request, adminKey);

        const rawBody = await readRawBody(request);
        const body = parseJsonBody<DeepPartial<LiveOpsConfig>>(rawBody);
        const config = await hub.updateLiveOps(body);
        return sendJson(response, 200, config);
      }

      if (method === "GET" && pathname === "/api/analytics/summary") {
        assertAdminKey(request, adminKey);
        const limitRaw = parsedUrl.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : 300;
        const summary = await hub.getAnalyticsSummary(
          Number.isFinite(limit) ? limit : 300,
        );
        return sendJson(response, 200, summary);
      }

      if (method === "GET" && pathname === "/api/ecosystem/communication") {
        assertAdminKey(request, adminKey);
        const windowMinutesRaw = parsedUrl.searchParams.get("windowMinutes");
        const minEventsPerSourceRaw = parsedUrl.searchParams.get("minEventsPerSource");
        const limitRaw = parsedUrl.searchParams.get("limit");

        const status = await hub.getEcosystemCommunicationStatus({
          windowMinutes:
            windowMinutesRaw && Number.isFinite(Number(windowMinutesRaw))
              ? Number(windowMinutesRaw)
              : undefined,
          minEventsPerSource:
            minEventsPerSourceRaw && Number.isFinite(Number(minEventsPerSourceRaw))
              ? Number(minEventsPerSourceRaw)
              : undefined,
          limit:
            limitRaw && Number.isFinite(Number(limitRaw))
              ? Number(limitRaw)
              : undefined,
        });

        return sendJson(response, 200, status);
      }

      if (method === "POST" && pathname === "/api/ecosystem/heartbeat/pulse") {
        assertAdminKey(request, adminKey);

        const rawBody = await readRawBody(request);
        const body = parseJsonBody<Record<string, unknown>>(rawBody);
        const sourcesRaw = Array.isArray(body.sources)
          ? body.sources
          : undefined;

        const sources = sourcesRaw
          ? sourcesRaw
              .map((source) => parseSource(source))
          : undefined;

        const receipt = await hub.emitEcosystemHeartbeat({
          sources,
          eventName:
            typeof body.eventName === "string" ? body.eventName : undefined,
          payload:
            body.payload &&
            typeof body.payload === "object" &&
            !Array.isArray(body.payload)
              ? (body.payload as Record<string, unknown>)
              : undefined,
        });

        return sendJson(response, 200, receipt);
      }

      const devHudMatch = pathname.match(/^\/api\/dev\/hud\/([^/]+)$/);
      if (method === "GET" && devHudMatch) {
        assertAdminKey(request, adminKey);
        const playerId = decodeURIComponent(devHudMatch[1]);

        const windowMinutesRaw = parsedUrl.searchParams.get("windowMinutes");
        const minEventsPerSourceRaw = parsedUrl.searchParams.get("minEventsPerSource");
        const limitRaw = parsedUrl.searchParams.get("limit");

        const bundle = await hub.getDevHudBundle({
          playerId,
          windowMinutes:
            windowMinutesRaw && Number.isFinite(Number(windowMinutesRaw))
              ? Number(windowMinutesRaw)
              : undefined,
          minEventsPerSource:
            minEventsPerSourceRaw && Number.isFinite(Number(minEventsPerSourceRaw))
              ? Number(minEventsPerSourceRaw)
              : undefined,
          limit:
            limitRaw && Number.isFinite(Number(limitRaw))
              ? Number(limitRaw)
              : undefined,
        });

        return sendJson(response, 200, bundle);
      }

      const playerMatch = pathname.match(/^\/api\/player\/([^/]+)$/);
      if (method === "GET" && playerMatch) {
        const playerId = decodeURIComponent(playerMatch[1]);
        return sendJson(response, 200, hub.getPlayerSnapshot(playerId));
      }

      const leaderboardMatch = pathname.match(/^\/api\/leaderboard\/([^/]+)$/);
      if (method === "GET" && leaderboardMatch) {
        const mode = decodeURIComponent(leaderboardMatch[1]);
        const includeQuarantined =
          parsedUrl.searchParams.get("includeQuarantined") === "true";
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
