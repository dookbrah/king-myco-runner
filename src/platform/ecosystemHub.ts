import { AdaptiveDirector } from "../ai/adaptiveDirector";
import { applySessionTelemetry } from "../ai/playerModel";
import { PlannedRun, SessionTelemetry } from "../types";
import { average, clamp } from "../utils/math";
import { FraudGuard } from "./fraudGuard";
import { DEFAULT_LIVE_OPS, DeepPartial, LiveOpsConfig, mergeLiveOpsConfig } from "./liveOps";
import { LeaderboardService } from "./leaderboard";
import { KingMycoRepository } from "./repository";
import { RewardEconomy } from "./rewardEconomy";
import {
  CoachingRequest,
  CoachingResponse,
  EcosystemSource,
  IdentityLinkRequest,
  PlayerSnapshot,
  RewardBreakdown,
  RunGenerationRequest,
  SessionIngestRequest,
  SessionReceipt,
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

const tuneRunByLiveOps = (run: PlannedRun, liveOps: LiveOpsConfig): PlannedRun => {
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

  private constructor(private readonly repository: KingMycoRepository) {}

  static async create(statePath = "data/kingmyco-state.json"): Promise<KingMycoEcosystemHub> {
    const repository = await KingMycoRepository.create(statePath);
    return new KingMycoEcosystemHub(repository);
  }

  async linkIdentity(request: IdentityLinkRequest): Promise<PlayerSnapshot> {
    const playerId = this.repository.resolveOrCreatePlayer(
      request.source,
      request.externalId,
      request.claims,
    );

    const snapshot = this.getPlayerSnapshot(playerId);
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

    await this.repository.save();

    return {
      playerId,
      focusLane: weakestLane,
      recommendations,
      response,
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
    await this.repository.save();
    return merged;
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
      average(Object.values(telemetry.laneOutcomes ?? {}).map((lane) => (lane ? lane.wins + lane.losses : 0))),
      score,
    ].join(":");
  }
}
