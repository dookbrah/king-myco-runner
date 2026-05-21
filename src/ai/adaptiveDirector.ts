import {
  ChallengeLane,
  Element,
  EncounterBlueprint,
  NarrativeTone,
  PlannedEncounter,
  PlannedRun,
  PlayerProfile,
  RunObjective,
  RunObjectiveResult,
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

const laneElementMatrix: Record<ChallengeLane, Element[]> = {
  mobility: ["water", "ice"],
  swarm: ["fire", "water"],
  tactics: ["ice", "void"],
  boss: ["ice", "void"],
  puzzle: ["water", "nature"],
};

const LIGHT_MORALITY_LANE_AFFINITY: Record<ChallengeLane, number> = {
  mobility: 0.8,
  swarm: 0.35,
  tactics: 0.55,
  boss: 0.3,
  puzzle: 0.9,
};

const SHADOW_MORALITY_LANE_AFFINITY: Record<ChallengeLane, number> = {
  mobility: 0.35,
  swarm: 0.85,
  tactics: 0.7,
  boss: 0.95,
  puzzle: 0.4,
};

interface ObjectiveTemplate {
  title: string;
  description: string;
  completionHint: string;
  moralityShift: number;
}

const OBJECTIVE_TEMPLATES: Record<NarrativeTone, ObjectiveTemplate[]> = {
  light: [
    {
      title: "Lanterns of Mercy",
      description: "Protect living spores from collapse while clearing pressure in the target lane.",
      completionHint: "Chain clean clears and avoid reckless losses to keep sanctuary momentum.",
      moralityShift: 0.08,
    },
    {
      title: "Sanctum Shepherd",
      description: "Stabilize the grove routes before the hive breach cascade begins.",
      completionHint: "Prioritize precise actions and lane wins over risky aggression spikes.",
      moralityShift: 0.06,
    },
  ],
  neutral: [
    {
      title: "Sporeline Calibration",
      description: "Map the target lane and tune your combat rhythm for efficient clears.",
      completionHint: "Balance lane control with technical execution to complete calibration.",
      moralityShift: 0,
    },
    {
      title: "Archive Circuit",
      description: "Complete a controlled trial run to archive stable combat signatures.",
      completionHint: "Keep a steady pace and convert precision into measurable lane control.",
      moralityShift: 0,
    },
  ],
  shadow: [
    {
      title: "Abyssal Tribute",
      description: "Overwhelm resistance in the target lane and harvest unstable spores.",
      completionHint: "Commit to fast eliminations with decisive pressure in every exchange.",
      moralityShift: -0.06,
    },
    {
      title: "Rift Dominance",
      description: "Break enemy morale by forcing repeated victories through a single lane.",
      completionHint: "Maintain aggressive tempo and execute cleanly under escalating threat.",
      moralityShift: -0.08,
    },
  ],
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
  priorRun?: PlannedRun;
}

interface ObjectiveChainContext {
  chainId: string;
  chainStep: number;
  branch: "origin" | "ascend" | "recover";
  prerequisiteObjectiveId?: string;
  targetLane?: ChallengeLane;
  requirementDelta: number;
  rewardMultiplier: number;
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

    const previousObjective = options.priorRun?.objective;
    const previousObjectiveResult = options.priorRun?.objectiveResult;

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
      const suggestedMagicToPractice = this.getSuggestedMagicToPractice(
        profile,
        blueprint.requiredElements,
      );
      const narrativeTone = this.resolveNarrativeTone(profile.morality, rng);

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
        narrativeTone,
        suggestedMagicToPractice,
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
      objective: this.createRunObjective({
        profile,
        laneUsage,
        seed,
        rng,
        previousObjective,
        previousObjectiveResult,
      }),
    };
  }

  private createRunObjective(input: {
    profile: PlayerProfile;
    laneUsage: Record<ChallengeLane, number>;
    seed: string;
    rng: () => number;
    previousObjective?: RunObjective;
    previousObjectiveResult?: RunObjectiveResult;
  }): RunObjective {
    const {
      profile,
      laneUsage,
      seed,
      rng,
      previousObjective,
      previousObjectiveResult,
    } = input;
    const chain = this.resolveObjectiveChainContext({
      seed,
      previousObjective,
      previousObjectiveResult,
    });

    const targetLane =
      chain.targetLane ?? this.chooseObjectiveLane(profile, laneUsage, rng);
    const narrativeTone: NarrativeTone =
      chain.branch === "recover"
        ? "neutral"
        : this.resolveNarrativeTone(profile.morality, rng);
    const template = pickOne(OBJECTIVE_TEMPLATES[narrativeTone], rng);
    const targetElement = this.resolveObjectiveElement(profile, targetLane);

    const baseLaneWins = Math.max(
      1,
      Math.min(3, Math.round(1 + (1 - profile.laneMastery[targetLane]) * 2)),
    );
    const basePerfectActions = Math.max(
      2,
      Math.min(
        8,
        Math.round(2 + profile.skill * 3 + profile.playstyle.precision * 2),
      ),
    );

    const minimumLaneWins = Math.max(
      1,
      Math.min(4, baseLaneWins + chain.requirementDelta),
    );
    const minimumPerfectActions = Math.max(
      2,
      Math.min(10, basePerfectActions + chain.requirementDelta),
    );

    const baseRewardBonus =
      60 +
      (1 - profile.laneMastery[targetLane]) * 85 +
      profile.novelty * 45 +
      minimumLaneWins * 12;
    const rewardBonusSpores = Math.round(baseRewardBonus * chain.rewardMultiplier);

    const branchLabel =
      chain.branch === "origin"
        ? "Genesis"
        : chain.branch === "ascend"
          ? "Ascension"
          : "Recovery";

    return {
      id: `${chain.chainId}:step-${chain.chainStep}:${targetLane}:${narrativeTone}`,
      title: `${branchLabel} Chain ${chain.chainStep}: ${template.title}`,
      description: `${template.description} Secure ${minimumLaneWins} lane wins in ${targetLane}${
        targetElement ? ` while attuning ${targetElement}.` : "."
      }`,
      completionHint: template.completionHint,
      targetLane,
      targetElement,
      minimumLaneWins,
      minimumPerfectActions,
      rewardBonusSpores,
      moralityShift: clamp(
        template.moralityShift * (chain.branch === "recover" ? 0.65 : 1),
        -0.12,
        0.12,
      ),
      narrativeTone,
      chainId: chain.chainId,
      chainStep: chain.chainStep,
      branch: chain.branch,
      prerequisiteObjectiveId: chain.prerequisiteObjectiveId,
    };
  }

  private resolveObjectiveChainContext(input: {
    seed: string;
    previousObjective?: RunObjective;
    previousObjectiveResult?: RunObjectiveResult;
  }): ObjectiveChainContext {
    const { seed, previousObjective, previousObjectiveResult } = input;

    if (
      !previousObjective ||
      !previousObjectiveResult ||
      previousObjectiveResult.objectiveId !== previousObjective.id
    ) {
      return {
        chainId: `${seed}:chain`,
        chainStep: 1,
        branch: "origin",
        requirementDelta: 0,
        rewardMultiplier: 1,
      };
    }

    if (previousObjectiveResult.completed) {
      return {
        chainId: previousObjective.chainId,
        chainStep: Math.max(1, previousObjective.chainStep + 1),
        branch: "ascend",
        prerequisiteObjectiveId: previousObjective.id,
        targetLane: previousObjective.targetLane,
        requirementDelta: 1,
        rewardMultiplier: 1.25,
      };
    }

    return {
      chainId: previousObjective.chainId,
      chainStep: Math.max(1, previousObjective.chainStep),
      branch: "recover",
      prerequisiteObjectiveId: previousObjective.id,
      targetLane: previousObjective.targetLane,
      requirementDelta: -1,
      rewardMultiplier: 0.9,
    };
  }

  private chooseObjectiveLane(
    profile: PlayerProfile,
    laneUsage: Record<ChallengeLane, number>,
    rng: () => number,
  ): ChallengeLane {
    let bestLane: ChallengeLane = "mobility";
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const lane of ALL_LANES) {
      const masteryGap = 1 - profile.laneMastery[lane];
      const styleAffinity = this.getStyleAffinity(profile, lane);
      const moralityAffinity = this.getMoralityLaneAffinity(profile.morality, lane);
      const antiRepeatPenalty = laneUsage[lane] * 0.08;
      const jitter = (rng() - 0.5) * 0.05;

      const score =
        masteryGap * 0.5 +
        styleAffinity * 0.22 +
        moralityAffinity * 0.28 -
        antiRepeatPenalty +
        jitter;

      if (score > bestScore) {
        bestScore = score;
        bestLane = lane;
      }
    }

    return bestLane;
  }

  private resolveObjectiveElement(
    profile: PlayerProfile,
    lane: ChallengeLane,
  ): Element | undefined {
    const laneElements = laneElementMatrix[lane]
      .filter((element) => profile.unlockedElements.includes(element))
      .sort(
        (left, right) =>
          (profile.magicMastery[left] ?? 0) - (profile.magicMastery[right] ?? 0),
      );

    return laneElements[0];
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
    unmasteredElements: Element[];
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
      const moralityAffinity = this.getMoralityLaneAffinity(profile.morality, lane);
      const learningBoost = laneElementMatrix[lane].some((element) =>
        unmasteredElements.includes(element),
      )
        ? 0.12
        : 0;
      const antiRepeatPenalty = laneUsage[lane] * 0.14;
      const jitter = (rng() - 0.5) * 0.06;

      const score =
        expectedReward * 0.32 +
        profile.laneMastery[lane] * 0.24 +
        styleAffinity * 0.24 +
        moralityAffinity * 0.2 +
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
    const moralityIntensity = Math.abs(profile.morality) * 0.35;
    const base =
      2 +
      profile.skill * 5.8 +
      arcProgress * 2.2 +
      profile.novelty * 0.8 +
      moralityIntensity;
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

  private getMoralityLaneAffinity(morality: number, lane: ChallengeLane): number {
    const lightAffinity = LIGHT_MORALITY_LANE_AFFINITY[lane];
    const shadowAffinity = SHADOW_MORALITY_LANE_AFFINITY[lane];
    const normalizedMorality = clamp((morality + 1) / 2, 0, 1);
    return shadowAffinity * (1 - normalizedMorality) + lightAffinity * normalizedMorality;
  }

  private resolveNarrativeTone(
    morality: number,
    rng: () => number,
  ): NarrativeTone {
    const jitteredMorality = morality + (rng() - 0.5) * 0.18;
    if (jitteredMorality >= 0.25) {
      return "light";
    }
    if (jitteredMorality <= -0.25) {
      return "shadow";
    }
    return "neutral";
  }

  private getSuggestedMagicToPractice(
    profile: PlayerProfile,
    requiredElements: Element[],
  ): string | undefined {
    const sortable = requiredElements
      .filter((element) => profile.unlockedElements.includes(element))
      .map((element) => ({
        element,
        mastery: profile.magicMastery[element] ?? 0,
      }))
      .sort((left, right) => left.mastery - right.mastery);

    if (sortable.length === 0) {
      return profile.learnedMagic[0];
    }

    const focusElement = sortable[0].element;
    const spellHint = profile.learnedMagic.find((spell) =>
      spell.startsWith(`${focusElement}-`) || spell.includes(focusElement),
    );

    return spellHint ?? `${focusElement}-attunement`;
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
