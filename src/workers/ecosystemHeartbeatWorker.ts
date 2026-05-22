import { setTimeout as sleep } from "node:timers/promises";
import { KingMycoEcosystemHub } from "../platform/ecosystemHub";
import { ECOSYSTEM_SOURCES, EcosystemSource } from "../platform/types";

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

const parseBoolean = (raw: string | undefined, fallback: boolean): boolean => {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
};

const parseHeartbeatSources = (
  raw: string | undefined,
): { sources: EcosystemSource[]; invalid: string[] } => {
  if (!raw || raw.trim().length === 0) {
    return {
      sources: [...ECOSYSTEM_SOURCES],
      invalid: [],
    };
  }

  const requested = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const valid = requested.filter((source): source is EcosystemSource =>
    ECOSYSTEM_SOURCES.includes(source as EcosystemSource),
  );

  const invalid = requested.filter(
    (source) => !ECOSYSTEM_SOURCES.includes(source as EcosystemSource),
  );

  if (valid.length === 0) {
    return {
      sources: [...ECOSYSTEM_SOURCES],
      invalid,
    };
  }

  return {
    sources: Array.from(new Set(valid)),
    invalid,
  };
};

const start = async (): Promise<void> => {
  const statePath = process.env.KINGMYCO_STATE_PATH ?? "data/kingmyco-state.json";
  const hub = await KingMycoEcosystemHub.create(statePath);

  const pollMs = parsePositiveInt(process.env.KINGMYCO_HEARTBEAT_POLL_MS, 60000);
  const dryRun = parseBoolean(process.env.KINGMYCO_HEARTBEAT_DRY_RUN, false);
  const instanceId = process.env.KINGMYCO_HEARTBEAT_INSTANCE ?? "default";
  const sourceConfig = parseHeartbeatSources(process.env.KINGMYCO_HEARTBEAT_SOURCES);
  const heartbeatEventName =
    process.env.KINGMYCO_HEARTBEAT_EVENT_NAME?.trim() || "ecosystem_heartbeat";

  if (sourceConfig.invalid.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `Heartbeat worker ignored unsupported sources: ${sourceConfig.invalid.join(", ")}`,
    );
  }

  let shouldStop = false;

  process.on("SIGINT", () => {
    shouldStop = true;
  });
  process.on("SIGTERM", () => {
    shouldStop = true;
  });

  // eslint-disable-next-line no-console
  console.log(
    `Heartbeat worker started (poll=${pollMs}ms, sources=${sourceConfig.sources.join(",")}, event=${heartbeatEventName}, dryRun=${dryRun}, instance=${instanceId})`,
  );

  while (!shouldStop) {
    try {
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(
          `Heartbeat dry-run tick: ${JSON.stringify({
            sources: sourceConfig.sources,
            eventName: heartbeatEventName,
            instanceId,
          })}`,
        );
      } else {
        const receipt = await hub.emitEcosystemHeartbeat({
          sources: sourceConfig.sources,
          eventName: heartbeatEventName,
          payload: {
            worker: "ecosystem-heartbeat-worker",
            instanceId,
          },
        });

        // eslint-disable-next-line no-console
        console.log(
          `Heartbeat pulse emitted: ${JSON.stringify({
            emittedAt: receipt.emittedAt,
            emittedCount: receipt.emittedCount,
            sources: receipt.sources,
            eventName: receipt.eventName,
          })}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(`Heartbeat worker iteration failed: ${message}`);
    }

    await sleep(pollMs);
  }

  // eslint-disable-next-line no-console
  console.log("Heartbeat worker stopped");
};

void start();
