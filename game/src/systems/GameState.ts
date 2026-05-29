import { REALM_DEFAULT_SPAWNS } from "../data/realms";

const BASE_MAX_HP = 120;

export interface HeroState {
  x: number;
  y: number;
  speed: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  magic: number;
  morality: number;
  spores: number;
  goldenSpores: number;
  armorTier: number;
  guardRank: number;
  walkFrame: number;
  facingX: number;
  facingY: number;
}

export interface Web3State {
  wallet: string;
  walletVerified: boolean;
  hubPlayerId: string | null;
  hubSpores: number | null;
  chainRank: string;
  mintedRelics: string[];
}

export interface GameState {
  mode: "intro" | "explore" | "battle" | "interior" | "burn-pit" | "cutscene";
  currentRealmId: string;
  playerClan: string;
  playerAvatar: string;
  nickname: string;
  hero: HeroState;
  web3: Web3State;
  inventory: {
    mycoPotion: number;
    manaDew: number;
    smokeBomb: number;
    armorShards: number;
    guardRunes: number;
    spellDust: number;
    bossSigils: number;
  };
  progress: {
    clues: Set<string>;
    defeatedBosses: Set<string>;
    interactedNpcs: Set<string>;
    solvedStructures: Set<string>;
    collectedPickups: Set<string>;
    enemyWins: number;
    bossWins: number;
    puzzleSolves: number;
    enemiesSpared: number;
    enemiesExecuted: number;
  };
  audio: {
    musicOn: boolean;
    sfxOn: boolean;
    musicMode: string;
  };
}

export function createInitialState(): GameState {
  const spawn = REALM_DEFAULT_SPAWNS["myco-kingdom"];
  return {
    mode: "intro",
    currentRealmId: "myco-kingdom",
    playerClan: "myco",
    playerAvatar: "crownward-sorcerer",
    nickname: "",
    hero: {
      x: spawn.x,
      y: spawn.y,
      speed: 188,
      hp: BASE_MAX_HP,
      maxHp: BASE_MAX_HP,
      attack: 1,
      defense: 1,
      magic: 1,
      morality: 0,
      spores: 0,
      goldenSpores: 0,
      armorTier: 1,
      guardRank: 1,
      walkFrame: 0,
      facingX: 0,
      facingY: 1,
    },
    web3: {
      wallet: "",
      walletVerified: false,
      hubPlayerId: null,
      hubSpores: null,
      chainRank: "Unranked",
      mintedRelics: [],
    },
    inventory: {
      mycoPotion: 2,
      manaDew: 1,
      smokeBomb: 1,
      armorShards: 0,
      guardRunes: 0,
      spellDust: 0,
      bossSigils: 0,
    },
    progress: {
      clues: new Set(),
      defeatedBosses: new Set(),
      interactedNpcs: new Set(),
      solvedStructures: new Set(),
      collectedPickups: new Set(),
      enemyWins: 0,
      bossWins: 0,
      puzzleSolves: 0,
      enemiesSpared: 0,
      enemiesExecuted: 0,
    },
    audio: {
      musicOn: true,
      sfxOn: true,
      musicMode: "title",
    },
  };
}

const STORAGE_STATE_KEY = "mycoQuestPhaserState";
const STORAGE_CONFIG_KEY = "mycoQuestPhaserConfig";

export function saveGameState(state: GameState): void {
  try {
    const data = {
      ...state,
      progress: {
        ...state.progress,
        clues: [...state.progress.clues],
        defeatedBosses: [...state.progress.defeatedBosses],
        interactedNpcs: [...state.progress.interactedNpcs],
        solvedStructures: [...state.progress.solvedStructures],
        collectedPickups: [...state.progress.collectedPickups],
      },
    };
    localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(data));
  } catch (_e) { /* quota */ }
}

export function loadGameState(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.progress) {
      parsed.progress.clues = new Set(parsed.progress.clues ?? []);
      parsed.progress.defeatedBosses = new Set(parsed.progress.defeatedBosses ?? []);
      parsed.progress.interactedNpcs = new Set(parsed.progress.interactedNpcs ?? []);
      parsed.progress.solvedStructures = new Set(parsed.progress.solvedStructures ?? []);
      parsed.progress.collectedPickups = new Set(parsed.progress.collectedPickups ?? []);
    }
    return parsed as GameState;
  } catch (_e) {
    return null;
  }
}
