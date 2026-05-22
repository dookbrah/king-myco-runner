export type Element = "fire" | "water" | "ice" | "nature" | "void";
export type NarrativeTone = "light" | "neutral" | "shadow";
export type RunObjectiveBranch = "origin" | "ascend" | "recover";

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
  branchDirective?: string;
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
  chainId: string;
  chainStep: number;
  branch: RunObjectiveBranch;
  prerequisiteObjectiveId?: string;
}

export interface RunObjectiveResult {
  objectiveId: string;
  completed: boolean;
  progress: number;
  bonusSporesAwarded: number;
  laneWins: number;
  perfectActions: number;
  recordedAt: string;
}

export interface PlannedRun {
  playerId: string;
  seed: string;
  encounters: PlannedEncounter[];
  objective?: RunObjective;
  objectiveResult?: RunObjectiveResult;
}


export type RegionBiome =
  | "grove"
  | "cavern"
  | "ruins"
  | "wetlands"
  | "void";

export interface RegionDefinition {
  id: string;
  name: string;
  biome: RegionBiome;
  threatLevel: number;
  description: string;
  recommendedElements: Element[];
  connectedRegionIds: string[];
}

export interface PlayerWorldState {
  currentRegionId: string;
  discoveredRegionIds: string[];
  conqueredRegionIds: string[];
  travelHistory: string[];
}

export type TurnActionKind = "strike" | "guard" | "skill";

export interface TurnActionInput {
  kind: TurnActionKind;
  element?: Element;
}

export interface TurnCombatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  guard: number;
  elementAffinity?: Element;
  intentHint?: string;
}

export interface TurnBattleState {
  battleId: string;
  playerId: string;
  regionId: string;
  encounterLane: ChallengeLane;
  status: "active" | "won" | "lost";
  turnNumber: number;
  player: TurnCombatant;
  enemy: TurnCombatant;
  lastAction?: TurnActionInput;
  battleLog: string[];
  startedAt: string;
  updatedAt: string;
  rewardSpores: number;
}

export interface PlayerCampaignState {
  playerId: string;
  world: PlayerWorldState;
  activeBattle?: TurnBattleState;
  victories: number;
  defeats: number;
  lastTravelAt?: string;
}
