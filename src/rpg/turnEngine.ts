import { randomUUID } from "node:crypto";
import { createSeededRng, pickOne } from "../engine/random";
import { clamp, roundTo } from "../utils/math";
import {
  ChallengeLane,
  Element,
  PlannedRun,
  PlayerCampaignState,
  PlayerProfile,
  TurnActionInput,
  TurnBattleState,
  TurnCombatant,
} from "../types";
import { getRegionById } from "./worldMap";

const ALL_LANES: ChallengeLane[] = [
  "mobility",
  "swarm",
  "tactics",
  "boss",
  "puzzle",
];

const ENEMY_NAMES_BY_LANE: Record<ChallengeLane, string[]> = {
  mobility: ["Skyrift Stalker", "Windspore Runner", "Flashvine Prowler"],
  swarm: ["Hive Tendril", "Spore Broodmother", "Razor Bloom Pack"],
  tactics: ["Aegis Interceptor", "Obelisk Strategist", "Runic Duelist"],
  boss: ["Sanctum Warden", "Rift Tyrant", "Crown of Spores"],
  puzzle: ["Clockroot Sentinel", "Cipher Bloom", "Echo Mender"],
};

const defaultCombatant = (
  input: Partial<TurnCombatant> & Pick<TurnCombatant, "id" | "name" | "hp" | "maxHp">,
): TurnCombatant => ({
  guard: 0,
  ...input,
});

const computePlayerDamage = (
  battle: TurnBattleState,
  profile: PlayerProfile,
  action: TurnActionInput,
): number => {
  const element = action.element;
  const mastery = element ? profile.magicMastery[element] ?? 0 : 0;
  const elementBonus = action.kind === "skill" ? 4 + mastery * 6 : mastery * 3;
  const laneBonus = profile.laneMastery[battle.encounterLane] * 4.5;
  const base = 11 + profile.skill * 8 + laneBonus + elementBonus;

  if (action.kind === "guard") {
    return 3 + profile.playstyle.precision * 2;
  }

  if (action.kind === "skill") {
    return base + 4;
  }

  return base;
};

const computeEnemyDamage = (
  battle: TurnBattleState,
  profile: PlayerProfile,
  rng: () => number,
): { damage: number; intent: string } => {
  const regionThreat = getRegionById(battle.regionId)?.threatLevel ?? 3;
  const pressure = clamp(
    regionThreat * 0.12 + battle.turnNumber * 0.04 + profile.novelty * 0.2,
    0.2,
    1.6,
  );
  const intentRoll = rng();
  if (intentRoll < 0.22) {
    return {
      damage: 7 + pressure * 4,
      intent: "feints, probing for a weak guard.",
    };
  }

  if (intentRoll > 0.78) {
    return {
      damage: 12 + pressure * 6.5,
      intent: "commits to a heavy burst lane strike.",
    };
  }

  return {
    damage: 9 + pressure * 5.2,
    intent: "pushes steady pressure through your front lane.",
  };
};

const resolveGuard = (action: TurnActionInput, profile: PlayerProfile): number => {
  if (action.kind === "guard") {
    return roundTo(clamp(0.35 + profile.playstyle.precision * 0.35, 0.2, 0.75), 3);
  }

  if (action.kind === "skill") {
    return roundTo(clamp(0.1 + profile.playstyle.precision * 0.15, 0.05, 0.3), 3);
  }

  return roundTo(clamp(0.05 + profile.playstyle.precision * 0.08, 0, 0.18), 3);
};

const chooseEncounterLane = (
  profile: PlayerProfile,
  run?: PlannedRun,
  rng?: () => number,
  preferredLane?: string,
): ChallengeLane => {
  if (preferredLane && ALL_LANES.includes(preferredLane as ChallengeLane)) {
    return preferredLane as ChallengeLane;
  }
  if (run?.objective?.targetLane) {
    return run.objective.targetLane;
  }

  if (run?.encounters?.length) {
    const localRng = rng ?? createSeededRng(run.seed);
    return pickOne(
      run.encounters.map((encounter) => encounter.lane),
      localRng,
    );
  }

  return [...ALL_LANES].sort(
    (left, right) => profile.laneMastery[left] - profile.laneMastery[right],
  )[0];
};

export const startTurnBattle = (input: {
  playerId: string;
  profile: PlayerProfile;
  campaign: PlayerCampaignState;
  run?: PlannedRun;
  preferredLane?: string;
}): TurnBattleState => {
  const battleId = randomUUID();
  const seed = `${input.playerId}:${battleId}:${input.campaign.victories}:${input.campaign.defeats}`;
  const rng = createSeededRng(seed);
  const lane = chooseEncounterLane(input.profile, input.run, rng, input.preferredLane);
  const region = getRegionById(input.campaign.world.currentRegionId);
  const regionThreat = region?.threatLevel ?? 3;
  const enemyName = pickOne(ENEMY_NAMES_BY_LANE[lane], rng);
  const enemyElement = pickOne(
    (region?.recommendedElements ?? ["fire", "water"]) as Element[],
    rng,
  );

  const playerMaxHp = Math.round(92 + input.profile.skill * 42 + input.profile.novelty * 16);
  const enemyMaxHp = Math.round(78 + regionThreat * 14 + input.profile.sessionsPlayed * 1.2);
  const rewardSpores = Math.round(65 + regionThreat * 24 + input.campaign.victories * 6);
  const now = new Date().toISOString();

  return {
    battleId,
    playerId: input.playerId,
    regionId: input.campaign.world.currentRegionId,
    encounterLane: lane,
    status: "active",
    turnNumber: 1,
    player: defaultCombatant({
      id: `${input.playerId}:hero`,
      name: "Myco Warden",
      hp: playerMaxHp,
      maxHp: playerMaxHp,
      elementAffinity: input.profile.unlockedElements[0],
      intentHint: "Hold the lane and finish clean rotations.",
    }),
    enemy: defaultCombatant({
      id: `${battleId}:enemy`,
      name: enemyName,
      hp: enemyMaxHp,
      maxHp: enemyMaxHp,
      elementAffinity: enemyElement,
      intentHint: "The enemy gathers pressure...",
    }),
    battleLog: [
      `Battle started in ${region?.name ?? "Unknown Region"} (${lane} lane).`,
      `${enemyName} emerges with ${enemyElement} attunement.`,
    ],
    startedAt: now,
    updatedAt: now,
    rewardSpores,
  };
};

export const resolveTurnAction = (input: {
  battle: TurnBattleState;
  profile: PlayerProfile;
  action: TurnActionInput;
}): TurnBattleState => {
  const { battle, profile, action } = input;
  if (battle.status !== "active") {
    throw new Error("Battle is not active");
  }

  const rng = createSeededRng(`${battle.battleId}:${battle.turnNumber}:${action.kind}:${action.element ?? "none"}`);

  const playerDamage = computePlayerDamage(battle, profile, action);
  const enemyDamageDetails = computeEnemyDamage(battle, profile, rng);
  const nextGuard = resolveGuard(action, profile);

  const enemyRemainingHp = clamp(battle.enemy.hp - playerDamage, 0, battle.enemy.maxHp);
  let playerRemainingHp = battle.player.hp;

  const battleLog = [...battle.battleLog];
  battleLog.push(
    `Turn ${battle.turnNumber}: player uses ${action.kind}${action.element ? ` (${action.element})` : ""} for ${roundTo(playerDamage, 1)} damage.`,
  );

  if (enemyRemainingHp > 0) {
    const reducedDamage = enemyDamageDetails.damage * (1 - nextGuard);
    playerRemainingHp = clamp(playerRemainingHp - reducedDamage, 0, battle.player.maxHp);
    battleLog.push(
      `${battle.enemy.name} ${enemyDamageDetails.intent} You take ${roundTo(reducedDamage, 1)} damage after guard (${Math.round(nextGuard * 100)}%).`,
    );
  } else {
    battleLog.push(`${battle.enemy.name} collapses. Lane secured.`);
  }

  const status =
    enemyRemainingHp <= 0 ? "won" : playerRemainingHp <= 0 ? "lost" : "active";

  if (status === "won") {
    battleLog.push(`Victory: claim ${battle.rewardSpores} spores and advance the campaign.`);
  } else if (status === "lost") {
    battleLog.push("Defeat: regroup and try a recovery route.");
  }

  return {
    ...battle,
    status,
    turnNumber: battle.turnNumber + 1,
    player: {
      ...battle.player,
      hp: roundTo(playerRemainingHp, 1),
      guard: nextGuard,
    },
    enemy: {
      ...battle.enemy,
      hp: roundTo(enemyRemainingHp, 1),
      guard: 0,
      intentHint: status === "active" ? "Preparing the next lane assault..." : undefined,
    },
    lastAction: action,
    battleLog: battleLog.slice(-24),
    updatedAt: new Date().toISOString(),
  };
};
