import { setTimeout as sleep } from "node:timers/promises";
import { KingMycoEcosystemHub } from "../platform/ecosystemHub";

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

const start = async (): Promise<void> => {
  const statePath = process.env.KINGMYCO_STATE_PATH ?? "data/kingmyco-state.json";
  const hub = await KingMycoEcosystemHub.create(statePath);

  const pollMs = parsePositiveInt(process.env.KINGMYCO_SETTLEMENT_POLL_MS, 7000);
  const preparedBatch = parsePositiveInt(
    process.env.KINGMYCO_SETTLEMENT_PREPARED_BATCH,
    15,
  );
  const submittedBatch = parsePositiveInt(
    process.env.KINGMYCO_SETTLEMENT_SUBMITTED_BATCH,
    30,
  );
  const dryRun = parseBoolean(process.env.KINGMYCO_SETTLEMENT_DRY_RUN, false);

  let shouldStop = false;

  process.on("SIGINT", () => {
    shouldStop = true;
  });
  process.on("SIGTERM", () => {
    shouldStop = true;
  });

  // eslint-disable-next-line no-console
  console.log(
    `Settlement worker started (poll=${pollMs}ms, preparedBatch=${preparedBatch}, submittedBatch=${submittedBatch}, dryRun=${dryRun})`,
  );

  while (!shouldStop) {
    try {
      const summary = await hub.processTransferQueues({
        preparedLimit: preparedBatch,
        submittedLimit: submittedBatch,
        dryRun,
      });

      const hasWork = summary.preparedChecked > 0 || summary.submittedChecked > 0;
      if (hasWork) {
        // eslint-disable-next-line no-console
        console.log(`Settlement tick summary: ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(`Settlement worker iteration failed: ${message}`);
    }

    await sleep(pollMs);
  }

  // eslint-disable-next-line no-console
  console.log("Settlement worker stopped");
};

void start();
