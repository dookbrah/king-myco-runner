import { DEFAULT_LIVE_OPS, LiveOpsConfig } from "./liveOps";
import {
  LeaderboardTable,
  LinkedIdentity,
  PlatformEvent,
  PlayerWallet,
  SolanaRewardTransferIntent,
  SolanaWalletProof,
} from "./types";
import { PlannedRun, PlayerProfile } from "../types";

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
  transferIntents: Record<string, SolanaRewardTransferIntent>;
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
  transferIntents: raw?.transferIntents ?? {},
});
