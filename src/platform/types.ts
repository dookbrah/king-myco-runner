import { PlannedRun, PlayerProfile, SessionTelemetry } from "../types";

export type EcosystemSource =
  | "mycokingdom_bot"
  | "mycoai_bot"
  | "kingdom.kingmyco.com"
  | "kingmyco.io"
  | "openclaw";

export interface IdentityClaims {
  walletAddress?: string;
  telegramUserId?: string;
  kingdomAccountId?: string;
  openClawPlayerId?: string;
  mycoAiUserId?: string;
}

export interface LinkedIdentity {
  source: EcosystemSource;
  externalId: string;
  linkedAt: string;
}

export interface PlayerWallet {
  spores: number;
  lifetimeSpores: number;
  sessionStreak: number;
  suspiciousSessions: number;
  lastSessionAt?: string;
}

export interface RewardBreakdown {
  baseSpores: number;
  difficultyBonus: number;
  streakMultiplier: number;
  sourceMultiplier: number;
  laneMultiplier: number;
  noveltyMultiplier: number;
  antiGrindPenalty: number;
  awardedSpores: number;
}

export interface FraudDecision {
  flagged: boolean;
  riskScore: number;
  reasons: string[];
  fingerprint: string;
}

export interface LeaderboardEntry {
  playerId: string;
  mode: string;
  score: number;
  source: EcosystemSource;
  timestamp: string;
  flagged: boolean;
}

export interface LeaderboardTable {
  entries: LeaderboardEntry[];
  quarantined: LeaderboardEntry[];
}

export interface IdentityLinkRequest {
  source: EcosystemSource;
  externalId: string;
  claims?: IdentityClaims;
}

export interface RunGenerationRequest extends IdentityLinkRequest {
  seed?: string;
  encounters?: number;
}

export interface SessionIngestRequest extends IdentityLinkRequest {
  mode?: string;
  score?: number;
  telemetry: SessionTelemetry;
}

export interface SessionReceipt {
  playerId: string;
  mode: string;
  score: number;
  fraud: FraudDecision;
  rewards: RewardBreakdown;
  wallet: PlayerWallet;
  profile: PlayerProfile;
}

export interface PlayerSnapshot {
  playerId: string;
  identities: LinkedIdentity[];
  profile: PlayerProfile;
  wallet: PlayerWallet;
  lastRun?: PlannedRun;
}

export interface CoachingRequest extends IdentityLinkRequest {
  prompt?: string;
}

export interface CoachingResponse {
  playerId: string;
  focusLane: string;
  recommendations: string[];
  response: string;
}
