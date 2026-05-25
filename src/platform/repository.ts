import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInitialProfile, normalizeProfile } from "../ai/playerModel";
import { createInitialWorldState, normalizeWorldState } from "../rpg/worldMap";
import { PlannedRun, PlayerCampaignState, PlayerProfile, TurnBattleState } from "../types";
import { clamp } from "../utils/math";
import { LiveOpsConfig } from "./liveOps";
import { PostgresRedisAdapter } from "./postgresRedisAdapter";
import {
  BurnPitEventRecord,
  BurnPitLedger,
  createDefaultWallet,
  emptyLeaderboardTable,
  normalizePersistentState,
  PersistentState,
  SporeClaimLedger,
} from "./stateTypes";
import {
  EcosystemSource,
  IdentityClaims,
  LeaderboardTable,
  LinkedIdentity,
  PlatformEvent,
  PlayerWallet,
  SolanaClaimIdempotencyRecord,
  SolanaRewardTransferIntent,
  SolanaWalletChallenge,
  SolanaWalletProof,
} from "./types";

const createIdentityKeys = (
  source: EcosystemSource,
  externalId: string,
  claims: IdentityClaims = {},
): string[] => {
  const keys = [`source:${source}:${externalId.trim().toLowerCase()}`];

  if (claims.walletAddress) {
    keys.push(`wallet:${claims.walletAddress.trim().toLowerCase()}`);
  }

  if (claims.telegramUserId) {
    keys.push(`telegram:${claims.telegramUserId.trim().toLowerCase()}`);
  }

  if (claims.kingdomAccountId) {
    keys.push(`kingdom:${claims.kingdomAccountId.trim().toLowerCase()}`);
  }

  if (claims.openClawPlayerId) {
    keys.push(`openclaw:${claims.openClawPlayerId.trim().toLowerCase()}`);
  }

  if (claims.mycoAiUserId) {
    keys.push(`mycoai:${claims.mycoAiUserId.trim().toLowerCase()}`);
  }

  return keys;
};

const challengeKey = (playerId: string, walletAddress: string): string => {
  return `${playerId}:${walletAddress.trim().toLowerCase()}`;
};

const CLAIM_HISTORY_KEEP_SEC = 72 * 60 * 60;
const CLAIM_WINDOW_SEC = 60 * 60;
const RISK_SCORE_MAX = 1;

export class KingMycoRepository {
  private constructor(
    private readonly filePath: string,
    private state: PersistentState,
    private readonly pgRedisAdapter?: PostgresRedisAdapter,
  ) {}

  static async create(filePath: string): Promise<KingMycoRepository> {
    const pgRedisAdapter = await PostgresRedisAdapter.fromEnv();

    let parsed: Partial<PersistentState> | null = null;

    try {
      const raw = await readFile(filePath, "utf8");
      parsed = JSON.parse(raw) as Partial<PersistentState>;
    } catch (error) {
      const maybe = error as NodeJS.ErrnoException;
      if (maybe.code !== "ENOENT") {
        throw error;
      }
    }

    if (!parsed && pgRedisAdapter) {
      parsed = await pgRedisAdapter.loadSnapshot();
    }

    return new KingMycoRepository(
      filePath,
      normalizePersistentState(parsed),
      pgRedisAdapter,
    );
  }

  lookupPlayerId(
    source: EcosystemSource,
    externalId: string,
  ): string | undefined {
    const key = `source:${source}:${externalId.trim().toLowerCase()}`;
    return this.state.identityByKey[key];
  }

  resolveOrCreatePlayer(
    source: EcosystemSource,
    externalId: string,
    claims: IdentityClaims = {},
  ): string {
    const keys = createIdentityKeys(source, externalId, claims);
    const matchedIds = keys
      .map((key) => this.state.identityByKey[key])
      .filter((value): value is string => Boolean(value));

    let playerId = matchedIds[0];
    if (!playerId) {
      playerId = randomUUID();
    }

    if (matchedIds.length > 1) {
      for (const duplicateId of matchedIds.slice(1)) {
        if (duplicateId !== playerId) {
          this.mergePlayers(playerId, duplicateId);
        }
      }
    }

    for (const key of keys) {
      this.state.identityByKey[key] = playerId;
    }

    const linked = this.state.identitiesByPlayer[playerId] ?? [];
    const now = new Date().toISOString();

    const identityTuple: LinkedIdentity[] = [
      { source, externalId, linkedAt: now },
      ...(claims.telegramUserId
        ? [
            {
              source: "mycokingdom_bot" as EcosystemSource,
              externalId: claims.telegramUserId,
              linkedAt: now,
            },
          ]
        : []),
      ...(claims.mycoAiUserId
        ? [
            {
              source: "mycoai_bot" as EcosystemSource,
              externalId: claims.mycoAiUserId,
              linkedAt: now,
            },
          ]
        : []),
      ...(claims.kingdomAccountId
        ? [
            {
              source: "kingdom.kingmyco.com" as EcosystemSource,
              externalId: claims.kingdomAccountId,
              linkedAt: now,
            },
          ]
        : []),
      ...(claims.openClawPlayerId
        ? [
            {
              source: "openclaw" as EcosystemSource,
              externalId: claims.openClawPlayerId,
              linkedAt: now,
            },
          ]
        : []),
      ...(claims.walletAddress
        ? [
            {
              source: "kingmyco.io" as EcosystemSource,
              externalId: claims.walletAddress,
              linkedAt: now,
            },
          ]
        : []),
    ];

    for (const identity of identityTuple) {
      if (
        !linked.some(
          (existing) =>
            existing.source === identity.source &&
            existing.externalId.toLowerCase() ===
              identity.externalId.toLowerCase(),
        )
      ) {
        linked.push(identity);
      }
    }

    this.state.identitiesByPlayer[playerId] = linked;
    return playerId;
  }

  getOrCreateProfile(playerId: string): PlayerProfile {
    const existing = this.state.profiles[playerId];
    if (existing) {
      const normalized = normalizeProfile(existing);
      this.state.profiles[playerId] = normalized;
      return normalized;
    }

    const created = createInitialProfile(playerId);
    this.state.profiles[playerId] = created;
    return created;
  }

  setProfile(profile: PlayerProfile): void {
    this.state.profiles[profile.playerId] = normalizeProfile(profile);
  }

  getWallet(playerId: string): PlayerWallet {
    const existing = this.state.wallets[playerId];
    if (existing) {
      return existing;
    }

    const created = createDefaultWallet();
    this.state.wallets[playerId] = created;
    return created;
  }

  setWallet(playerId: string, wallet: PlayerWallet): void {
    this.state.wallets[playerId] = wallet;
  }

  getBurnPitLedger(playerId: string): BurnPitLedger {
    const existing = this.state.burnPitLedgers[playerId];
    if (existing) {
      const normalized: BurnPitLedger = {
        totalBurned: Math.max(0, Math.floor(existing.totalBurned ?? 0)),
        dailyBurned: existing.dailyBurned ?? {},
        lastBurnAt: existing.lastBurnAt,
        events: Array.isArray(existing.events) ? existing.events.slice(-80) : [],
      };
      this.state.burnPitLedgers[playerId] = normalized;
      return normalized;
    }

    const created: BurnPitLedger = {
      totalBurned: 0,
      dailyBurned: {},
      events: [],
    };
    this.state.burnPitLedgers[playerId] = created;
    return created;
  }

  recordBurnPitEvent(
    playerId: string,
    event: Omit<BurnPitEventRecord, "id">,
  ): BurnPitLedger {
    const ledger = this.getBurnPitLedger(playerId);
    const amount = Math.max(0, Math.floor(event.sporesBurned));
    const dayKey = event.dayKey;
    ledger.totalBurned += amount;
    ledger.dailyBurned[dayKey] = (ledger.dailyBurned[dayKey] ?? 0) + amount;
    ledger.lastBurnAt = event.timestamp;
    ledger.events.unshift({
      id: randomUUID(),
      ...event,
      sporesBurned: amount,
    });
    ledger.events = ledger.events.slice(0, 80);
    const keptDays = Object.entries(ledger.dailyBurned)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-45);
    ledger.dailyBurned = Object.fromEntries(keptDays);
    this.state.burnPitLedgers[playerId] = ledger;
    return ledger;
  }


  getClaimLedger(playerId: string): SporeClaimLedger {
    const existing = this.state.claimLedgers[playerId];
    if (existing) {
      return existing;
    }

    const created: SporeClaimLedger = {
      dailyRedeemed: {},
    };

    this.state.claimLedgers[playerId] = created;
    return created;
  }

  applyClaimLedgerDelta(
    playerId: string,
    timestampIso: string,
    deltaSpores: number,
  ): SporeClaimLedger {
    const ledger = this.getClaimLedger(playerId);
    const dayKey = this.toUtcDayKey(timestampIso);
    const current = ledger.dailyRedeemed[dayKey] ?? 0;

    const next = Math.max(0, current + Math.round(deltaSpores));
    if (next === 0) {
      delete ledger.dailyRedeemed[dayKey];
    } else {
      ledger.dailyRedeemed[dayKey] = next;
    }

    if (deltaSpores > 0) {
      ledger.lastClaimAt = timestampIso;
    }

    const keptEntries = Object.entries(ledger.dailyRedeemed)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-35);
    ledger.dailyRedeemed = Object.fromEntries(keptEntries);

    this.state.claimLedgers[playerId] = ledger;
    return ledger;
  }

  getLiveOps(): LiveOpsConfig {
    return this.state.liveOps;
  }

  setLiveOps(config: LiveOpsConfig): void {
    this.state.liveOps = config;
  }

  getIdentities(playerId: string): LinkedIdentity[] {
    return this.state.identitiesByPlayer[playerId] ?? [];
  }

  getLeaderboard(mode: string): LeaderboardTable {
    return this.state.leaderboards[mode] ?? emptyLeaderboardTable();
  }

  setLeaderboard(mode: string, table: LeaderboardTable): void {
    this.state.leaderboards[mode] = table;
  }

  hasRecentFingerprint(playerId: string, fingerprint: string): boolean {
    const history = this.state.recentFingerprints[playerId] ?? [];
    return history.includes(fingerprint);
  }

  addFingerprint(playerId: string, fingerprint: string): void {
    const history = this.state.recentFingerprints[playerId] ?? [];
    history.push(fingerprint);
    this.state.recentFingerprints[playerId] = history.slice(-12);
  }

  getLastRun(playerId: string): PlannedRun | undefined {
    return this.state.lastRunByPlayer[playerId];
  }

  setLastRun(playerId: string, run: PlannedRun): void {
    this.state.lastRunByPlayer[playerId] = run;
  }

  getOrCreateCampaign(playerId: string): PlayerCampaignState {
    const existing = this.state.campaigns[playerId];
    if (existing) {
      const normalized: PlayerCampaignState = {
        ...existing,
        playerId,
        world: normalizeWorldState(existing.world),
        victories: Math.max(0, Math.floor(existing.victories ?? 0)),
        defeats: Math.max(0, Math.floor(existing.defeats ?? 0)),
      };
      this.state.campaigns[playerId] = normalized;
      return normalized;
    }

    const created: PlayerCampaignState = {
      playerId,
      world: createInitialWorldState(),
      victories: 0,
      defeats: 0,
    };
    this.state.campaigns[playerId] = created;
    return created;
  }

  setCampaign(campaign: PlayerCampaignState): void {
    this.state.campaigns[campaign.playerId] = {
      ...campaign,
      world: normalizeWorldState(campaign.world),
      victories: Math.max(0, Math.floor(campaign.victories ?? 0)),
      defeats: Math.max(0, Math.floor(campaign.defeats ?? 0)),
    };
  }

  getActiveBattle(playerId: string): TurnBattleState | undefined {
    return this.getOrCreateCampaign(playerId).activeBattle;
  }

  setActiveBattle(playerId: string, battle: TurnBattleState): void {
    const campaign = this.getOrCreateCampaign(playerId);
    this.state.campaigns[playerId] = {
      ...campaign,
      activeBattle: battle,
    };
  }

  clearActiveBattle(playerId: string): void {
    const campaign = this.getOrCreateCampaign(playerId);
    this.state.campaigns[playerId] = {
      ...campaign,
      activeBattle: undefined,
    };
  }

  setWalletProof(proof: SolanaWalletProof): void {
    this.state.walletProofs[proof.walletAddress.toLowerCase()] = proof;
  }

  getWalletProof(walletAddress: string): SolanaWalletProof | undefined {
    return this.state.walletProofs[walletAddress.toLowerCase()];
  }

  setWalletChallenge(challenge: SolanaWalletChallenge): void {
    this.state.walletChallenges[
      challengeKey(challenge.playerId, challenge.walletAddress)
    ] = challenge;
  }

  getWalletChallenge(
    playerId: string,
    walletAddress: string,
  ): SolanaWalletChallenge | undefined {
    return this.state.walletChallenges[challengeKey(playerId, walletAddress)];
  }

  consumeWalletChallenge(playerId: string, walletAddress: string): void {
    const key = challengeKey(playerId, walletAddress);
    const existing = this.state.walletChallenges[key];
    if (!existing) {
      return;
    }

    this.state.walletChallenges[key] = {
      ...existing,
      consumedAt: new Date().toISOString(),
    };
  }

  setTransferIntent(intent: SolanaRewardTransferIntent): void {
    this.state.transferIntents[intent.id] = intent;
  }

  getTransferIntent(intentId: string): SolanaRewardTransferIntent | undefined {
    return this.state.transferIntents[intentId];
  }

  getTransferIntents(playerId?: string): SolanaRewardTransferIntent[] {
    const intents = Object.values(this.state.transferIntents);
    if (!playerId) {
      return intents;
    }

    return intents.filter((intent) => intent.playerId === playerId);
  }


  setClaimIdempotencyRecord(record: SolanaClaimIdempotencyRecord): void {
    this.state.claimIdempotency[
      this.createClaimIdempotencyKey(record.playerId, record.source, record.key)
    ] = record;
  }

  getClaimIdempotencyRecord(
    playerId: string,
    source: EcosystemSource,
    key: string,
  ): SolanaClaimIdempotencyRecord | undefined {
    return this.state.claimIdempotency[
      this.createClaimIdempotencyKey(playerId, source, key)
    ];
  }

  getClaimVelocitySnapshot(input: {
    walletAddress: string;
    clientIp?: string;
    nowIso: string;
  }): {
    walletClaimsLastHour: number;
    ipClaimsLastHour: number;
    uniqueWalletsForIpToday: number;
    ipHasWalletToday: boolean;
  } {
    const walletKey = input.walletAddress.trim().toLowerCase();
    const nowMs = Date.parse(input.nowIso);

    const walletHistory = this.pruneClaimHistory(
      this.state.claimVelocity.walletClaimTimestamps[walletKey] ?? [],
      nowMs,
    );
    this.state.claimVelocity.walletClaimTimestamps[walletKey] = walletHistory;

    let ipHistory: string[] = [];
    let uniqueWalletsForIpToday = 0;
    let ipHasWalletToday = false;

    if (input.clientIp) {
      const ipKey = input.clientIp.trim().toLowerCase();
      ipHistory = this.pruneClaimHistory(
        this.state.claimVelocity.ipClaimTimestamps[ipKey] ?? [],
        nowMs,
      );
      this.state.claimVelocity.ipClaimTimestamps[ipKey] = ipHistory;

      const dayKey = this.toUtcDayKey(input.nowIso);
      const ipDayKey = this.createIpDayKey(ipKey, dayKey);
      const walletSet = new Set(this.state.claimVelocity.ipWalletDaily[ipDayKey] ?? []);
      uniqueWalletsForIpToday = walletSet.size;
      ipHasWalletToday = walletSet.has(walletKey);
    }

    return {
      walletClaimsLastHour: this.countHistoryInWindow(walletHistory, nowMs, CLAIM_WINDOW_SEC),
      ipClaimsLastHour: this.countHistoryInWindow(ipHistory, nowMs, CLAIM_WINDOW_SEC),
      uniqueWalletsForIpToday,
      ipHasWalletToday,
    };
  }

  recordClaimVelocity(input: {
    walletAddress: string;
    clientIp?: string;
    timestampIso: string;
  }): void {
    const walletKey = input.walletAddress.trim().toLowerCase();
    const nowMs = Date.parse(input.timestampIso);

    const walletHistory = this.pruneClaimHistory(
      this.state.claimVelocity.walletClaimTimestamps[walletKey] ?? [],
      nowMs,
    );
    walletHistory.push(input.timestampIso);
    this.state.claimVelocity.walletClaimTimestamps[walletKey] = walletHistory;

    if (!input.clientIp) {
      return;
    }

    const ipKey = input.clientIp.trim().toLowerCase();
    const ipHistory = this.pruneClaimHistory(
      this.state.claimVelocity.ipClaimTimestamps[ipKey] ?? [],
      nowMs,
    );
    ipHistory.push(input.timestampIso);
    this.state.claimVelocity.ipClaimTimestamps[ipKey] = ipHistory;

    const dayKey = this.toUtcDayKey(input.timestampIso);
    const ipDayKey = this.createIpDayKey(ipKey, dayKey);
    const walletSet = new Set(this.state.claimVelocity.ipWalletDaily[ipDayKey] ?? []);
    walletSet.add(walletKey);
    this.state.claimVelocity.ipWalletDaily[ipDayKey] = Array.from(walletSet);

    const oldDayPrefix = `${ipKey}:`;
    const cutoffDay = this.toUtcDayKey(new Date(nowMs - 35 * 24 * 60 * 60 * 1000).toISOString());
    for (const key of Object.keys(this.state.claimVelocity.ipWalletDaily)) {
      if (!key.startsWith(oldDayPrefix)) {
        continue;
      }

      const day = key.slice(oldDayPrefix.length);
      if (day < cutoffDay) {
        delete this.state.claimVelocity.ipWalletDaily[key];
      }
    }
  }

  getAdaptiveRiskSnapshot(input: {
    playerId: string;
    clientIp?: string;
    nowIso: string;
    decayPerHour: number;
  }): {
    playerRisk: number;
    ipRisk: number;
    maxRisk: number;
  } {
    const nowIso = this.normalizeIso(input.nowIso);
    const playerRisk = this.getDecayedRiskScore(
      this.state.adaptiveRisk.playerScores,
      input.playerId,
      nowIso,
      input.decayPerHour,
    );

    const ipKey = input.clientIp?.trim().toLowerCase();
    const ipRisk = ipKey
      ? this.getDecayedRiskScore(
          this.state.adaptiveRisk.ipScores,
          ipKey,
          nowIso,
          input.decayPerHour,
        )
      : 0;

    return {
      playerRisk,
      ipRisk,
      maxRisk: Math.max(playerRisk, ipRisk),
    };
  }

  adjustAdaptiveRisk(input: {
    playerId: string;
    clientIp?: string;
    nowIso: string;
    decayPerHour: number;
    playerDelta?: number;
    ipDelta?: number;
  }): {
    playerRisk: number;
    ipRisk: number;
    maxRisk: number;
  } {
    const nowIso = this.normalizeIso(input.nowIso);
    const playerRisk = this.updateRiskScore(
      this.state.adaptiveRisk.playerScores,
      input.playerId,
      nowIso,
      input.decayPerHour,
      input.playerDelta ?? 0,
    );

    const ipKey = input.clientIp?.trim().toLowerCase();
    const ipRisk = ipKey
      ? this.updateRiskScore(
          this.state.adaptiveRisk.ipScores,
          ipKey,
          nowIso,
          input.decayPerHour,
          input.ipDelta ?? 0,
        )
      : 0;

    return {
      playerRisk,
      ipRisk,
      maxRisk: Math.max(playerRisk, ipRisk),
    };
  }

  async appendEvent(event: PlatformEvent): Promise<void> {
    this.state.events.push(event);
    this.state.events = this.state.events.slice(-5000);

    if (this.pgRedisAdapter) {
      await this.pgRedisAdapter.appendEvent(event);
    }
  }

  async getRecentEvents(limit: number): Promise<PlatformEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 2000));

    if (this.state.events.length > 0) {
      return [...this.state.events].slice(-safeLimit);
    }

    if (this.pgRedisAdapter) {
      return this.pgRedisAdapter.readRecentEvents(safeLimit);
    }

    return [];
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = JSON.stringify(this.state, null, 2);

    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.filePath);

    if (this.pgRedisAdapter) {
      await this.pgRedisAdapter.saveSnapshot(this.state);
    }
  }

  private mergePlayers(targetId: string, fromId: string): void {
    const targetProfile = this.state.profiles[targetId];
    const fromProfile = this.state.profiles[fromId];

    if (!targetProfile && fromProfile) {
      this.state.profiles[targetId] = fromProfile;
    }

    const targetWallet = this.state.wallets[targetId] ?? createDefaultWallet();
    const fromWallet = this.state.wallets[fromId];
    if (fromWallet) {
      targetWallet.spores += fromWallet.spores;
      targetWallet.lifetimeSpores += fromWallet.lifetimeSpores;
      targetWallet.sessionStreak = Math.max(
        targetWallet.sessionStreak,
        fromWallet.sessionStreak,
      );
      targetWallet.suspiciousSessions += fromWallet.suspiciousSessions;
      targetWallet.lastSessionAt =
        targetWallet.lastSessionAt && fromWallet.lastSessionAt
          ? targetWallet.lastSessionAt > fromWallet.lastSessionAt
            ? targetWallet.lastSessionAt
            : fromWallet.lastSessionAt
          : targetWallet.lastSessionAt ?? fromWallet.lastSessionAt;
    }
    this.state.wallets[targetId] = targetWallet;

    const targetIdentities = this.state.identitiesByPlayer[targetId] ?? [];
    const fromIdentities = this.state.identitiesByPlayer[fromId] ?? [];
    this.state.identitiesByPlayer[targetId] = [
      ...targetIdentities,
      ...fromIdentities,
    ];

    const targetFingerprints = this.state.recentFingerprints[targetId] ?? [];
    const fromFingerprints = this.state.recentFingerprints[fromId] ?? [];
    this.state.recentFingerprints[targetId] = [
      ...targetFingerprints,
      ...fromFingerprints,
    ].slice(-12);

    if (
      !this.state.lastRunByPlayer[targetId] &&
      this.state.lastRunByPlayer[fromId]
    ) {
      this.state.lastRunByPlayer[targetId] = this.state.lastRunByPlayer[fromId];
    }

    const targetCampaign =
      this.state.campaigns[targetId] ??
      ({
        playerId: targetId,
        world: createInitialWorldState(),
        victories: 0,
        defeats: 0,
      } as PlayerCampaignState);
    const fromCampaign = this.state.campaigns[fromId];
    if (fromCampaign) {
      targetCampaign.world = normalizeWorldState({
        currentRegionId: fromCampaign.world.currentRegionId,
        discoveredRegionIds: [
          ...targetCampaign.world.discoveredRegionIds,
          ...fromCampaign.world.discoveredRegionIds,
        ],
        conqueredRegionIds: [
          ...targetCampaign.world.conqueredRegionIds,
          ...fromCampaign.world.conqueredRegionIds,
        ],
        travelHistory: [
          ...targetCampaign.world.travelHistory,
          ...fromCampaign.world.travelHistory,
        ],
      });
      targetCampaign.victories += fromCampaign.victories;
      targetCampaign.defeats += fromCampaign.defeats;
      targetCampaign.activeBattle = targetCampaign.activeBattle ?? fromCampaign.activeBattle;
      targetCampaign.lastTravelAt =
        targetCampaign.lastTravelAt && fromCampaign.lastTravelAt
          ? targetCampaign.lastTravelAt > fromCampaign.lastTravelAt
            ? targetCampaign.lastTravelAt
            : fromCampaign.lastTravelAt
          : targetCampaign.lastTravelAt ?? fromCampaign.lastTravelAt;
    }
    this.state.campaigns[targetId] = targetCampaign;

    for (const [identityKey, mappedPlayerId] of Object.entries(
      this.state.identityByKey,
    )) {
      if (mappedPlayerId === fromId) {
        this.state.identityByKey[identityKey] = targetId;
      }
    }

    for (const proof of Object.values(this.state.walletProofs)) {
      if (proof.playerId === fromId) {
        this.state.walletProofs[proof.walletAddress.toLowerCase()] = {
          ...proof,
          playerId: targetId,
        };
      }
    }

    for (const [key, challenge] of Object.entries(this.state.walletChallenges)) {
      if (challenge.playerId === fromId) {
        this.state.walletChallenges[key] = {
          ...challenge,
          playerId: targetId,
        };
      }
    }

    const targetLedger = this.state.claimLedgers[targetId] ?? { dailyRedeemed: {} };
    const fromLedger = this.state.claimLedgers[fromId];
    if (fromLedger) {
      for (const [day, amount] of Object.entries(fromLedger.dailyRedeemed)) {
        targetLedger.dailyRedeemed[day] =
          (targetLedger.dailyRedeemed[day] ?? 0) + amount;
      }

      if (
        fromLedger.lastClaimAt &&
        (!targetLedger.lastClaimAt || fromLedger.lastClaimAt > targetLedger.lastClaimAt)
      ) {
        targetLedger.lastClaimAt = fromLedger.lastClaimAt;
      }
    }
    this.state.claimLedgers[targetId] = targetLedger;

    const targetBurnLedger = this.state.burnPitLedgers[targetId] ?? {
      totalBurned: 0,
      dailyBurned: {},
      events: [],
    };
    const fromBurnLedger = this.state.burnPitLedgers[fromId];
    if (fromBurnLedger) {
      targetBurnLedger.totalBurned += Math.max(0, Math.floor(fromBurnLedger.totalBurned ?? 0));
      for (const [day, amount] of Object.entries(fromBurnLedger.dailyBurned ?? {})) {
        targetBurnLedger.dailyBurned[day] =
          (targetBurnLedger.dailyBurned[day] ?? 0) + Math.max(0, Math.floor(amount));
      }
      targetBurnLedger.events = [
        ...(Array.isArray(fromBurnLedger.events) ? fromBurnLedger.events : []),
        ...targetBurnLedger.events,
      ].slice(0, 80);
      if (
        fromBurnLedger.lastBurnAt &&
        (!targetBurnLedger.lastBurnAt || fromBurnLedger.lastBurnAt > targetBurnLedger.lastBurnAt)
      ) {
        targetBurnLedger.lastBurnAt = fromBurnLedger.lastBurnAt;
      }
    }
    this.state.burnPitLedgers[targetId] = targetBurnLedger;

    const targetRisk = this.state.adaptiveRisk.playerScores[targetId];
    const fromRisk = this.state.adaptiveRisk.playerScores[fromId];
    if (fromRisk) {
      const mergedScore = Math.max(targetRisk?.score ?? 0, fromRisk.score);
      const mergedUpdatedAt =
        targetRisk && targetRisk.lastUpdatedAt > fromRisk.lastUpdatedAt
          ? targetRisk.lastUpdatedAt
          : fromRisk.lastUpdatedAt;
      this.state.adaptiveRisk.playerScores[targetId] = {
        score: mergedScore,
        lastUpdatedAt: mergedUpdatedAt,
      };
    }

    for (const [intentId, intent] of Object.entries(this.state.transferIntents)) {
      if (intent.playerId === fromId) {
        this.state.transferIntents[intentId] = {
          ...intent,
          playerId: targetId,
        };
      }
    }


    for (const [key, record] of Object.entries(this.state.claimIdempotency)) {
      if (record.playerId === fromId) {
        delete this.state.claimIdempotency[key];
        this.state.claimIdempotency[
          this.createClaimIdempotencyKey(targetId, record.source, record.key)
        ] = {
          ...record,
          playerId: targetId,
        };
      }
    }

    delete this.state.profiles[fromId];
    delete this.state.wallets[fromId];
    delete this.state.identitiesByPlayer[fromId];
    delete this.state.recentFingerprints[fromId];

    delete this.state.lastRunByPlayer[fromId];
    delete this.state.campaigns[fromId];
    delete this.state.claimLedgers[fromId];
    delete this.state.burnPitLedgers[fromId];
    delete this.state.adaptiveRisk.playerScores[fromId];
  }

  private toUtcDayKey(timestampIso: string): string {
    const date = new Date(timestampIso);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }

    return date.toISOString().slice(0, 10);
  }

  private pruneClaimHistory(history: string[], nowMs: number): string[] {
    const cutoffMs = nowMs - CLAIM_HISTORY_KEEP_SEC * 1000;
    const pruned = history.filter((timestampIso) => {
      const ts = Date.parse(timestampIso);
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });

    if (pruned.length <= 2000) {
      return pruned;
    }

    return pruned.slice(-2000);
  }

  private countHistoryInWindow(
    history: string[],
    nowMs: number,
    windowSec: number,
  ): number {
    const cutoffMs = nowMs - windowSec * 1000;
    let count = 0;

    for (const timestampIso of history) {
      const ts = Date.parse(timestampIso);
      if (!Number.isNaN(ts) && ts >= cutoffMs) {
        count += 1;
      }
    }

    return count;
  }

  private createIpDayKey(ip: string, dayKey: string): string {
    return `${ip}:${dayKey}`;
  }

  private normalizeIso(timestampIso: string): string {
    const timestampMs = Date.parse(timestampIso);
    if (Number.isNaN(timestampMs)) {
      return new Date().toISOString();
    }

    return new Date(timestampMs).toISOString();
  }

  private getDecayedRiskScore(
    scores: Record<string, { score: number; lastUpdatedAt: string }>,
    key: string,
    nowIso: string,
    decayPerHour: number,
  ): number {
    const nowMs = Date.parse(nowIso);
    const existing = scores[key];
    if (!existing) {
      return 0;
    }

    const lastMs = Date.parse(existing.lastUpdatedAt);
    const hoursElapsed =
      Number.isNaN(lastMs) || lastMs >= nowMs ? 0 : (nowMs - lastMs) / (60 * 60 * 1000);
    const decayed = clamp(existing.score - hoursElapsed * Math.max(0, decayPerHour), 0, RISK_SCORE_MAX);

    if (decayed === 0) {
      delete scores[key];
      return 0;
    }

    scores[key] = {
      score: decayed,
      lastUpdatedAt: nowIso,
    };

    return decayed;
  }

  private updateRiskScore(
    scores: Record<string, { score: number; lastUpdatedAt: string }>,
    key: string,
    nowIso: string,
    decayPerHour: number,
    delta: number,
  ): number {
    const base = this.getDecayedRiskScore(scores, key, nowIso, decayPerHour);
    const next = clamp(base + delta, 0, RISK_SCORE_MAX);
    if (next === 0) {
      delete scores[key];
      return 0;
    }

    scores[key] = {
      score: next,
      lastUpdatedAt: nowIso,
    };

    return next;
  }

  private createClaimIdempotencyKey(
    playerId: string,
    source: EcosystemSource,
    key: string,
  ): string {
    return `${playerId}:${source}:${key.trim().toLowerCase()}`;
  }
}
