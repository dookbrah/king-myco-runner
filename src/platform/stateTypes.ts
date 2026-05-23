import { DEFAULT_LIVE_OPS, LiveOpsConfig } from "./liveOps";
import {
  LeaderboardTable,
  LinkedIdentity,
  PlatformEvent,
  PlayerWallet,
  SolanaClaimIdempotencyRecord,
  SolanaRewardTransferIntent,
  SolanaWalletChallenge,
  SolanaWalletProof,
} from "./types";
import { PlannedRun, PlayerCampaignState, PlayerProfile } from "../types";

export interface SporeClaimLedger {
  lastClaimAt?: string;
  dailyRedeemed: Record<string, number>;
}

export interface ClaimVelocityState {
  walletClaimTimestamps: Record<string, string[]>;
  ipClaimTimestamps: Record<string, string[]>;
  ipWalletDaily: Record<string, string[]>;
}

export interface RiskScoreRecord {
  score: number;
  lastUpdatedAt: string;
}

export interface AdaptiveRiskState {
  playerScores: Record<string, RiskScoreRecord>;
  ipScores: Record<string, RiskScoreRecord>;
}

export interface BurnPitEventRecord {
  id: string;
  timestamp: string;
  dayKey: string;
  sporesBurned: number;
  pitId?: string;
  pitName?: string;
  realmId?: string;
  clanId?: string;
  avatarId?: string;
  sundayWindow?: string;
  sundayTokenBurnAmount?: number;
}

export interface BurnPitLedger {
  totalBurned: number;
  dailyBurned: Record<string, number>;
  lastBurnAt?: string;
  events: BurnPitEventRecord[];
}

export interface PersistentState {
  profiles: Record<string, PlayerProfile>;
  campaigns: Record<string, PlayerCampaignState>;
  wallets: Record<string, PlayerWallet>;
  identityByKey: Record<string, string>;
  identitiesByPlayer: Record<string, LinkedIdentity[]>;
  leaderboards: Record<string, LeaderboardTable>;
  liveOps: LiveOpsConfig;
  recentFingerprints: Record<string, string[]>;
  lastRunByPlayer: Record<string, PlannedRun>;
  events: PlatformEvent[];
  walletProofs: Record<string, SolanaWalletProof>;
  walletChallenges: Record<string, SolanaWalletChallenge>;
  transferIntents: Record<string, SolanaRewardTransferIntent>;
  claimIdempotency: Record<string, SolanaClaimIdempotencyRecord>;
  claimLedgers: Record<string, SporeClaimLedger>;
  claimVelocity: ClaimVelocityState;
  adaptiveRisk: AdaptiveRiskState;
  burnPitLedgers: Record<string, BurnPitLedger>;
}

export const createDefaultWallet = (): PlayerWallet => ({
  spores: 0,
  lifetimeSpores: 0,
  sessionStreak: 0,
  suspiciousSessions: 0,
});

export const emptyLeaderboardTable = (): LeaderboardTable => ({
  entries: [],
  quarantined: [],
});

export const normalizePersistentState = (
  raw: Partial<PersistentState> | null | undefined,
): PersistentState => ({
  profiles: raw?.profiles ?? {},
  campaigns: raw?.campaigns ?? {},
  wallets: raw?.wallets ?? {},
  identityByKey: raw?.identityByKey ?? {},
  identitiesByPlayer: raw?.identitiesByPlayer ?? {},
  leaderboards: raw?.leaderboards ?? {},
  liveOps: {
    ...DEFAULT_LIVE_OPS,
    ...(raw?.liveOps ?? {}),
    sourceMultipliers: {
      ...DEFAULT_LIVE_OPS.sourceMultipliers,
      ...(raw?.liveOps?.sourceMultipliers ?? {}),
    },
    laneRewardMultipliers: {
      ...DEFAULT_LIVE_OPS.laneRewardMultipliers,
      ...(raw?.liveOps?.laneRewardMultipliers ?? {}),
    },
  },
  recentFingerprints: raw?.recentFingerprints ?? {},
  lastRunByPlayer: raw?.lastRunByPlayer ?? {},
  events: raw?.events ?? [],
  walletProofs: raw?.walletProofs ?? {},
  walletChallenges: raw?.walletChallenges ?? {},
  transferIntents: raw?.transferIntents ?? {},
  claimIdempotency: raw?.claimIdempotency ?? {},
  claimLedgers: raw?.claimLedgers ?? {},
  claimVelocity: {
    walletClaimTimestamps: raw?.claimVelocity?.walletClaimTimestamps ?? {},
    ipClaimTimestamps: raw?.claimVelocity?.ipClaimTimestamps ?? {},
    ipWalletDaily: raw?.claimVelocity?.ipWalletDaily ?? {},
  },
  adaptiveRisk: {
    playerScores: raw?.adaptiveRisk?.playerScores ?? {},
    ipScores: raw?.adaptiveRisk?.ipScores ?? {},
  },
  burnPitLedgers: raw?.burnPitLedgers ?? {},
});
