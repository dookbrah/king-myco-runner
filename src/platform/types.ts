import { PlannedRun, PlayerProfile, SessionTelemetry } from "../types";

export type EcosystemSource =
  | "mycokingdom_bot"
  | "mycoai_bot"
  | "kingdom.kingmyco.com"
  | "kingmyco.io"
  | "openclaw";

export const ECOSYSTEM_SOURCES: EcosystemSource[] = [
  "mycokingdom_bot",
  "mycoai_bot",
  "kingdom.kingmyco.com",
  "kingmyco.io",
  "openclaw",
];

export type SourceScope =
  | "identity:write"
  | "run:generate"
  | "session:write"
  | "coach:read"
  | "solana:verify"
  | "solana:reward:prepare"
  | "webhook:ingest";

export interface SourceAuthConfig {
  token: string;
  scopes: Array<SourceScope | "*">;
}

export type SourceAuthMap = Partial<Record<EcosystemSource, SourceAuthConfig>>;

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

export type PlatformEventType =
  | "identity_linked"
  | "run_generated"
  | "session_recorded"
  | "coaching_generated"
  | "liveops_updated"
  | "webhook_ingested"
  | "solana_wallet_verified"
  | "reward_intent_prepared";

export interface PlatformEvent {
  id: string;
  type: PlatformEventType;
  timestamp: string;
  source?: EcosystemSource;
  playerId?: string;
  mode?: string;
  payload: Record<string, unknown>;
}

export interface AnalyticsSummary {
  generatedAt: string;
  windowEventCount: number;
  uniquePlayers: number;
  eventBreakdown: Record<PlatformEventType, number>;
  sourceBreakdown: Partial<Record<EcosystemSource, number>>;
  suspiciousSessionRate: number;
  averageSessionScore: number;
}

export interface SolanaWalletProof {
  playerId: string;
  source: EcosystemSource;
  externalId: string;
  walletAddress: string;
  message: string;
  signature: string;
  verified: boolean;
  verifiedAt: string;
}

export interface SolanaWalletSnapshot {
  walletAddress: string;
  lamports: number | null;
  sol: number | null;
  rpcUrl: string;
  rpcReachable: boolean;
  fetchedAt: string;
}

export interface SolanaWalletVerificationRequest extends IdentityLinkRequest {
  walletAddress: string;
  message: string;
  signature: string;
}

export interface SolanaWalletVerificationResponse {
  verified: boolean;
  player: PlayerSnapshot;
  proof: SolanaWalletProof;
  wallet: SolanaWalletSnapshot;
}

export type RewardTransferStatus = "prepared" | "submitted" | "settled" | "failed";

export interface SolanaRewardTransferIntent {
  id: string;
  playerId: string;
  source: EcosystemSource;
  destinationWallet: string;
  treasuryWallet: string;
  lamports: number;
  memo?: string;
  blockhash: string;
  lastValidBlockHeight: number;
  unsignedTransactionBase64: string;
  status: RewardTransferStatus;
  createdAt: string;
}

export interface SolanaRewardTransferRequest {
  playerId: string;
  source: EcosystemSource;
  destinationWallet: string;
  lamports: number;
  memo?: string;
}

export interface WebhookReceipt {
  accepted: boolean;
  source: EcosystemSource;
  eventId: string;
}
