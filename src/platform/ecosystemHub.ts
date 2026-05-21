import { randomUUID } from "node:crypto";
import { AdaptiveDirector } from "../ai/adaptiveDirector";
import { applySessionTelemetry } from "../ai/playerModel";
import { PlannedRun, SessionTelemetry } from "../types";
import { average, clamp } from "../utils/math";
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
  CoachingRequest,
  CoachingResponse,
  EcosystemSource,
  IdentityLinkRequest,
  PlatformEventType,
  PlayerSnapshot,
  RewardBreakdown,
  RunGenerationRequest,
  SessionIngestRequest,
  SessionReceipt,
  SolanaRewardTransferIntent,
  SolanaRewardTransferRequest,
  SolanaWalletVerificationRequest,
  SolanaWalletVerificationResponse,
  WebhookReceipt,
} from "./types";

const DEFAULT_MODE = "myco-quest";

const zeroRewards = (): RewardBreakdown => ({
  baseSpores: 0,
  difficultyBonus: 0,
  streakMultiplier: 1,
  sourceMultiplier: 1,
  laneMultiplier: 1,
  noveltyMultiplier: 1,
  antiGrindPenalty: 1,
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
    const planned = this.director.planRun(profile, {
      encounters: request.encounters,
      seed: request.seed ?? `${playerId}:${profile.sessionsPlayed}`,
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
      nextProfile = applySessionTelemetry(profile, request.telemetry);
      this.repository.setProfile(nextProfile);

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

      rewards = rewarded.breakdown;
      nextWallet = rewarded.wallet;
      this.repository.setWallet(playerId, nextWallet);
    }

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
    const nextObjective = latestRun?.encounters.find(
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

    const proof = this.solana.verifyWalletProof({
      playerId,
      source: request.source,
      externalId: request.externalId,
      walletAddress: request.walletAddress,
      message: request.message,
      signature: request.signature,
    });

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

  async prepareSolanaRewardTransfer(
    request: SolanaRewardTransferRequest,
  ): Promise<SolanaRewardTransferIntent> {
    const intent = await this.solana.prepareSolTransfer(request);
    this.repository.setTransferIntent(intent);

    await this.emitEvent("reward_intent_prepared", {
      playerId: request.playerId,
      source: request.source,
      payload: {
        intentId: intent.id,
        lamports: intent.lamports,
        destinationWallet: intent.destinationWallet,
      },
    });

    await this.repository.save();
    return intent;
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

  getPlayerSnapshot(playerId: string): PlayerSnapshot {
    return {
      playerId,
      identities: this.repository.getIdentities(playerId),
      profile: this.repository.getOrCreateProfile(playerId),
      wallet: this.repository.getWallet(playerId),
      lastRun: this.repository.getLastRun(playerId),
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
      },
    });

    await this.repository.save();
    return merged;
  }

  async getAnalyticsSummary(limit = 300): Promise<AnalyticsSummary> {
    const events = await this.repository.getRecentEvents(limit);
    return this.analytics.summarize(events);
  }

  private async emitEvent(inputType: PlatformEventType, input: {
    playerId?: string;
    source?: EcosystemSource;
    mode?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
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

  private computeFingerprintPreview(telemetry: SessionTelemetry, score: number): string {
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
