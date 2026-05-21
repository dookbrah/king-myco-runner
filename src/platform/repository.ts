import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInitialProfile } from "../ai/playerModel";
import { PlannedRun, PlayerProfile } from "../types";
import { LiveOpsConfig } from "./liveOps";
import { PostgresRedisAdapter } from "./postgresRedisAdapter";
import {
  createDefaultWallet,
  emptyLeaderboardTable,
  normalizePersistentState,
  PersistentState,
} from "./stateTypes";
import {
  EcosystemSource,
  IdentityClaims,
  LeaderboardTable,
  LinkedIdentity,
  PlatformEvent,
  PlayerWallet,
  SolanaRewardTransferIntent,
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

    return new KingMycoRepository(filePath, normalizePersistentState(parsed), pgRedisAdapter);
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
        ? [{ source: "mycokingdom_bot" as EcosystemSource, externalId: claims.telegramUserId, linkedAt: now }]
        : []),
      ...(claims.mycoAiUserId
        ? [{ source: "mycoai_bot" as EcosystemSource, externalId: claims.mycoAiUserId, linkedAt: now }]
        : []),
      ...(claims.kingdomAccountId
        ? [{ source: "kingdom.kingmyco.com" as EcosystemSource, externalId: claims.kingdomAccountId, linkedAt: now }]
        : []),
      ...(claims.openClawPlayerId
        ? [{ source: "openclaw" as EcosystemSource, externalId: claims.openClawPlayerId, linkedAt: now }]
        : []),
      ...(claims.walletAddress
        ? [{ source: "kingmyco.io" as EcosystemSource, externalId: claims.walletAddress, linkedAt: now }]
        : []),
    ];

    for (const identity of identityTuple) {
      if (
        !linked.some(
          (existing) =>
            existing.source === identity.source &&
            existing.externalId.toLowerCase() === identity.externalId.toLowerCase(),
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
      return existing;
    }

    const created = createInitialProfile(playerId);
    this.state.profiles[playerId] = created;
    return created;
  }

  setProfile(profile: PlayerProfile): void {
    this.state.profiles[profile.playerId] = profile;
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

  setWalletProof(proof: SolanaWalletProof): void {
    this.state.walletProofs[proof.walletAddress.toLowerCase()] = proof;
  }

  getWalletProof(walletAddress: string): SolanaWalletProof | undefined {
    return this.state.walletProofs[walletAddress.toLowerCase()];
  }

  setTransferIntent(intent: SolanaRewardTransferIntent): void {
    this.state.transferIntents[intent.id] = intent;
  }

  getTransferIntents(playerId?: string): SolanaRewardTransferIntent[] {
    const intents = Object.values(this.state.transferIntents);
    if (!playerId) {
      return intents;
    }

    return intents.filter((intent) => intent.playerId === playerId);
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
      targetWallet.sessionStreak = Math.max(targetWallet.sessionStreak, fromWallet.sessionStreak);
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
    this.state.identitiesByPlayer[targetId] = [...targetIdentities, ...fromIdentities];

    const targetFingerprints = this.state.recentFingerprints[targetId] ?? [];
    const fromFingerprints = this.state.recentFingerprints[fromId] ?? [];
    this.state.recentFingerprints[targetId] = [...targetFingerprints, ...fromFingerprints].slice(-12);

    if (!this.state.lastRunByPlayer[targetId] && this.state.lastRunByPlayer[fromId]) {
      this.state.lastRunByPlayer[targetId] = this.state.lastRunByPlayer[fromId];
    }

    for (const [identityKey, mappedPlayerId] of Object.entries(this.state.identityByKey)) {
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

    for (const [intentId, intent] of Object.entries(this.state.transferIntents)) {
      if (intent.playerId === fromId) {
        this.state.transferIntents[intentId] = {
          ...intent,
          playerId: targetId,
        };
      }
    }

    delete this.state.profiles[fromId];
    delete this.state.wallets[fromId];
    delete this.state.identitiesByPlayer[fromId];
    delete this.state.recentFingerprints[fromId];
    delete this.state.lastRunByPlayer[fromId];
  }
}
