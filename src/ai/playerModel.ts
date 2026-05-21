import {
  ChallengeLane,
  PlayerProfile,
  SessionTelemetry,
  PlaystyleVector,
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

export const createInitialProfile = (playerId: string): PlayerProfile => {
  const rng = createSeededRng(`profile:${playerId}`);

  return {
    playerId,
    skill: clamp(0.35 + rng() * 0.2, 0, 1),
    novelty: clamp(0.6 + rng() * 0.2, 0, 1),
    unlockedElements: ["fire", "water"],
    masteredElements: ["fire"],
    playstyle: defaultPlaystyle(),
    laneMastery: defaultLaneMastery(),
    sessionsPlayed: 0,
    lastUpdatedAt: new Date(0).toISOString(),
  };
};

export const applySessionTelemetry = (
  previous: PlayerProfile,
  telemetry: SessionTelemetry,
): PlayerProfile => {
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
  const skill = clamp(lerp(previous.skill, performanceScore, 0.22));

  const aggressionTarget = clamp(
    (telemetry.riskyActions + telemetry.completedEncounters * 0.35) /
      (totalEncounters + 1),
  );
  const precisionTarget = clamp(telemetry.perfectActions / (totalEncounters + 1));
  const explorerTarget = clamp(telemetry.discoveryActions / (totalEncounters + 1));
  const riskTarget = clamp(telemetry.riskyActions / (totalEncounters + 1));

  const playstyle: PlaystyleVector = {
    aggression: clamp(lerp(previous.playstyle.aggression, aggressionTarget, 0.2)),
    precision: clamp(lerp(previous.playstyle.precision, precisionTarget, 0.2)),
    explorer: clamp(lerp(previous.playstyle.explorer, explorerTarget, 0.2)),
    risk: clamp(lerp(previous.playstyle.risk, riskTarget, 0.2)),
  };

  const noveltyDelta = telemetry.abandoned ? 0.06 : -0.02;
  const novelty = clamp(previous.novelty + noveltyDelta, 0.25, 0.95);

  const unlockedElements = [...previous.unlockedElements];
  for (const element of telemetry.usedElements) {
    if (!unlockedElements.includes(element)) {
      unlockedElements.push(element);
    }
  }

  const masteredElements = [...previous.masteredElements];
  if (completionRate >= 0.7 && precision >= 0.3 && !telemetry.abandoned) {
    for (const element of telemetry.usedElements) {
      if (!masteredElements.includes(element)) {
        masteredElements.push(element);
      }
    }
  }

  const laneMastery = { ...previous.laneMastery };
  if (telemetry.laneOutcomes) {
    for (const [lane, outcome] of Object.entries(telemetry.laneOutcomes)) {
      if (!outcome) {
        continue;
      }

      const attempts = outcome.wins + outcome.losses;
      const laneScore = attempts > 0 ? outcome.wins / attempts : 0;
      laneMastery[lane as ChallengeLane] = clamp(
        lerp(previous.laneMastery[lane as ChallengeLane], laneScore, 0.18),
      );
    }
  }

  return {
    ...previous,
    skill,
    novelty,
    unlockedElements,
    masteredElements,
    playstyle,
    laneMastery,
    sessionsPlayed: previous.sessionsPlayed + 1,
    lastUpdatedAt: new Date().toISOString(),
  };
};
