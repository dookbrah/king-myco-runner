import { randomBytes, randomUUID } from "node:crypto";
import { AdaptiveDirector } from "../ai/adaptiveDirector";
import { applySessionTelemetry } from "../ai/playerModel";
import {
  PlannedRun,
  PlayerCampaignState,
  RunObjective,
  RunObjectiveResult,
  SessionTelemetry,
} from "../types";
import { startTurnBattle, resolveTurnAction } from "../rpg/turnEngine";
import {
  REGION_CATALOG,
  START_REGION_ID,
  getRegionById,
  travelToRegion,
} from "../rpg/worldMap";
import { average, clamp, roundTo } from "../utils/math";
import { AnalyticsService } from "./analytics";
import { FraudGuard } from "./fraudGuard";
import {
  DEFAULT_LIVE_OPS,
  DeepPartial,
  LiveOpsConfig,
  mergeLiveOpsConfig,
} from "./liveOps";
import { LeaderboardService } from "./leaderboard";
import { KingMycoRepository } from "./repository";
import { RewardEconomy } from "./rewardEconomy";
import { SolanaService } from "./solanaService";
import {
  AnalyticsSummary,
  ECOSYSTEM_SOURCES,
  CoachingRequest,
  CoachingResponse,
  DevHudBundle,
  DevHudBundleRequest,
  EcosystemCommunicationStatus,
  EcosystemHeartbeatPulseReceipt,
  EcosystemSource,
  IdentityLinkRequest,
  PlatformEventType,
  PlayerSnapshot,
  RewardBreakdown,
  RpgBattleReceipt,
  RpgBattleStartRequest,
  RpgBurnPitRecordReceipt,
  RpgBurnPitRecordRequest,
  RpgMapRequest,
  RpgMapSnapshot,
  RpgTravelRequest,
  RpgTurnActionRequest,
  RewardTransferStatus,
  RunGenerationRequest,
  SessionIngestRequest,
  SessionReceipt,
  SolanaRewardClaimReceipt,
  SolanaRewardClaimRequest,
  SolanaTransferQueueProcessRequest,
  SolanaTransferQueueProcessSummary,
  SolanaRewardTransferIntent,
  SolanaRewardTransferRequest,
  SolanaRewardTransferStatusReceipt,
  SolanaRewardTransferStatusRequest,
  SolanaWalletChallenge,
  SolanaWalletChallengeRequest,
  SolanaWalletVerificationRequest,
  SolanaWalletVerificationResponse,
  WebhookReceipt,
} from "./types";

const DEFAULT_MODE = "myco-quest";
const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const BURN_PIT_DAILY_LIMIT = 1000;

const scaleLimitByRisk = (
  baseLimit: number,
  maxRisk: number,
  riskThrottleWeight: number,
): number => {
  const throttleFactor = clamp(1 - maxRisk * riskThrottleWeight, 0.2, 1);
  return Math.max(1, Math.floor(baseLimit * throttleFactor));
};

const riskDeltaFromFraud = (flagged: boolean, riskScore: number): number => {
  if (flagged) {
    return clamp(0.2 + riskScore * 0.4, 0.1, 0.6);
  }

  return clamp(-0.06 + riskScore * 0.04, -0.08, 0);
};

const secondsSince = (fromIso: string | undefined, nowMs: number): number | null => {
  if (!fromIso) {
    return null;
  }

  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs)) {
    return null;
  }

  return (nowMs - fromMs) / 1000;
};

const zeroRewards = (): RewardBreakdown => ({
  baseSpores: 0,
  difficultyBonus: 0,
  streakMultiplier: 1,
  sourceMultiplier: 1,
  laneMultiplier: 1,
  noveltyMultiplier: 1,
  antiGrindPenalty: 1,
  objectiveBonusSpores: 0,
  objectiveCompleted: false,
  objectiveProgress: 0,
  awardedSpores: 0,
});

const estimateScoreFromTelemetry = (telemetry: SessionTelemetry): number => {
  return Math.max(
    0,
    Math.round(
      telemetry.completedEncounters * 900 +
        telemetry.perfectActions * 120 +
        telemetry.discoveryActions * 160 -
        telemetry.failedEncounters * 250,
    ),
  );
};

interface ObjectiveEvaluation {
  completed: boolean;
  progress: number;
  bonusSpores: number;
  moralityShift: number;
  laneWins: number;
  perfectActions: number;
}

const evaluateRunObjective = (
  objective: RunObjective | undefined,
  telemetry: SessionTelemetry,
): ObjectiveEvaluation => {
  if (!objective) {
    return {
      completed: false,
      progress: 0,
      bonusSpores: 0,
      moralityShift: 0,
      laneWins: 0,
      perfectActions: telemetry.perfectActions,
    };
  }

  const laneWins = telemetry.laneOutcomes?.[objective.targetLane]?.wins ?? 0;
  const laneProgress = clamp(laneWins / Math.max(1, objective.minimumLaneWins));
  const perfectProgress = clamp(
    telemetry.perfectActions / Math.max(1, objective.minimumPerfectActions),
  );
  const castCount = objective.targetElement
    ? telemetry.magic?.castsByElement?.[objective.targetElement] ?? 0
    : 0;
  const elementSatisfied = objective.targetElement
    ? telemetry.usedElements.includes(objective.targetElement) || castCount > 0
    : true;
  const elementProgress = elementSatisfied ? 1 : 0;

  const progress = roundTo(
    laneProgress * 0.45 + perfectProgress * 0.35 + elementProgress * 0.2,
    3,
  );

  const completed =
    !telemetry.abandoned &&
    laneWins >= objective.minimumLaneWins &&
    telemetry.perfectActions >= objective.minimumPerfectActions &&
    elementSatisfied;

  return {
    completed,
    progress,
    bonusSpores: completed ? objective.rewardBonusSpores : 0,
    moralityShift: completed ? objective.moralityShift : 0,
    laneWins,
    perfectActions: telemetry.perfectActions,
  };
};

const tuneRunByLiveOps = (
  run: PlannedRun,
  liveOps: LiveOpsConfig,
): PlannedRun => {
  return {
    ...run,
    encounters: run.encounters.map((encounter) => {
      const tunedDifficulty = clamp(
        encounter.targetDifficulty,
        liveOps.difficultyMin,
        liveOps.difficultyMax,
      );

      return {
        ...encounter,
        targetDifficulty: tunedDifficulty,
      };
    }),
  };
};

export class KingMycoEcosystemHub {
  private readonly director = new AdaptiveDirector();
  private readonly rewards = new RewardEconomy();
  private readonly fraud = new FraudGuard();
  private readonly leaderboard = new LeaderboardService();
  private readonly analytics = new AnalyticsService();

  private constructor(
    private readonly repository: KingMycoRepository,
    private readonly solana: SolanaService,
  ) {}

  static async create(statePath = "data/kingmyco-state.json"): Promise<KingMycoEcosystemHub> {
    const repository = await KingMycoRepository.create(statePath);
    const solana = new SolanaService();
    return new KingMycoEcosystemHub(repository, solana);
  }

  async linkIdentity(request: IdentityLinkRequest): Promise<PlayerSnapshot> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const snapshot = this.getPlayerSnapshot(playerId);
    await this.emitEvent("identity_linked", {
      playerId,
      source: request.source,
      payload: {
        source: request.source,
        hasWalletClaim: Boolean(request.claims?.walletAddress),
      },
    });
    await this.repository.save();
    return snapshot;
  }

  async generateRun(request: RunGenerationRequest): Promise<PlayerSnapshot> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const profile = this.repository.getOrCreateProfile(playerId);
    const liveOps = this.repository.getLiveOps();
    const priorRun = this.repository.getLastRun(playerId);
    const planned = this.director.planRun(profile, {
      encounters: request.encounters,
      seed: request.seed ?? `${playerId}:${profile.sessionsPlayed}`,
      priorRun,
    });

    const tuned = tuneRunByLiveOps(planned, liveOps);
    this.repository.setLastRun(playerId, tuned);

    await this.emitEvent("run_generated", {
      playerId,
      source: request.source,
      payload: {
        encounterCount: tuned.encounters.length,
        averageDifficulty:
          tuned.encounters.length > 0
            ? average(tuned.encounters.map((encounter) => encounter.targetDifficulty))
            : 0,
        seed: tuned.seed,
        objectiveId: tuned.objective?.id,
        objectiveLane: tuned.objective?.targetLane,
        objectiveBranch: tuned.objective?.branch,
        objectiveChainStep: tuned.objective?.chainStep,
      },
    });

    await this.repository.save();

    return this.getPlayerSnapshot(playerId);
  }

  async recordSession(request: SessionIngestRequest): Promise<SessionReceipt> {
    const mode = request.mode ?? DEFAULT_MODE;
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const profile = this.repository.getOrCreateProfile(playerId);
    const wallet = this.repository.getWallet(playerId);
    const liveOps = this.repository.getLiveOps();
    const score = request.score ?? estimateScoreFromTelemetry(request.telemetry);

    const lastRun = this.repository.getLastRun(playerId);
    const seenFingerprint = this.repository.hasRecentFingerprint(
      playerId,
      this.computeFingerprintPreview(request.telemetry, score),
    );

    const fraud = this.fraud.evaluate({
      telemetry: request.telemetry,
      score,
      profile,
      wallet,
      liveOps,
      seenFingerprint,
    });

    this.repository.addFingerprint(playerId, fraud.fingerprint);

    let nextProfile = profile;
    let nextWallet = wallet;
    let rewards = zeroRewards();

    if (fraud.flagged) {
      nextWallet = {
        ...wallet,
        suspiciousSessions: wallet.suspiciousSessions + 1,
      };
      this.repository.setWallet(playerId, nextWallet);
    } else {
      this.director.recordSessionOutcome(playerId, request.telemetry);
      nextProfile = applySessionTelemetry(profile, {
        ...request.telemetry,
        sporesCollected: 0,
      });

      const difficulties = lastRun
        ? lastRun.encounters.map((encounter) => encounter.targetDifficulty)
        : [nextProfile.skill * 10];

      const rewarded = this.rewards.applySessionRewards({
        profile: nextProfile,
        wallet,
        telemetry: request.telemetry,
        source: request.source,
        liveOps,
        score,
        recentRunDifficulties: difficulties,
      });

      const objectiveEvaluation = evaluateRunObjective(
        lastRun?.objective,
        request.telemetry,
      );

      if (lastRun?.objective) {
        const objectiveResult: RunObjectiveResult = {
          objectiveId: lastRun.objective.id,
          completed: objectiveEvaluation.completed,
          progress: objectiveEvaluation.progress,
          bonusSporesAwarded: objectiveEvaluation.bonusSpores,
          laneWins: objectiveEvaluation.laneWins,
          perfectActions: objectiveEvaluation.perfectActions,
          recordedAt: new Date().toISOString(),
        };

        this.repository.setLastRun(playerId, {
          ...lastRun,
          objectiveResult,
        });
      }

      rewards = {
        ...rewarded.breakdown,
        objectiveBonusSpores: objectiveEvaluation.bonusSpores,
        objectiveCompleted: objectiveEvaluation.completed,
        objectiveProgress: objectiveEvaluation.progress,
        awardedSpores: rewarded.breakdown.awardedSpores + objectiveEvaluation.bonusSpores,
      };

      nextWallet = {
        ...rewarded.wallet,
        spores: rewarded.wallet.spores + objectiveEvaluation.bonusSpores,
        lifetimeSpores: rewarded.wallet.lifetimeSpores + objectiveEvaluation.bonusSpores,
      };

      nextProfile = {
        ...nextProfile,
        morality: clamp(nextProfile.morality + objectiveEvaluation.moralityShift, -1, 1),
        sporesCollected: nextProfile.sporesCollected + rewards.awardedSpores,
      };

      this.repository.setProfile(nextProfile);
      this.repository.setWallet(playerId, nextWallet);
    }

    const riskSnapshot = this.repository.adjustAdaptiveRisk({
      playerId,
      nowIso: new Date().toISOString(),
      decayPerHour: liveOps.riskScoreDecayPerHour,
      playerDelta: riskDeltaFromFraud(fraud.flagged, fraud.riskScore),
    });

    const table = this.repository.getLeaderboard(mode);
    const updatedTable = this.leaderboard.submit(table, {
      playerId,
      mode,
      score,
      source: request.source,
      timestamp: new Date().toISOString(),
      flagged: fraud.flagged,
    });

    this.repository.setLeaderboard(mode, updatedTable);

    await this.emitEvent("session_recorded", {
      playerId,
      source: request.source,
      mode,
      payload: {
        score,
        fraudFlagged: fraud.flagged,
        suspiciousScore: fraud.riskScore,
        awardedSpores: rewards.awardedSpores,
        objectiveCompleted: rewards.objectiveCompleted,
        objectiveBonusSpores: rewards.objectiveBonusSpores,
        objectiveProgress: rewards.objectiveProgress,
        objectiveChainStep: lastRun?.objective?.chainStep,
        objectiveBranch: lastRun?.objective?.branch,
        adaptiveRiskScore: riskSnapshot.playerRisk,
        morality: nextProfile.morality,
        learnedMagicCount: nextProfile.learnedMagic.length,
        sporesCollected: nextProfile.sporesCollected,
      },
    });

    await this.repository.save();

    return {
      playerId,
      mode,
      score,
      fraud,
      rewards,
      wallet: nextWallet,
      profile: nextProfile,
    };
  }

  async generateCoaching(request: CoachingRequest): Promise<CoachingResponse> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const profile = this.repository.getOrCreateProfile(playerId);
    const weakestLane = Object.entries(profile.laneMastery).sort(
      (left, right) => left[1] - right[1],
    )[0]?.[0] ?? "tactics";
    const latestRun = this.repository.getLastRun(playerId);
    const nextObjective = latestRun?.objective
      ? `${latestRun.objective.title}: ${latestRun.objective.completionHint}`
      : latestRun?.encounters.find(
          (encounter) => encounter.suggestedLearningObjective,
        )?.suggestedLearningObjective;

    const recommendations = [
      `Focus one rotation on ${weakestLane} lane consistency.`,
      `Use your lowest-mastery element to trigger adaptive unlock opportunities.`,
      `Target a clean streak of 3 encounters before increasing risk actions.`,
    ];

    if (nextObjective) {
      recommendations.unshift(nextObjective);
    }

    const response =
      `Profile synced for ${playerId}. ` +
      `Your current growth edge is ${weakestLane}. ` +
      `${nextObjective ?? "Prioritize precision plus exploration actions"} ` +
      `to force the director to open more unique encounters.`;

    await this.emitEvent("coaching_generated", {
      playerId,
      source: request.source,
      payload: {
        focusLane: weakestLane,
        recommendationCount: recommendations.length,
      },
    });

    await this.repository.save();

    return {
      playerId,
      focusLane: weakestLane,
      recommendations,
      response,
    };
  }

  async getRpgMap(request: RpgMapRequest): Promise<RpgMapSnapshot> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const campaign = this.repository.getOrCreateCampaign(playerId);
    this.repository.setCampaign(campaign);
    await this.repository.save();
    return this.buildRpgMapSnapshot(playerId, campaign);
  }

  async travelRpgRegion(request: RpgTravelRequest): Promise<RpgMapSnapshot> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const campaign = this.repository.getOrCreateCampaign(playerId);
    const nextWorld = travelToRegion(campaign.world, request.destinationRegionId);
    const nextCampaign: PlayerCampaignState = {
      ...campaign,
      world: nextWorld,
      activeBattle: undefined,
      lastTravelAt: new Date().toISOString(),
    };

    this.repository.setCampaign(nextCampaign);

    await this.emitEvent("rpg_region_traveled", {
      playerId,
      source: request.source,
      payload: {
        fromRegionId: campaign.world.currentRegionId,
        toRegionId: nextWorld.currentRegionId,
        discoveredRegions: nextWorld.discoveredRegionIds.length,
      },
    });

    await this.repository.save();
    return this.buildRpgMapSnapshot(playerId, nextCampaign);
  }

  async startRpgBattle(request: RpgBattleStartRequest): Promise<RpgBattleReceipt> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const profile = this.repository.getOrCreateProfile(playerId);
    const campaign = this.repository.getOrCreateCampaign(playerId);

    if (campaign.activeBattle?.status === "active") {
      return {
        playerId,
        campaign,
        battle: campaign.activeBattle,
      };
    }

    const battle = startTurnBattle({
      playerId,
      profile,
      campaign,
      run: this.repository.getLastRun(playerId),
      preferredLane: request.preferredLane,
    });

    const nextCampaign: PlayerCampaignState = {
      ...campaign,
      activeBattle: battle,
    };

    this.repository.setCampaign(nextCampaign);

    await this.emitEvent("rpg_battle_started", {
      playerId,
      source: request.source,
      payload: {
        battleId: battle.battleId,
        regionId: battle.regionId,
        lane: battle.encounterLane,
      },
    });

    await this.repository.save();

    return {
      playerId,
      campaign: nextCampaign,
      battle,
    };
  }

  async playRpgTurn(request: RpgTurnActionRequest): Promise<RpgBattleReceipt> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const profile = this.repository.getOrCreateProfile(playerId);
    const campaign = this.repository.getOrCreateCampaign(playerId);
    const activeBattle = campaign.activeBattle;

    if (!activeBattle) {
      throw new Error("No active RPG battle. Start one with /api/rpg/battle/start");
    }

    const battle = resolveTurnAction({
      battle: activeBattle,
      profile,
      action: request.action,
    });

    let nextCampaign: PlayerCampaignState = {
      ...campaign,
      activeBattle: battle.status === "active" ? battle : undefined,
    };

    if (battle.status === "won") {
      const wallet = this.repository.getWallet(playerId);
      const nextWallet = {
        ...wallet,
        spores: wallet.spores + battle.rewardSpores,
        lifetimeSpores: wallet.lifetimeSpores + battle.rewardSpores,
      };
      this.repository.setWallet(playerId, nextWallet);

      const profileSnapshot = this.repository.getOrCreateProfile(playerId);
      this.repository.setProfile({
        ...profileSnapshot,
        sporesCollected: profileSnapshot.sporesCollected + battle.rewardSpores,
      });

      nextCampaign = {
        ...nextCampaign,
        victories: nextCampaign.victories + 1,
        world: {
          ...nextCampaign.world,
          conqueredRegionIds: Array.from(
            new Set([...nextCampaign.world.conqueredRegionIds, battle.regionId]),
          ),
        },
      };
    }

    if (battle.status === "lost") {
      nextCampaign = {
        ...nextCampaign,
        defeats: nextCampaign.defeats + 1,
      };
    }

    this.repository.setCampaign(nextCampaign);

    await this.emitEvent("rpg_turn_resolved", {
      playerId,
      source: request.source,
      payload: {
        battleId: battle.battleId,
        status: battle.status,
        turnNumber: battle.turnNumber,
        rewardSpores: battle.status === "won" ? battle.rewardSpores : 0,
      },
    });

    await this.repository.save();

    return {
      playerId,
      campaign: nextCampaign,
      battle,
    };
  }

  async recordRpgBurnPit(
    request: RpgBurnPitRecordRequest,
  ): Promise<RpgBurnPitRecordReceipt> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );
    const nowIso = new Date().toISOString();
    const dayKey =
      typeof request.clientDayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.clientDayKey)
        ? request.clientDayKey
        : nowIso.slice(0, 10);
    const requestedSpores = Math.max(0, Math.floor(request.sporesBurned));
    if (requestedSpores <= 0) {
      throw new Error("sporesBurned must be greater than 0");
    }

    const ledger = this.repository.getBurnPitLedger(playerId);
    const burnedToday = ledger.dailyBurned[dayKey] ?? 0;
    const remaining = Math.max(0, BURN_PIT_DAILY_LIMIT - burnedToday);
    if (remaining <= 0) {
      throw new Error(`Daily burn limit reached (${BURN_PIT_DAILY_LIMIT} spores)`);
    }

    const acceptedSpores = Math.min(requestedSpores, remaining);
    const tokenBurnAmount =
      typeof request.sundayTokenBurnAmount === "number" &&
      Number.isFinite(request.sundayTokenBurnAmount)
        ? Math.max(0, request.sundayTokenBurnAmount)
        : 0.25;
    const sundayWindow =
      typeof request.sundayWindow === "string" && request.sundayWindow.trim().length > 0
        ? request.sundayWindow.trim()
        : dayKey;

    const nextLedger = this.repository.recordBurnPitEvent(playerId, {
      timestamp: nowIso,
      dayKey,
      sporesBurned: acceptedSpores,
      pitId: request.pitId,
      pitName: request.pitName,
      realmId: request.realmId,
      clanId: request.clanId,
      avatarId: request.avatarId,
      sundayWindow,
      sundayTokenBurnAmount: tokenBurnAmount,
    });
    const nextBurnedToday = nextLedger.dailyBurned[dayKey] ?? 0;
    const nextRemaining = Math.max(0, BURN_PIT_DAILY_LIMIT - nextBurnedToday);

    await this.emitEvent("spore_burn_recorded", {
      playerId,
      source: request.source,
      mode: "myco-quest-burn-pit",
      payload: {
        acceptedSpores,
        requestedSpores,
        dayKey,
        burnedToday: nextBurnedToday,
        remainingToday: nextRemaining,
        dailyLimit: BURN_PIT_DAILY_LIMIT,
        pitId: request.pitId,
        pitName: request.pitName,
        realmId: request.realmId,
        clanId: request.clanId,
        avatarId: request.avatarId,
        sundayWindow,
        sundayTokenBurnAmount: tokenBurnAmount,
      },
    });

    await this.repository.save();

    return {
      playerId,
      acceptedSpores,
      burnedToday: nextBurnedToday,
      remainingToday: nextRemaining,
      dailyLimit: BURN_PIT_DAILY_LIMIT,
      totalBurned: nextLedger.totalBurned,
      tokenBurnAmount,
      sundayWindow,
      recordedAt: nowIso,
    };
  }

  async createSolanaWalletChallenge(
    request: SolanaWalletChallengeRequest,
  ): Promise<SolanaWalletChallenge> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      {
        ...request.claims,
        walletAddress: request.walletAddress,
      },
    );

    const challenge = this.buildWalletChallenge({
      playerId,
      source: request.source,
      externalId: request.externalId,
      walletAddress: request.walletAddress,
    });

    this.repository.setWalletChallenge(challenge);
    await this.repository.save();
    return challenge;
  }

  async verifySolanaWalletLink(
    request: SolanaWalletVerificationRequest,
  ): Promise<SolanaWalletVerificationResponse> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      {
        ...request.claims,
        walletAddress: request.walletAddress,
      },
    );

    const challenge = this.repository.getWalletChallenge(
      playerId,
      request.walletAddress,
    );

    if (!challenge) {
      throw new Error("No active wallet challenge found for this player and wallet");
    }

    if (challenge.consumedAt) {
      throw new Error("Wallet challenge has already been used");
    }

    if (Date.parse(challenge.expiresAt) < Date.now()) {
      throw new Error("Wallet challenge has expired");
    }

    if (challenge.message !== request.message) {
      throw new Error("Wallet challenge message mismatch");
    }

    const proof = this.solana.verifyWalletProof({
      playerId,
      source: request.source,
      externalId: request.externalId,
      walletAddress: request.walletAddress,
      message: request.message,
      signature: request.signature,
    });

    this.repository.consumeWalletChallenge(playerId, request.walletAddress);
    this.repository.setWalletProof(proof);
    const player = this.getPlayerSnapshot(playerId);
    const wallet = await this.solana.getWalletSnapshot(request.walletAddress);

    await this.emitEvent("solana_wallet_verified", {
      playerId,
      source: request.source,
      payload: {
        walletAddress: proof.walletAddress,
      },
    });

    await this.repository.save();

    return {
      verified: true,
      player,
      proof,
      wallet,
    };
  }

  async claimSolanaRewards(
    request: SolanaRewardClaimRequest,
  ): Promise<SolanaRewardClaimReceipt> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      {
        ...request.claims,
        walletAddress: request.destinationWallet,
      },
    );
    const liveOps = this.repository.getLiveOps();

    const idempotencyKey = request.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = this.repository.getClaimIdempotencyRecord(
        playerId,
        request.source,
        idempotencyKey,
      );

      if (existing) {
        const existingIntent = this.repository.getTransferIntent(existing.intentId);
        if (!existingIntent) {
          throw new Error(
            `Idempotency record references missing transfer intent: ${existing.intentId}`,
          );
        }

        const existingMycoBurned =
          existing.mycoBurned ??
          existingIntent.mycoBurned ??
          roundTo(existing.sporesDebited * liveOps.mycoBurnPerSpore, 6);

        return {
          playerId,
          sporesDebited: existing.sporesDebited,
          lamports: existing.lamports,
          mycoBurned: existingMycoBurned,
          wallet: this.repository.getWallet(playerId),
          intent: existingIntent,
          idempotencyKey,
          reused: true,
        };
      }
    }

    const proof = this.repository.getWalletProof(request.destinationWallet);
    if (!proof || proof.playerId !== playerId || !proof.verified) {
      throw new Error(
        "Destination wallet is not verified for this player. Complete /api/solana/challenge and /api/solana/verify-link first.",
      );
    }

    const sporesToRedeem = Math.floor(request.sporesToRedeem);
    const nowIso = new Date().toISOString();

    const claimLedger = this.repository.getClaimLedger(playerId);
    const cooldownSec = secondsSince(claimLedger.lastClaimAt, Date.now());
    if (cooldownSec !== null && cooldownSec < liveOps.claimCooldownSec) {
      const waitFor = Math.ceil(liveOps.claimCooldownSec - cooldownSec);
      throw new Error(`Claim cooldown active. Retry in ${waitFor}s`);
    }

    const riskSnapshot = this.repository.getAdaptiveRiskSnapshot({
      playerId,
      clientIp: request.clientIp,
      nowIso,
      decayPerHour: liveOps.riskScoreDecayPerHour,
    });

    if (riskSnapshot.maxRisk >= liveOps.riskHardBlockThreshold) {
      this.repository.adjustAdaptiveRisk({
        playerId,
        clientIp: request.clientIp,
        nowIso,
        decayPerHour: liveOps.riskScoreDecayPerHour,
        playerDelta: 0.05,
        ipDelta: request.clientIp ? 0.05 : undefined,
      });
      throw new Error(
        `Claim temporarily blocked due to elevated risk (${riskSnapshot.maxRisk.toFixed(2)})`,
      );
    }

    const todayKey = nowIso.slice(0, 10);
    const redeemedToday = claimLedger.dailyRedeemed[todayKey] ?? 0;

    const velocity = this.repository.getClaimVelocitySnapshot({
      walletAddress: request.destinationWallet,
      clientIp: request.clientIp,
      nowIso,
    });

    const effectiveWalletClaimsPerHour = scaleLimitByRisk(
      liveOps.maxClaimsPerHourPerWallet,
      riskSnapshot.maxRisk,
      liveOps.riskThrottleWeight,
    );
    const effectiveIpClaimsPerHour = scaleLimitByRisk(
      liveOps.maxClaimsPerHourPerIp,
      riskSnapshot.maxRisk,
      liveOps.riskThrottleWeight,
    );
    const effectiveUniqueWalletsPerIpPerDay = scaleLimitByRisk(
      liveOps.maxUniqueWalletsPerIpPerDay,
      riskSnapshot.maxRisk,
      liveOps.riskThrottleWeight,
    );

    if (velocity.walletClaimsLastHour >= effectiveWalletClaimsPerHour) {
      this.repository.adjustAdaptiveRisk({
        playerId,
        clientIp: request.clientIp,
        nowIso,
        decayPerHour: liveOps.riskScoreDecayPerHour,
        playerDelta: 0.04,
        ipDelta: request.clientIp ? 0.02 : undefined,
      });
      throw new Error(
        `Wallet claim velocity exceeded (${effectiveWalletClaimsPerHour}/hour effective limit)`,
      );
    }

    if (
      request.clientIp &&
      velocity.ipClaimsLastHour >= effectiveIpClaimsPerHour
    ) {
      this.repository.adjustAdaptiveRisk({
        playerId,
        clientIp: request.clientIp,
        nowIso,
        decayPerHour: liveOps.riskScoreDecayPerHour,
        playerDelta: 0.02,
        ipDelta: 0.04,
      });
      throw new Error(
        `IP claim velocity exceeded (${effectiveIpClaimsPerHour}/hour effective limit)`,
      );
    }

    if (
      request.clientIp &&
      !velocity.ipHasWalletToday &&
      velocity.uniqueWalletsForIpToday >= effectiveUniqueWalletsPerIpPerDay
    ) {
      this.repository.adjustAdaptiveRisk({
        playerId,
        clientIp: request.clientIp,
        nowIso,
        decayPerHour: liveOps.riskScoreDecayPerHour,
        playerDelta: 0.03,
        ipDelta: 0.05,
      });
      throw new Error(
        `IP wallet diversity limit exceeded (${effectiveUniqueWalletsPerIpPerDay} wallets/day effective limit)`,
      );
    }

    if (!Number.isInteger(sporesToRedeem) || sporesToRedeem <= 0) {
      throw new Error("sporesToRedeem must be a positive integer");
    }

    if (sporesToRedeem < liveOps.minSporesPerClaim) {
      throw new Error(
        `sporesToRedeem must be >= ${liveOps.minSporesPerClaim}`,
      );
    }

    if (sporesToRedeem > liveOps.maxSporesPerClaim) {
      throw new Error(
        `sporesToRedeem must be <= ${liveOps.maxSporesPerClaim}`,
      );
    }

    if (redeemedToday + sporesToRedeem > liveOps.maxDailySporeRedeem) {
      throw new Error(
        `Daily claim cap exceeded (${liveOps.maxDailySporeRedeem} spores/day)`,
      );
    }

    const wallet = this.repository.getWallet(playerId);
    if (wallet.spores < sporesToRedeem) {
      throw new Error("Insufficient spore balance for claim");
    }

    const lamports = Math.floor(sporesToRedeem * liveOps.sporeToLamportsRate);
    if (lamports <= 0) {
      throw new Error("Claim conversion produced zero lamports");
    }

    const mycoBurned = roundTo(sporesToRedeem * liveOps.mycoBurnPerSpore, 6);
    if (mycoBurned <= 0) {
      throw new Error("MYCO burn equivalent produced zero value");
    }

    const intent = await this.solana.prepareSolTransfer({
      playerId,
      source: request.source,
      destinationWallet: request.destinationWallet,
      lamports,
      sporesDebited: sporesToRedeem,
      mycoBurned,
      memo:
        request.memo ??
        `kingmyco reward claim | player:${playerId} | spores:${sporesToRedeem}`,
    });

    const updatedWallet = {
      ...wallet,
      spores: wallet.spores - sporesToRedeem,
    };
    this.repository.setWallet(playerId, updatedWallet);
    this.repository.applyClaimLedgerDelta(playerId, nowIso, sporesToRedeem);
    this.repository.recordClaimVelocity({
      walletAddress: request.destinationWallet,
      clientIp: request.clientIp,
      timestampIso: nowIso,
    });
    const postClaimRisk = this.repository.adjustAdaptiveRisk({
      playerId,
      clientIp: request.clientIp,
      nowIso,
      decayPerHour: liveOps.riskScoreDecayPerHour,
      playerDelta: -0.01,
      ipDelta: request.clientIp ? -0.005 : undefined,
    });
    this.repository.setTransferIntent(intent);

    if (idempotencyKey) {
      this.repository.setClaimIdempotencyRecord({
        key: idempotencyKey,
        playerId,
        source: request.source,
        intentId: intent.id,
        sporesDebited: sporesToRedeem,
        lamports,
        mycoBurned,
        createdAt: nowIso,
      });
    }

    await this.emitEvent("reward_intent_prepared", {
      playerId,
      source: request.source,
      payload: {
        intentId: intent.id,
        lamports,
        sporesDebited: sporesToRedeem,
        mycoBurned,
        destinationWallet: intent.destinationWallet,
        clientIpPresent: Boolean(request.clientIp),
        clientFingerprintPresent: Boolean(request.clientFingerprint),
        adaptiveRiskScore: postClaimRisk.maxRisk,
        effectiveWalletClaimsPerHour,
        effectiveIpClaimsPerHour,
        effectiveUniqueWalletsPerIpPerDay,
      },
    });

    await this.repository.save();

    return {
      playerId,
      sporesDebited: sporesToRedeem,
      lamports,
      mycoBurned,
      wallet: updatedWallet,
      intent,
      idempotencyKey,
      reused: false,
    };
  }

  async prepareSolanaRewardTransfer(
    request: SolanaRewardTransferRequest,
  ): Promise<SolanaRewardTransferIntent> {
    const liveOps = this.repository.getLiveOps();
    const requestWithBurn: SolanaRewardTransferRequest = {
      ...request,
      mycoBurned:
        request.mycoBurned ??
        roundTo((request.sporesDebited ?? 0) * liveOps.mycoBurnPerSpore, 6),
    };

    const intent = await this.solana.prepareSolTransfer(requestWithBurn);
    this.repository.setTransferIntent(intent);

    await this.emitEvent("reward_intent_prepared", {
      playerId: request.playerId,
      source: request.source,
      payload: {
        intentId: intent.id,
        lamports: intent.lamports,
        sporesDebited: intent.sporesDebited,
        mycoBurned: intent.mycoBurned,
        destinationWallet: intent.destinationWallet,
      },
    });

    await this.repository.save();
    return intent;
  }

  async updateSolanaRewardTransferStatus(
    request: SolanaRewardTransferStatusRequest,
  ): Promise<SolanaRewardTransferStatusReceipt> {
    const existing = this.repository.getTransferIntent(request.intentId);
    if (!existing) {
      throw new Error(`Transfer intent not found: ${request.intentId}`);
    }

    const status = request.status;
    const wallet = this.repository.getWallet(existing.playerId);

    if (existing.status === "settled") {
      if (status === "settled") {
        return {
          intent: existing,
          wallet,
        };
      }

      throw new Error("Settled intents are immutable");
    }

    if (
      existing.status === status &&
      (request.txSignature ?? existing.txSignature) === existing.txSignature &&
      (request.failureReason ?? existing.failureReason) === existing.failureReason
    ) {
      return {
        intent: existing,
        wallet,
      };
    }

    const updatedIntent: SolanaRewardTransferIntent = {
      ...existing,
      status,
      txSignature: request.txSignature ?? existing.txSignature,
      failureReason: request.failureReason,
      updatedAt: new Date().toISOString(),
    };

    let nextWallet = wallet;

    if (
      status === "failed" &&
      existing.status !== "failed" &&
      existing.sporesDebited > 0
    ) {
      nextWallet = {
        ...wallet,
        spores: wallet.spores + existing.sporesDebited,
      };
      this.repository.setWallet(existing.playerId, nextWallet);
      this.repository.applyClaimLedgerDelta(
        existing.playerId,
        existing.createdAt,
        -existing.sporesDebited,
      );
    }

    this.repository.setTransferIntent(updatedIntent);

    await this.emitEvent("reward_intent_status_updated", {
      playerId: existing.playerId,
      source: existing.source,
      payload: {
        intentId: existing.id,
        previousStatus: existing.status,
        nextStatus: status,
        txSignature: updatedIntent.txSignature,
        mycoBurned: existing.mycoBurned,
      },
    });

    await this.repository.save();

    return {
      intent: updatedIntent,
      wallet: nextWallet,
    };
  }

  getTransferIntents(options: {
    playerId?: string;
    status?: RewardTransferStatus;
    limit?: number;
  } = {}): SolanaRewardTransferIntent[] {
    const intents = this.repository
      .getTransferIntents(options.playerId)
      .filter((intent) =>
        options.status ? intent.status === options.status : true,
      )
      .sort((left, right) => {
        return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      });

    if (!options.limit || options.limit <= 0) {
      return intents;
    }

    return intents.slice(0, options.limit);
  }

  async processPreparedTransferIntent(
    intentId: string,
  ): Promise<SolanaRewardTransferStatusReceipt> {
    const intent = this.repository.getTransferIntent(intentId);
    if (!intent) {
      throw new Error(`Transfer intent not found: ${intentId}`);
    }

    if (intent.status !== "prepared") {
      return {
        intent,
        wallet: this.repository.getWallet(intent.playerId),
      };
    }

    try {
      const { txSignature } = await this.solana.submitPreparedTransferIntent(intent);
      return this.updateSolanaRewardTransferStatus({
        intentId,
        status: "submitted",
        txSignature,
      });
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : "transfer submission failed";
      return this.updateSolanaRewardTransferStatus({
        intentId,
        status: "failed",
        failureReason,
      });
    }
  }

  async reconcileSubmittedTransferIntent(
    intentId: string,
  ): Promise<SolanaRewardTransferStatusReceipt> {
    const intent = this.repository.getTransferIntent(intentId);
    if (!intent) {
      throw new Error(`Transfer intent not found: ${intentId}`);
    }

    if (intent.status !== "submitted") {
      return {
        intent,
        wallet: this.repository.getWallet(intent.playerId),
      };
    }

    if (!intent.txSignature) {
      return this.updateSolanaRewardTransferStatus({
        intentId,
        status: "failed",
        failureReason: "submitted intent has no transaction signature",
      });
    }

    const chainStatus = await this.solana.getTransferSignatureState(intent.txSignature);
    if (chainStatus === "pending") {
      return {
        intent,
        wallet: this.repository.getWallet(intent.playerId),
      };
    }

    return this.updateSolanaRewardTransferStatus({
      intentId,
      status: chainStatus,
      txSignature: intent.txSignature,
      failureReason:
        chainStatus === "failed"
          ? "on-chain transfer failed"
          : undefined,
    });
  }

  async processTransferQueues(
    request: SolanaTransferQueueProcessRequest = {},
  ): Promise<SolanaTransferQueueProcessSummary> {
    const preparedLimit = request.preparedLimit ?? 15;
    const submittedLimit = request.submittedLimit ?? 30;
    const dryRun = request.dryRun ?? false;

    const prepared = this.getTransferIntents({
      status: "prepared",
      limit: preparedLimit,
    });
    const submitted = this.getTransferIntents({
      status: "submitted",
      limit: submittedLimit,
    });

    const summary: SolanaTransferQueueProcessSummary = {
      preparedChecked: prepared.length,
      preparedSubmitted: 0,
      preparedFailed: 0,
      submittedChecked: submitted.length,
      submittedSettled: 0,
      submittedFailed: 0,
      submittedPending: 0,
      processedIntentIds: [],
    };

    if (dryRun) {
      return summary;
    }

    for (const intent of prepared) {
      const receipt = await this.processPreparedTransferIntent(intent.id);
      summary.processedIntentIds.push(intent.id);

      if (receipt.intent.status === "submitted") {
        summary.preparedSubmitted += 1;
      } else if (receipt.intent.status === "failed") {
        summary.preparedFailed += 1;
      }
    }

    for (const intent of submitted) {
      const receipt = await this.reconcileSubmittedTransferIntent(intent.id);
      summary.processedIntentIds.push(intent.id);

      if (receipt.intent.status === "settled") {
        summary.submittedSettled += 1;
      } else if (receipt.intent.status === "failed") {
        summary.submittedFailed += 1;
      } else {
        summary.submittedPending += 1;
      }
    }

    return summary;
  }

  async getSolanaWalletSnapshot(walletAddress: string) {
    return this.solana.getWalletSnapshot(walletAddress);
  }

  async ingestWebhookEvent(
    source: EcosystemSource,
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookReceipt> {
    const eventId = randomUUID();

    await this.repository.appendEvent({
      id: eventId,
      type: "webhook_ingested",
      timestamp: new Date().toISOString(),
      source,
      payload: {
        eventName,
        ...payload,
      },
    });

    await this.repository.save();

    return {
      accepted: true,
      source,
      eventId,
    };
  }

  async emitEcosystemHeartbeat(input: {
    sources?: EcosystemSource[];
    eventName?: string;
    payload?: Record<string, unknown>;
  } = {}): Promise<EcosystemHeartbeatPulseReceipt> {
    const requestedSources = input.sources ?? ECOSYSTEM_SOURCES;
    const sourceSet = new Set(
      requestedSources.filter((source): source is EcosystemSource =>
        ECOSYSTEM_SOURCES.includes(source),
      ),
    );
    const sources =
      sourceSet.size > 0 ? Array.from(sourceSet) : [...ECOSYSTEM_SOURCES];

    const eventName =
      typeof input.eventName === "string" && input.eventName.trim().length > 0
        ? input.eventName.trim()
        : "ecosystem_heartbeat";
    const emittedAt = new Date().toISOString();
    const eventIdsBySource: Partial<Record<EcosystemSource, string>> = {};

    for (const source of sources) {
      const eventId = randomUUID();
      eventIdsBySource[source] = eventId;

      await this.repository.appendEvent({
        id: eventId,
        type: "webhook_ingested",
        timestamp: emittedAt,
        source,
        payload: {
          eventName,
          heartbeat: true,
          ...(input.payload ?? {}),
        },
      });
    }

    await this.repository.save();

    return {
      emittedAt,
      eventName,
      emittedCount: sources.length,
      sources,
      eventIdsBySource,
    };
  }

  getPlayerSnapshot(playerId: string): PlayerSnapshot {
    return {
      playerId,
      identities: this.repository.getIdentities(playerId),
      profile: this.repository.getOrCreateProfile(playerId),
      wallet: this.repository.getWallet(playerId),
      lastRun: this.repository.getLastRun(playerId),
      campaign: this.repository.getOrCreateCampaign(playerId),
    };
  }

  getLeaderboard(mode = DEFAULT_MODE, includeQuarantined = false) {
    const table = this.repository.getLeaderboard(mode);

    return {
      mode,
      entries: table.entries,
      quarantined: includeQuarantined ? table.quarantined : [],
    };
  }

  getLiveOps(): LiveOpsConfig {
    return this.repository.getLiveOps();
  }

  async updateLiveOps(patch: DeepPartial<LiveOpsConfig>): Promise<LiveOpsConfig> {
    const current = this.repository.getLiveOps() ?? DEFAULT_LIVE_OPS;
    const merged = mergeLiveOpsConfig(current, patch);
    this.repository.setLiveOps(merged);

    await this.emitEvent("liveops_updated", {
      payload: {
        antiExploitThreshold: merged.antiExploitThreshold,
        rewardMultiplier: merged.rewardMultiplier,
        mycoBurnPerSpore: merged.mycoBurnPerSpore,
        sporeToLamportsRate: merged.sporeToLamportsRate,
        claimCooldownSec: merged.claimCooldownSec,
        maxDailySporeRedeem: merged.maxDailySporeRedeem,
        maxClaimsPerHourPerWallet: merged.maxClaimsPerHourPerWallet,
        maxClaimsPerHourPerIp: merged.maxClaimsPerHourPerIp,
        maxUniqueWalletsPerIpPerDay: merged.maxUniqueWalletsPerIpPerDay,
        riskScoreDecayPerHour: merged.riskScoreDecayPerHour,
        riskThrottleWeight: merged.riskThrottleWeight,
        riskHardBlockThreshold: merged.riskHardBlockThreshold,
      },
    });

    await this.repository.save();
    return merged;
  }

  async getAnalyticsSummary(limit = 300): Promise<AnalyticsSummary> {
    const events = await this.repository.getRecentEvents(limit);
    return this.analytics.summarize(events);
  }

  async getEcosystemCommunicationStatus(options: {
    windowMinutes?: number;
    minEventsPerSource?: number;
    limit?: number;
  } = {}): Promise<EcosystemCommunicationStatus> {
    const windowMinutes = Math.max(1, Math.floor(options.windowMinutes ?? 120));
    const minEventsPerSource = Math.max(
      1,
      Math.floor(options.minEventsPerSource ?? 1),
    );
    const limit = Math.max(50, Math.min(Math.floor(options.limit ?? 1000), 2000));

    const events = await this.repository.getRecentEvents(limit);
    return this.analytics.communicationStatus(events, {
      windowMinutes,
      minEventsPerSource,
    });
  }

  async getDevHudBundle(input: DevHudBundleRequest): Promise<DevHudBundle> {
    const communication = await this.getEcosystemCommunicationStatus({
      windowMinutes: input.windowMinutes,
      minEventsPerSource: input.minEventsPerSource,
      limit: input.limit,
    });

    return {
      generatedAt: new Date().toISOString(),
      player: this.getPlayerSnapshot(input.playerId),
      communication,
    };
  }

  private buildRpgMapSnapshot(
    playerId: string,
    campaign: PlayerCampaignState,
  ): RpgMapSnapshot {
    const currentRegion =
      getRegionById(campaign.world.currentRegionId) ?? getRegionById(START_REGION_ID);

    if (!currentRegion) {
      throw new Error("RPG map catalog missing start region");
    }

    const connectedRegions = currentRegion.connectedRegionIds
      .map((regionId) => getRegionById(regionId))
      .filter((region): region is NonNullable<typeof region> => Boolean(region));

    const discovered = new Set(campaign.world.discoveredRegionIds);
    discovered.add(currentRegion.id);

    const discoveredRegions = REGION_CATALOG.filter((region) =>
      discovered.has(region.id),
    );

    return {
      generatedAt: new Date().toISOString(),
      playerId,
      world: {
        ...campaign.world,
        discoveredRegionIds: Array.from(discovered),
      },
      currentRegion,
      connectedRegions,
      discoveredRegions,
      activeBattle: campaign.activeBattle,
      victories: campaign.victories,
      defeats: campaign.defeats,
    };
  }

  private buildWalletChallenge(input: {
    playerId: string;
    source: EcosystemSource;
    externalId: string;
    walletAddress: string;
  }): SolanaWalletChallenge {
    const ttlMs = Number(
      process.env.KINGMYCO_SOLANA_CHALLENGE_TTL_MS ?? DEFAULT_CHALLENGE_TTL_MS,
    );
    const createdAtMs = Date.now();
    const createdAt = new Date(createdAtMs).toISOString();
    const expiresAt = new Date(createdAtMs + ttlMs).toISOString();
    const nonce = randomBytes(24).toString("hex");

    const message = [
      "King Myco Wallet Link",
      `player_id:${input.playerId}`,
      `source:${input.source}`,
      `external_id:${input.externalId}`,
      `wallet:${input.walletAddress}`,
      `nonce:${nonce}`,
      `issued_at:${createdAt}`,
      `expires_at:${expiresAt}`,
    ].join("\n");

    return {
      challengeId: randomUUID(),
      playerId: input.playerId,
      source: input.source,
      externalId: input.externalId,
      walletAddress: input.walletAddress,
      nonce,
      message,
      createdAt,
      expiresAt,
    };
  }

  private async emitEvent(
    inputType: PlatformEventType,
    input: {
      playerId?: string;
      source?: EcosystemSource;
      mode?: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.repository.appendEvent({
      id: randomUUID(),
      type: inputType,
      timestamp: new Date().toISOString(),
      playerId: input.playerId,
      source: input.source,
      mode: input.mode,
      payload: input.payload,
    });
  }

  private computeFingerprintPreview(
    telemetry: SessionTelemetry,
    score: number,
  ): string {
    return [
      telemetry.completedEncounters,
      telemetry.failedEncounters,
      telemetry.damageTaken,
      telemetry.perfectActions,
      telemetry.discoveryActions,
      telemetry.riskyActions,
      telemetry.sessionLengthSec,
      telemetry.usedElements.join(","),
      average(
        Object.values(telemetry.laneOutcomes ?? {}).map((lane) =>
          lane ? lane.wins + lane.losses : 0,
        ),
      ),
      score,
    ].join(":");
  }
}
