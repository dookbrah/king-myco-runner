import { createHash } from "node:crypto";
import { PlayerProfile, SessionTelemetry } from "../types";
import { clamp } from "../utils/math";
import { LiveOpsConfig } from "./liveOps";
import { FraudDecision, PlayerWallet } from "./types";

interface FraudInput {
  telemetry: SessionTelemetry;
  score: number;
  profile: PlayerProfile;
  wallet: PlayerWallet;
  liveOps: LiveOpsConfig;
  seenFingerprint: boolean;
}

const laneOutcomeSignature = (telemetry: SessionTelemetry): string => {
  if (!telemetry.laneOutcomes) {
    return "none";
  }

  return Object.entries(telemetry.laneOutcomes)
    .map(([lane, outcome]) => `${lane}:${outcome?.wins ?? 0}-${outcome?.losses ?? 0}`)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
};

export class FraudGuard {
  evaluate(input: FraudInput): FraudDecision {
    const reasons: string[] = [];
    const telemetry = input.telemetry;

    const fingerprint = createHash("sha256")
      .update(
        [
          telemetry.completedEncounters,
          telemetry.failedEncounters,
          telemetry.damageTaken,
          telemetry.perfectActions,
          telemetry.discoveryActions,
          telemetry.riskyActions,
          telemetry.sessionLengthSec,
          telemetry.usedElements.join(","),
          laneOutcomeSignature(telemetry),
          input.score,
        ].join(":"),
      )
      .digest("hex");

    let risk = 0;

    if (telemetry.sessionLengthSec <= 0 || telemetry.completedEncounters < 0) {
      risk += 1;
      reasons.push("invalid-session-payload");
    }

    const totalEncounters = telemetry.completedEncounters + telemetry.failedEncounters;
    if (totalEncounters > 0) {
      const secPerEncounter = telemetry.sessionLengthSec / totalEncounters;
      if (secPerEncounter < 4.2) {
        risk += 0.45;
        reasons.push("impossible-clear-speed");
      }
    }

    if (telemetry.perfectActions > telemetry.completedEncounters * 6 + 5) {
      risk += 0.24;
      reasons.push("abnormally-high-perfect-actions");
    }

    if (telemetry.riskyActions > telemetry.completedEncounters * 9 + 8) {
      risk += 0.18;
      reasons.push("abnormally-high-risk-action-count");
    }

    const expectedScoreCap = (telemetry.completedEncounters + 1) * 5500;
    if (input.score > expectedScoreCap) {
      risk += 0.32;
      reasons.push("score-exceeds-expected-cap");
    }

    if (input.seenFingerprint) {
      risk += 0.38;
      reasons.push("repeated-session-fingerprint");
    }

    if (input.wallet.suspiciousSessions >= 3) {
      risk += 0.08;
      reasons.push("account-under-watch");
    }

    const profileDelta = Math.abs(input.profile.skill - 0.5);
    if (profileDelta > 0.4 && telemetry.failedEncounters === 0 && telemetry.damageTaken === 0) {
      risk += 0.1;
      reasons.push("outlier-perfect-session");
    }

    const riskScore = clamp(risk, 0, 1);

    return {
      flagged: riskScore >= input.liveOps.antiExploitThreshold,
      riskScore,
      reasons,
      fingerprint,
    };
  }
}
