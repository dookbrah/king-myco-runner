export type Element = "fire" | "water" | "ice" | "nature" | "void";
export type NarrativeTone = "light" | "neutral" | "shadow";

export type ChallengeLane =
  | "mobility"
  | "swarm"
  | "tactics"
  | "boss"
  | "puzzle";

export interface PlaystyleVector {
  aggression: number;
  precision: number;
  explorer: number;
  risk: number;
}

export interface MoralityTelemetry {
  compassionateActions?: number;
  ruthlessActions?: number;
}

export interface MagicTelemetry {
  castsByElement?: Partial<Record<Element, number>>;
  ritualsCompleted?: string[];
}

export interface PlayerProfile {
  playerId: string;
  skill: number;
  novelty: number;
  unlockedElements: Element[];
  masteredElements: Element[];
  playstyle: PlaystyleVector;
  laneMastery: Record<ChallengeLane, number>;
  morality: number;
  learnedMagic: string[];
  magicMastery: Record<Element, number>;
  sporesCollected: number;
  sessionsPlayed: number;
  lastUpdatedAt: string;
}

export interface LaneOutcome {
  wins: number;
  losses: number;
}

export interface SessionTelemetry {
  playerId: string;
  completedEncounters: number;
  failedEncounters: number;
  damageTaken: number;
  perfectActions: number;
  discoveryActions: number;
  riskyActions: number;
  sessionLengthSec: number;
  usedElements: Element[];
  abandoned: boolean;
  sporesCollected?: number;
  morality?: MoralityTelemetry;
  magic?: MagicTelemetry;
  laneOutcomes?: Partial<Record<ChallengeLane, LaneOutcome>>;
}

export interface EncounterBlueprint {
  id: string;
  lane: ChallengeLane;
  title: string;
  description: string;
  baseDifficulty: number;
  requiredElements: Element[];
  teaches: Element[];
  rewardWeight: number;
}

export interface EncounterTuning {
  enemySpeedMultiplier: number;
  enemyDensityMultiplier: number;
  projectileRateMultiplier: number;
  rewardMultiplier: number;
}

export interface PlannedEncounter {
  encounterNumber: number;
  lane: ChallengeLane;
  blueprintId: string;
  title: string;
  description: string;
  requiredElements: Element[];
  suggestedLearningObjective?: string;
  narrativeTone?: NarrativeTone;
  suggestedMagicToPractice?: string;
  targetDifficulty: number;
  tuning: EncounterTuning;
}

export interface RunObjective {
  id: string;
  title: string;
  description: string;
  completionHint: string;
  targetLane: ChallengeLane;
  targetElement?: Element;
  minimumLaneWins: number;
  minimumPerfectActions: number;
  rewardBonusSpores: number;
  moralityShift: number;
  narrativeTone: NarrativeTone;
}

export interface PlannedRun {
  playerId: string;
  seed: string;
  encounters: PlannedEncounter[];
  objective?: RunObjective;
}
