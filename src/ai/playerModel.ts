import {
  ChallengeLane,
  Element,
  PlayerProfile,
  PlaystyleVector,
  SessionTelemetry,
} from "../types";
import { createSeededRng } from "../engine/random";
import { clamp, lerp } from "../utils/math";

const defaultPlaystyle = (): PlaystyleVector => ({
  aggression: 0.5,
  precision: 0.5,
  explorer: 0.5,
  risk: 0.45,
});

const defaultLaneMastery = (): Record<ChallengeLane, number> => ({
  mobility: 0.5,
  swarm: 0.5,
  tactics: 0.5,
  boss: 0.45,
  puzzle: 0.5,
});

const defaultMagicMastery = (): Record<Element, number> => ({
  fire: 0.35,
  water: 0.25,
  ice: 0.1,
  nature: 0.05,
  void: 0.03,
});

const MAGIC_LEXICON: Record<Element, string[]> = {
  fire: ["ember-spark", "phoenix-arc", "solar-cataclysm"],
  water: ["mist-veil", "tidal-orbit", "abyssal-requiem"],
  ice: ["frost-dart", "glacial-wall", "permafrost-crown"],
  nature: ["root-bind", "verdant-choir", "worldtree-awakening"],
  void: ["rift-step", "entropy-bolt", "eclipse-singularity"],
};

const ELEMENT_ORDER: Element[] = ["fire", "water", "ice", "nature", "void"];

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const computeLearnedMagic = (
  mastery: Record<Element, number>,
  existing: string[],
  rituals: string[] = [],
): string[] => {
  const next = new Set(existing);

  for (const element of ELEMENT_ORDER) {
    const depth = mastery[element] ?? 0;
    if (depth >= 0.3) {
      next.add(MAGIC_LEXICON[element][0]);
    }
    if (depth >= 0.55) {
      next.add(MAGIC_LEXICON[element][1]);
    }
    if (depth >= 0.8) {
      next.add(MAGIC_LEXICON[element][2]);
    }
  }

  for (const ritual of rituals) {
    if (ritual.trim().length > 0) {
      next.add(ritual.trim().toLowerCase());
    }
  }

  return [...next].sort((left, right) => left.localeCompare(right));
};

export const createInitialProfile = (playerId: string): PlayerProfile => {
  const rng = createSeededRng(`profile:${playerId}`);
  const magicMastery = defaultMagicMastery();

  return {
    playerId,
    skill: clamp(0.35 + rng() * 0.2, 0, 1),
    novelty: clamp(0.6 + rng() * 0.2, 0, 1),
    unlockedElements: ["fire", "water"],
    masteredElements: ["fire"],
    playstyle: defaultPlaystyle(),
    laneMastery: defaultLaneMastery(),
    morality: 0,
    learnedMagic: computeLearnedMagic(magicMastery, []),
    magicMastery,
    sporesCollected: 0,
    sessionsPlayed: 0,
    lastUpdatedAt: new Date(0).toISOString(),
  };
};

export const normalizeProfile = (profile: PlayerProfile): PlayerProfile => {
  const base = createInitialProfile(profile.playerId);
  const mergedMagic = {
    ...base.magicMastery,
    ...(profile.magicMastery ?? {}),
  };

  return {
    ...base,
    ...profile,
    unlockedElements: unique([...(profile.unlockedElements ?? base.unlockedElements)]),
    masteredElements: unique([...(profile.masteredElements ?? base.masteredElements)]),
    playstyle: {
      ...base.playstyle,
      ...(profile.playstyle ?? {}),
    },
    laneMastery: {
      ...base.laneMastery,
      ...(profile.laneMastery ?? {}),
    },
    morality: clamp(profile.morality ?? 0, -1, 1),
    magicMastery: mergedMagic,
    learnedMagic: computeLearnedMagic(mergedMagic, profile.learnedMagic ?? []),
    sporesCollected: Math.max(0, Math.floor(profile.sporesCollected ?? 0)),
    sessionsPlayed: Math.max(0, Math.floor(profile.sessionsPlayed ?? 0)),
    lastUpdatedAt: profile.lastUpdatedAt ?? base.lastUpdatedAt,
  };
};

export const applySessionTelemetry = (
  previous: PlayerProfile,
  telemetry: SessionTelemetry,
): PlayerProfile => {
  const profile = normalizeProfile(previous);
  const totalEncounters = telemetry.completedEncounters + telemetry.failedEncounters;
  const completionRate =
    totalEncounters > 0 ? telemetry.completedEncounters / totalEncounters : 0;
  const survivability = clamp(
    1 - telemetry.damageTaken / (telemetry.completedEncounters * 12 + 16),
  );
  const precision = clamp(
    telemetry.perfectActions / (telemetry.completedEncounters * 3 + 1),
  );
  const engagement = clamp(telemetry.sessionLengthSec / 900);

  const performanceScore =
    completionRate * 0.45 + survivability * 0.2 + precision * 0.2 + engagement * 0.15;
  const skill = clamp(lerp(profile.skill, performanceScore, 0.22));

  const aggressionTarget = clamp(
    (telemetry.riskyActions + telemetry.completedEncounters * 0.35) /
      (totalEncounters + 1),
  );
  const precisionTarget = clamp(telemetry.perfectActions / (totalEncounters + 1));
  const explorerTarget = clamp(telemetry.discoveryActions / (totalEncounters + 1));
  const riskTarget = clamp(telemetry.riskyActions / (totalEncounters + 1));

  const playstyle: PlaystyleVector = {
    aggression: clamp(lerp(profile.playstyle.aggression, aggressionTarget, 0.2)),
    precision: clamp(lerp(profile.playstyle.precision, precisionTarget, 0.2)),
    explorer: clamp(lerp(profile.playstyle.explorer, explorerTarget, 0.2)),
    risk: clamp(lerp(profile.playstyle.risk, riskTarget, 0.2)),
  };

  const noveltyDelta = telemetry.abandoned ? 0.06 : -0.02;
  const novelty = clamp(profile.novelty + noveltyDelta, 0.25, 0.95);

  const compassionateActions = telemetry.morality?.compassionateActions ?? 0;
  const ruthlessActions = telemetry.morality?.ruthlessActions ?? 0;
  const moralTotal = compassionateActions + ruthlessActions;
  const moralTarget =
    moralTotal > 0
      ? clamp((compassionateActions - ruthlessActions) / moralTotal, -1, 1)
      : profile.morality;
  const moralityDrift = clamp(
    (telemetry.discoveryActions - telemetry.riskyActions * 0.55) / (totalEncounters + 1),
    -0.1,
    0.1,
  );
  const morality = clamp(lerp(profile.morality, moralTarget, 0.2) + moralityDrift, -1, 1);

  const unlockedElements = [...profile.unlockedElements];
  for (const element of telemetry.usedElements) {
    if (!unlockedElements.includes(element)) {
      unlockedElements.push(element);
    }
  }

  if (telemetry.discoveryActions >= 4 && !unlockedElements.includes("nature")) {
    unlockedElements.push("nature");
  }
  if (telemetry.riskyActions >= telemetry.completedEncounters && !unlockedElements.includes("void")) {
    unlockedElements.push("void");
  }

  const magicMastery = { ...profile.magicMastery };
  for (const element of ELEMENT_ORDER) {
    const castCount = telemetry.magic?.castsByElement?.[element] ?? 0;
    if (castCount <= 0 && !telemetry.usedElements.includes(element)) {
      continue;
    }

    const gain = clamp(
      castCount / 24 +
        telemetry.perfectActions / (totalEncounters + 16) * 0.08 +
        telemetry.discoveryActions / (totalEncounters + 16) * 0.08 +
        (telemetry.usedElements.includes(element) ? 0.015 : 0),
      0.01,
      0.12,
    );

    magicMastery[element] = clamp((magicMastery[element] ?? 0) + gain, 0, 1);
  }

  const masteredElements = [...profile.masteredElements];
  for (const element of unlockedElements) {
    if ((magicMastery[element] ?? 0) >= 0.72 && !masteredElements.includes(element)) {
      masteredElements.push(element);
    }
  }

  const laneMastery = { ...profile.laneMastery };
  if (telemetry.laneOutcomes) {
    for (const [lane, outcome] of Object.entries(telemetry.laneOutcomes)) {
      if (!outcome) {
        continue;
      }

      const attempts = outcome.wins + outcome.losses;
      const laneScore = attempts > 0 ? outcome.wins / attempts : 0;
      laneMastery[lane as ChallengeLane] = clamp(
        lerp(profile.laneMastery[lane as ChallengeLane], laneScore, 0.18),
      );
    }
  }

  const sporesCollectedDelta = Math.max(0, Math.floor(telemetry.sporesCollected ?? 0));
  const learnedMagic = computeLearnedMagic(
    magicMastery,
    profile.learnedMagic,
    telemetry.magic?.ritualsCompleted ?? [],
  );

  return {
    ...profile,
    skill,
    novelty,
    unlockedElements: unique(unlockedElements),
    masteredElements: unique(masteredElements),
    playstyle,
    laneMastery,
    morality,
    learnedMagic,
    magicMastery,
    sporesCollected: profile.sporesCollected + sporesCollectedDelta,
    sessionsPlayed: profile.sessionsPlayed + 1,
    lastUpdatedAt: new Date().toISOString(),
  };
};
