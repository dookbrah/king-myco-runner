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
      const prepared = hub.getTransferIntents({
        status: "prepared",
        limit: preparedBatch,
      });
      const submitted = hub.getTransferIntents({
        status: "submitted",
        limit: submittedBatch,
      });

      if (prepared.length === 0 && submitted.length === 0) {
        await sleep(pollMs);
        continue;
      }

      // eslint-disable-next-line no-console
      console.log(
        `Settlement tick: prepared=${prepared.length}, submitted=${submitted.length}`,
      );

      if (!dryRun) {
        for (const intent of prepared) {
          const receipt = await hub.processPreparedTransferIntent(intent.id);
          // eslint-disable-next-line no-console
          console.log(
            `Processed prepared intent ${intent.id}: ${intent.status} -> ${receipt.intent.status}`,
          );
        }

        for (const intent of submitted) {
          const receipt = await hub.reconcileSubmittedTransferIntent(intent.id);
          if (receipt.intent.status !== intent.status) {
            // eslint-disable-next-line no-console
            console.log(
              `Reconciled submitted intent ${intent.id}: ${intent.status} -> ${receipt.intent.status}`,
            );
          }
        }
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
