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

  return sanitizeLiveOpsConfig(merged);
};
