import { ChallengeLane } from "../types";
import { clamp } from "../utils/math";
import { EcosystemSource } from "./types";

export interface LiveOpsConfig {
  rewardMultiplier: number;
  sourceMultipliers: Record<EcosystemSource, number>;
  laneRewardMultipliers: Record<ChallengeLane, number>;
  antiExploitThreshold: number;
  difficultyMin: number;
  difficultyMax: number;
  streakBonusStep: number;
  streakBonusCap: number;
  sporeToLamportsRate: number;
  minSporesPerClaim: number;
  maxSporesPerClaim: number;
  claimCooldownSec: number;
  maxDailySporeRedeem: number;
  maxClaimsPerHourPerWallet: number;
  maxClaimsPerHourPerIp: number;
  maxUniqueWalletsPerIpPerDay: number;
  riskScoreDecayPerHour: number;
  riskThrottleWeight: number;
  riskHardBlockThreshold: number;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, number>
    ? Partial<T[K]>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export const DEFAULT_LIVE_OPS: LiveOpsConfig = {
  rewardMultiplier: 1,
  sourceMultipliers: {
    mycokingdom_bot: 1,
    mycoai_bot: 0.95,
    "kingdom.kingmyco.com": 1.08,
    "kingmyco.io": 1,
    openclaw: 1.12,
  },
  laneRewardMultipliers: {
    mobility: 1,
    swarm: 1,
    tactics: 1.02,
    boss: 1.08,
    puzzle: 1.04,
  },
  antiExploitThreshold: 0.72,
  difficultyMin: 1,
  difficultyMax: 10,
  streakBonusStep: 0.04,
  streakBonusCap: 0.4,
  sporeToLamportsRate: 120,
  minSporesPerClaim: 100,
  maxSporesPerClaim: 100000,
  claimCooldownSec: 45,
  maxDailySporeRedeem: 250000,
  maxClaimsPerHourPerWallet: 8,
  maxClaimsPerHourPerIp: 20,
  maxUniqueWalletsPerIpPerDay: 6,
  riskScoreDecayPerHour: 0.03,
  riskThrottleWeight: 0.7,
  riskHardBlockThreshold: 0.95,
};

export const sanitizeLiveOpsConfig = (config: LiveOpsConfig): LiveOpsConfig => {
  return {
    rewardMultiplier: clamp(config.rewardMultiplier, 0.2, 4),
    sourceMultipliers: {
      mycokingdom_bot: clamp(config.sourceMultipliers.mycokingdom_bot, 0.4, 3),
      mycoai_bot: clamp(config.sourceMultipliers.mycoai_bot, 0.4, 3),
      "kingdom.kingmyco.com": clamp(
        config.sourceMultipliers["kingdom.kingmyco.com"],
        0.4,
        3,
      ),
      "kingmyco.io": clamp(config.sourceMultipliers["kingmyco.io"], 0.4, 3),
      openclaw: clamp(config.sourceMultipliers.openclaw, 0.4, 3),
    },
    laneRewardMultipliers: {
      mobility: clamp(config.laneRewardMultipliers.mobility, 0.4, 3),
      swarm: clamp(config.laneRewardMultipliers.swarm, 0.4, 3),
      tactics: clamp(config.laneRewardMultipliers.tactics, 0.4, 3),
      boss: clamp(config.laneRewardMultipliers.boss, 0.4, 3),
      puzzle: clamp(config.laneRewardMultipliers.puzzle, 0.4, 3),
    },
    antiExploitThreshold: clamp(config.antiExploitThreshold, 0.4, 0.98),
    difficultyMin: clamp(config.difficultyMin, 1, 10),
    difficultyMax: clamp(config.difficultyMax, 1, 10),
    streakBonusStep: clamp(config.streakBonusStep, 0, 0.2),
    streakBonusCap: clamp(config.streakBonusCap, 0, 1.5),
    sporeToLamportsRate: clamp(config.sporeToLamportsRate, 1, 1000000),
    minSporesPerClaim: Math.round(clamp(config.minSporesPerClaim, 1, 1000000000)),
    maxSporesPerClaim: Math.round(clamp(config.maxSporesPerClaim, 1, 1000000000)),
    claimCooldownSec: Math.round(clamp(config.claimCooldownSec, 0, 86400)),
    maxDailySporeRedeem: Math.round(clamp(config.maxDailySporeRedeem, 1, 1000000000)),
    maxClaimsPerHourPerWallet: Math.round(
      clamp(config.maxClaimsPerHourPerWallet, 1, 10000),
    ),
    maxClaimsPerHourPerIp: Math.round(
      clamp(config.maxClaimsPerHourPerIp, 1, 50000),
    ),
    maxUniqueWalletsPerIpPerDay: Math.round(
      clamp(config.maxUniqueWalletsPerIpPerDay, 1, 5000),
    ),
    riskScoreDecayPerHour: clamp(config.riskScoreDecayPerHour, 0, 1),
    riskThrottleWeight: clamp(config.riskThrottleWeight, 0, 1.5),
    riskHardBlockThreshold: clamp(config.riskHardBlockThreshold, 0.2, 1),
  };
};

export const mergeLiveOpsConfig = (
  current: LiveOpsConfig,
  patch: DeepPartial<LiveOpsConfig>,
): LiveOpsConfig => {
  const merged: LiveOpsConfig = {
    ...current,
    ...patch,
    sourceMultipliers: {
      ...current.sourceMultipliers,
      ...patch.sourceMultipliers,
    },
    laneRewardMultipliers: {
      ...current.laneRewardMultipliers,
      ...patch.laneRewardMultipliers,
    },
  };

  if (merged.difficultyMin > merged.difficultyMax) {
    const swap = merged.difficultyMin;
    merged.difficultyMin = merged.difficultyMax;
    merged.difficultyMax = swap;
  }

  if (merged.minSporesPerClaim > merged.maxSporesPerClaim) {
    const swap = merged.minSporesPerClaim;
    merged.minSporesPerClaim = merged.maxSporesPerClaim;
    merged.maxSporesPerClaim = swap;
  }

  return sanitizeLiveOpsConfig(merged);
};
