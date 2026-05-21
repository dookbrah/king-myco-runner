import {
  ChallengeLane,
  EncounterBlueprint,
  PlannedEncounter,
  PlannedRun,
  PlayerProfile,
  SessionTelemetry,
} from "../types";
import { createSeededRng, pickOne } from "../engine/random";
import { clamp, roundTo } from "../utils/math";
import { ENCOUNTER_CATALOG } from "../quest/catalog";

interface LaneBanditStats {
  attempts: number;
  cumulativeReward: number;
}

type PlayerBanditState = Record<ChallengeLane, LaneBanditStats>;

const ALL_LANES: ChallengeLane[] = [
  "mobility",
  "swarm",
  "tactics",
  "boss",
  "puzzle",
];

const laneElementMatrix: Record<ChallengeLane, string[]> = {
  mobility: ["water", "ice"],
  swarm: ["fire", "water"],
  tactics: ["ice", "void"],
  boss: ["ice", "void"],
  puzzle: ["water", "nature"],
};

const createBanditState = (): PlayerBanditState => ({
  mobility: { attempts: 0, cumulativeReward: 0 },
  swarm: { attempts: 0, cumulativeReward: 0 },
  tactics: { attempts: 0, cumulativeReward: 0 },
  boss: { attempts: 0, cumulativeReward: 0 },
  puzzle: { attempts: 0, cumulativeReward: 0 },
});

interface RunOptions {
  seed?: string;
  encounters?: number;
}

export class AdaptiveDirector {
  private readonly banditByPlayer = new Map<string, PlayerBanditState>();

  planRun(profile: PlayerProfile, options: RunOptions = {}): PlannedRun {
    const encounterCount = options.encounters ?? 8;
    const seed = options.seed ?? `${profile.playerId}:${profile.sessionsPlayed}`;
    const rng = createSeededRng(seed);
    const state = this.getOrCreateBanditState(profile.playerId);
    const laneUsage: Record<ChallengeLane, number> = {
      mobility: 0,
      swarm: 0,
      tactics: 0,
      boss: 0,
      puzzle: 0,
    };

    const unmasteredElements = profile.unlockedElements.filter(
      (element) => !profile.masteredElements.includes(element),
    );

    const availableBlueprints = ENCOUNTER_CATALOG.filter((blueprint) =>
      blueprint.requiredElements.every((required) =>
        profile.unlockedElements.includes(required),
      ),
    );

    const blueprintPool =
      availableBlueprints.length > 0 ? availableBlueprints : ENCOUNTER_CATALOG;

    const encounters: PlannedEncounter[] = [];

    for (let index = 0; index < encounterCount; index += 1) {
      const lane = this.chooseLane({
        profile,
        state,
        laneUsage,
        unmasteredElements,
        rng,
      });

      laneUsage[lane] += 1;

      const candidates = blueprintPool.filter((blueprint) => blueprint.lane === lane);
      const blueprint = this.chooseBlueprint(candidates, profile, index, encounterCount, rng);
      const targetDifficulty = this.computeTargetDifficulty(profile, index, encounterCount, rng);

      const suggestedLearningObjective = blueprint.teaches.find(
        (element) => !profile.masteredElements.includes(element),
      );

      encounters.push({
        encounterNumber: index + 1,
        lane,
        blueprintId: blueprint.id,
        title: blueprint.title,
        description: blueprint.description,
        requiredElements: blueprint.requiredElements,
        suggestedLearningObjective: suggestedLearningObjective
          ? `Practice ${suggestedLearningObjective.toUpperCase()} mechanics in combat.`
          : undefined,
        targetDifficulty,
        tuning: {
          enemySpeedMultiplier: roundTo(
            clamp(
              0.86 +
                targetDifficulty * 0.085 +
                profile.playstyle.aggression * 0.11,
              0.7,
              1.9,
            ),
          ),
          enemyDensityMultiplier: roundTo(
            clamp(
              0.84 + targetDifficulty * 0.1 + profile.playstyle.risk * 0.18,
              0.7,
              2.2,
            ),
          ),
          projectileRateMultiplier: roundTo(
            clamp(
              0.82 +
                targetDifficulty * 0.09 +
                profile.playstyle.precision * 0.16,
              0.7,
              2,
            ),
          ),
          rewardMultiplier: roundTo(
            clamp(
              0.9 + profile.novelty * 0.32 + (1 - profile.skill) * 0.2,
              0.95,
              1.85,
            ),
          ),
        },
      });
    }

    return {
      playerId: profile.playerId,
      seed,
      encounters,
    };
  }

  recordSessionOutcome(playerId: string, telemetry: SessionTelemetry): void {
    const state = this.getOrCreateBanditState(playerId);

    const totalEncounters = telemetry.completedEncounters + telemetry.failedEncounters;
    const completionRate =
      totalEncounters > 0 ? telemetry.completedEncounters / totalEncounters : 0;
    const resilience = clamp(
      1 - telemetry.damageTaken / (telemetry.completedEncounters * 15 + 15),
    );
    const commitment = clamp(telemetry.sessionLengthSec / 900);
    const retained = telemetry.abandoned ? 0 : 1;

    const reward =
      completionRate * 0.35 + resilience * 0.2 + commitment * 0.2 + retained * 0.25;

    if (telemetry.laneOutcomes) {
      for (const [laneKey, outcome] of Object.entries(telemetry.laneOutcomes)) {
        if (!outcome) {
          continue;
        }

        const lane = laneKey as ChallengeLane;
        const attempts = outcome.wins + outcome.losses;
        if (attempts <= 0) {
          continue;
        }

        const laneReward = reward * (outcome.wins / attempts);
        state[lane].attempts += attempts;
        state[lane].cumulativeReward += laneReward;
      }
      return;
    }

    const share = reward / ALL_LANES.length;
    for (const lane of ALL_LANES) {
      state[lane].attempts += 1;
      state[lane].cumulativeReward += share;
    }
  }

  private chooseLane(input: {
    profile: PlayerProfile;
    state: PlayerBanditState;
    laneUsage: Record<ChallengeLane, number>;
    unmasteredElements: string[];
    rng: () => number;
  }): ChallengeLane {
    const { profile, state, laneUsage, unmasteredElements, rng } = input;
    const totalAttempts = ALL_LANES.reduce(
      (sum, lane) => sum + state[lane].attempts,
      0,
    );

    let bestLane: ChallengeLane = "mobility";
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const lane of ALL_LANES) {
      const laneStats = state[lane];
      const expectedReward =
        laneStats.attempts > 0
          ? laneStats.cumulativeReward / laneStats.attempts
          : 0.55;
      const explorationBonus =
        Math.sqrt(Math.log(totalAttempts + 2) / (laneStats.attempts + 1)) *
        0.26 *
        profile.novelty;
      const styleAffinity = this.getStyleAffinity(profile, lane);
      const learningBoost = laneElementMatrix[lane].some((element) =>
        unmasteredElements.includes(element as never),
      )
        ? 0.12
        : 0;
      const antiRepeatPenalty = laneUsage[lane] * 0.14;
      const jitter = (rng() - 0.5) * 0.06;

      const score =
        expectedReward * 0.35 +
        profile.laneMastery[lane] * 0.26 +
        styleAffinity * 0.28 +
        explorationBonus +
        learningBoost -
        antiRepeatPenalty +
        jitter;

      if (score > bestScore) {
        bestScore = score;
        bestLane = lane;
      }
    }

    return bestLane;
  }

  private chooseBlueprint(
    candidates: EncounterBlueprint[],
    profile: PlayerProfile,
    index: number,
    encounterCount: number,
    rng: () => number,
  ): EncounterBlueprint {
    if (candidates.length === 0) {
      throw new Error("No encounter candidates found for selected lane");
    }

    const target = this.computeTargetDifficulty(profile, index, encounterCount, rng);
    const weighted = candidates.map((candidate) => {
      const diffDistance = Math.abs(candidate.baseDifficulty - target);
      const noveltyBonus = candidate.teaches.some(
        (element) => !profile.masteredElements.includes(element),
      )
        ? profile.novelty * 0.25
        : 0;

      return {
        candidate,
        weight: 1 / (1 + diffDistance) + noveltyBonus + candidate.rewardWeight * 0.2,
      };
    });

    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    let threshold = rng() * totalWeight;

    for (const item of weighted) {
      threshold -= item.weight;
      if (threshold <= 0) {
        return item.candidate;
      }
    }

    return weighted[weighted.length - 1].candidate;
  }

  private computeTargetDifficulty(
    profile: PlayerProfile,
    index: number,
    encounterCount: number,
    rng: () => number,
  ): number {
    const arcProgress = (index + 1) / encounterCount;
    const base = 2 + profile.skill * 5.8 + arcProgress * 2.2 + profile.novelty * 0.8;
    const jitter = (rng() - 0.5) * 0.8;
    return roundTo(clamp(base + jitter, 1, 10));
  }

  private getStyleAffinity(profile: PlayerProfile, lane: ChallengeLane): number {
    const style = profile.playstyle;

    switch (lane) {
      case "mobility":
        return style.explorer * 0.55 + style.risk * 0.45;
      case "swarm":
        return style.aggression * 0.65 + style.risk * 0.35;
      case "tactics":
        return style.precision * 0.6 + style.explorer * 0.4;
      case "boss":
        return style.precision * 0.45 + style.aggression * 0.55;
      case "puzzle":
        return style.explorer * 0.7 + (1 - style.risk) * 0.3;
      default:
        return 0.5;
    }
  }

  private getOrCreateBanditState(playerId: string): PlayerBanditState {
    const existing = this.banditByPlayer.get(playerId);
    if (existing) {
      return existing;
    }

    const created = createBanditState();
    this.banditByPlayer.set(playerId, created);
    return created;
  }
}
