import type { GameState } from "./GameState";

const DEFAULT_API_BASE = "";

function getApiBase(): string {
  return DEFAULT_API_BASE;
}

function requestBase(state: GameState) {
  return {
    source: "kingmyco.io",
    externalId: state.nickname || "myco-player-01",
    claims: { walletAddress: state.web3.wallet || undefined },
    clanId: state.playerClan,
    avatarId: state.playerAvatar,
  };
}

async function callApi(path: string, body: unknown): Promise<unknown> {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function linkIdentity(state: GameState): Promise<void> {
  try {
    const result = (await callApi("/api/identity/link", requestBase(state))) as Record<string, unknown>;
    if (result?.playerId) {
      state.web3.hubPlayerId = result.playerId as string;
      const wallet = result.wallet as { spores?: number } | undefined;
      if (wallet && typeof wallet.spores === "number") {
        state.web3.hubSpores = wallet.spores;
      }
    }
  } catch (_e) { /* hub unavailable */ }
}

export async function recordSession(state: GameState, battle: { encounterLane: string; turnNumber: number; rewardSpores: number }, result: "won" | "lost"): Promise<void> {
  try {
    const base = requestBase(state);
    const telemetry = {
      playerId: state.web3.hubPlayerId || base.externalId,
      completedEncounters: result === "won" ? 1 : 0,
      failedEncounters: result === "lost" ? 1 : 0,
      damageTaken: Math.max(0, state.hero.maxHp - state.hero.hp),
      perfectActions: battle.turnNumber <= 3 && result === "won" ? 1 : 0,
      discoveryActions: 0,
      riskyActions: 0,
      sessionLengthSec: Math.max(10, battle.turnNumber * 8),
      usedElements: [] as string[],
      abandoned: false,
      sporesCollected: result === "won" ? battle.rewardSpores : 0,
      morality: { compassionateActions: state.hero.morality > 0 ? 1 : 0, ruthlessActions: state.hero.morality < 0 ? 1 : 0 },
      magic: { castsByElement: {}, ritualsCompleted: [] as string[] },
      laneOutcomes: { [battle.encounterLane]: { completed: result === "won", perfectClears: battle.turnNumber <= 3 ? 1 : 0 } },
    };
    const receipt = (await callApi("/api/session/record", { ...base, score: result === "won" ? 500 + battle.rewardSpores : 120, telemetry })) as Record<string, unknown>;
    const wallet = receipt?.wallet as { spores?: number } | undefined;
    if (wallet) state.web3.hubSpores = wallet.spores ?? null;
  } catch (_e) { /* hub unavailable */ }
}

export async function connectPhantomWallet(state: GameState): Promise<boolean> {
  const provider = (window as unknown as { solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey?: { toBase58?: () => string; toString?: () => string } }> } }).solana;
  if (provider?.isPhantom) {
    try {
      const response = await provider.connect();
      const addr = response?.publicKey?.toBase58?.() ?? response?.publicKey?.toString?.() ?? "";
      if (addr) {
        state.web3.wallet = addr;
        await linkIdentity(state);
        return true;
      }
    } catch (_e) { /* user cancelled */ }
  }
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    window.open("https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href), "_blank");
  }
  return false;
}
