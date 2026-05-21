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
import { PlannedRun, PlayerProfile } from "../types";

export interface SporeClaimLedger {
  lastClaimAt?: string;
  dailyRedeemed: Record<string, number>;
}

export interface ClaimVelocityState {
  walletClaimTimestamps: Record<string, string[]>;
  ipClaimTimestamps: Record<string, string[]>;
  ipWalletDaily: Record<string, string[]>;
}

export interface PersistentState {
  profiles: Record<string, PlayerProfile>;
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
  wallets: raw?.wallets ?? {},
  identityByKey: raw?.identityByKey ?? {},
  identitiesByPlayer: raw?.identitiesByPlayer ?? {},
  leaderboards: raw?.leaderboards ?? {},
  liveOps: raw?.liveOps ?? DEFAULT_LIVE_OPS,
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
});
