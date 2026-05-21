import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInitialProfile } from "../ai/playerModel";
import { PlannedRun, PlayerProfile } from "../types";
import { DEFAULT_LIVE_OPS, LiveOpsConfig } from "./liveOps";
import {
  EcosystemSource,
  IdentityClaims,
  LeaderboardTable,
  LinkedIdentity,
  PlayerWallet,
} from "./types";

export interface PersistentState {
  profiles: Record<string, PlayerProfile>;
  wallets: Record<string, PlayerWallet>;
  identityByKey: Record<string, string>;
  identitiesByPlayer: Record<string, LinkedIdentity[]>;
  leaderboards: Record<string, LeaderboardTable>;
  liveOps: LiveOpsConfig;
  recentFingerprints: Record<string, string[]>;
  lastRunByPlayer: Record<string, PlannedRun>;
}

const defaultWallet = (): PlayerWallet => ({
  spores: 0,
  lifetimeSpores: 0,
  sessionStreak: 0,
  suspiciousSessions: 0,
});

const emptyLeaderboardTable = (): LeaderboardTable => ({
  entries: [],
  quarantined: [],
});

const normalizeState = (raw: Partial<PersistentState> | null | undefined): PersistentState => ({
  profiles: raw?.profiles ?? {},
  wallets: raw?.wallets ?? {},
  identityByKey: raw?.identityByKey ?? {},
  identitiesByPlayer: raw?.identitiesByPlayer ?? {},
  leaderboards: raw?.leaderboards ?? {},
  liveOps: raw?.liveOps ?? DEFAULT_LIVE_OPS,
  recentFingerprints: raw?.recentFingerprints ?? {},
  lastRunByPlayer: raw?.lastRunByPlayer ?? {},
});

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
  ) {}

  static async create(filePath: string): Promise<KingMycoRepository> {
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

    return new KingMycoRepository(filePath, normalizeState(parsed));
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

    const created = defaultWallet();
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

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = JSON.stringify(this.state, null, 2);

    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.filePath);
  }

  private mergePlayers(targetId: string, fromId: string): void {
    const targetProfile = this.state.profiles[targetId];
    const fromProfile = this.state.profiles[fromId];

    if (!targetProfile && fromProfile) {
      this.state.profiles[targetId] = fromProfile;
    }

    const targetWallet = this.state.wallets[targetId] ?? defaultWallet();
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

    delete this.state.profiles[fromId];
    delete this.state.wallets[fromId];
    delete this.state.identitiesByPlayer[fromId];
    delete this.state.recentFingerprints[fromId];
    delete this.state.lastRunByPlayer[fromId];
  }
}
