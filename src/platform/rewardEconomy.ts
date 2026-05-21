import { PlayerProfile, SessionTelemetry } from "../types";
import { average, clamp } from "../utils/math";
import { LiveOpsConfig } from "./liveOps";
import { EcosystemSource, PlayerWallet, RewardBreakdown } from "./types";

interface RewardInput {
  profile: PlayerProfile;
  wallet: PlayerWallet;
  telemetry: SessionTelemetry;
  source: EcosystemSource;
  liveOps: LiveOpsConfig;
  score: number;
  recentRunDifficulties: number[];
}

const hoursBetween = (fromIso: string | undefined, to: Date): number | null => {
  if (!fromIso) {
    return null;
  }

  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) {
    return null;
  }

  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
};

const laneRewardMultiplier = (
  telemetry: SessionTelemetry,
  liveOps: LiveOpsConfig,
): number => {
  if (!telemetry.laneOutcomes) {
    return 1;
  }

  let weighted = 0;
  let totalAttempts = 0;

  for (const [lane, outcome] of Object.entries(telemetry.laneOutcomes)) {
    if (!outcome) {
      continue;
    }

    const attempts = outcome.wins + outcome.losses;
    if (attempts <= 0) {
      continue;
    }

    weighted += liveOps.laneRewardMultipliers[lane as keyof typeof liveOps.laneRewardMultipliers] * attempts;
    totalAttempts += attempts;
  }

  if (totalAttempts <= 0) {
    return 1;
  }

  return weighted / totalAttempts;
};

export class RewardEconomy {
  applySessionRewards(input: RewardInput): { wallet: PlayerWallet; breakdown: RewardBreakdown } {
    const now = new Date();
    const previousWallet = input.wallet;
    const hoursSinceSession = hoursBetween(previousWallet.lastSessionAt, now);

    const nextStreak =
      hoursSinceSession === null
        ? 1
        : hoursSinceSession <= 36
          ? previousWallet.sessionStreak + 1
          : 1;

    const streakMultiplier =
      1 +
      Math.min(
        (nextStreak - 1) * input.liveOps.streakBonusStep,
        input.liveOps.streakBonusCap,
      );

    const antiGrindPenalty =
      hoursSinceSession !== null &&
      hoursSinceSession < 0.2 &&
      input.telemetry.sessionLengthSec < 90
        ? 0.65
        : hoursSinceSession !== null && hoursSinceSession < 0.8
          ? 0.85
          : 1;

    const baseSpores = Math.max(
      0,
      Math.round(
        input.telemetry.completedEncounters * 95 +
          input.telemetry.perfectActions * 18 +
          input.telemetry.discoveryActions * 24 +
          input.score * 0.11 -
          input.telemetry.failedEncounters * 45,
      ),
    );

    const averageDifficulty =
      input.recentRunDifficulties.length > 0
        ? average(input.recentRunDifficulties)
        : input.profile.skill * 8;
    const difficultyBonus = Math.round(averageDifficulty * 28);

    const sourceMultiplier = input.liveOps.sourceMultipliers[input.source];
    const laneMultiplier = laneRewardMultiplier(input.telemetry, input.liveOps);
    const noveltyMultiplier = clamp(0.9 + input.profile.novelty * 0.25, 0.85, 1.2);

    const awardedSpores = Math.max(
      0,
      Math.round(
        (baseSpores + difficultyBonus) *
          input.liveOps.rewardMultiplier *
          sourceMultiplier *
          laneMultiplier *
          noveltyMultiplier *
          streakMultiplier *
          antiGrindPenalty,
      ),
    );

    const wallet: PlayerWallet = {
      ...previousWallet,
      spores: previousWallet.spores + awardedSpores,
      lifetimeSpores: previousWallet.lifetimeSpores + awardedSpores,
      sessionStreak: nextStreak,
      lastSessionAt: now.toISOString(),
    };

    return {
      wallet,
      breakdown: {
        baseSpores,
        difficultyBonus,
        streakMultiplier,
        sourceMultiplier,
        laneMultiplier,
        noveltyMultiplier,
        antiGrindPenalty,
        objectiveBonusSpores: 0,
        objectiveCompleted: false,
        objectiveProgress: 0,
        awardedSpores,
      },
    };
  }
}
