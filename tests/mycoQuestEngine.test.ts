import { describe, expect, it } from "vitest";
import { AdaptiveDirector } from "../src/ai/adaptiveDirector";
import { createInitialProfile } from "../src/ai/playerModel";
import { MycoQuestEngine } from "../src/mycoQuestEngine";

const avgDifficulty = (difficulties: number[]): number => {
  return difficulties.reduce((sum, current) => sum + current, 0) / difficulties.length;
};

describe("MycoQuest personalization", () => {
  it("generates different run patterns for different players", () => {
    const engine = new MycoQuestEngine();

    for (let index = 0; index < 3; index += 1) {
      engine.recordSession({
        playerId: "aggressive",
        completedEncounters: 9,
        failedEncounters: 1,
        damageTaken: 48,
        perfectActions: 3,
        discoveryActions: 1,
        riskyActions: 8,
        sessionLengthSec: 640,
        usedElements: ["fire", "water"],
        abandoned: false,
        laneOutcomes: {
          swarm: { wins: 4, losses: 1 },
          boss: { wins: 3, losses: 0 },
        },
      });

      engine.recordSession({
        playerId: "explorer",
        completedEncounters: 7,
        failedEncounters: 2,
        damageTaken: 25,
        perfectActions: 8,
        discoveryActions: 6,
        riskyActions: 2,
        sessionLengthSec: 820,
        usedElements: ["fire", "water", "ice"],
        abandoned: false,
        laneOutcomes: {
          puzzle: { wins: 3, losses: 1 },
          tactics: { wins: 3, losses: 1 },
        },
      });
    }

    const aggressiveRun = engine.generateRun("aggressive", { seed: "season-1" });
    const explorerRun = engine.generateRun("explorer", { seed: "season-1" });

    const aggressivePattern = aggressiveRun.run.encounters
      .map((encounter) => encounter.lane)
      .join("|");
    const explorerPattern = explorerRun.run.encounters
      .map((encounter) => encounter.lane)
      .join("|");

    expect(aggressivePattern).not.toEqual(explorerPattern);
  });

  it("adapts difficulty upward after strong performance", () => {
    const engine = new MycoQuestEngine();

    const firstRun = engine.generateRun("improver", { seed: "epoch-1" });
    const firstAvg = avgDifficulty(
      firstRun.run.encounters.map((encounter) => encounter.targetDifficulty),
    );

    engine.recordSession({
      playerId: "improver",
      completedEncounters: 10,
      failedEncounters: 0,
      damageTaken: 8,
      perfectActions: 11,
      discoveryActions: 4,
      riskyActions: 6,
      sessionLengthSec: 930,
      usedElements: ["fire", "water", "ice"],
      abandoned: false,
      laneOutcomes: {
        mobility: { wins: 3, losses: 0 },
        swarm: { wins: 3, losses: 0 },
        boss: { wins: 2, losses: 0 },
        tactics: { wins: 2, losses: 0 },
      },
    });

    const secondRun = engine.generateRun("improver", { seed: "epoch-2" });
    const secondAvg = avgDifficulty(
      secondRun.run.encounters.map((encounter) => encounter.targetDifficulty),
    );

    expect(engine.getProfile("improver").skill).toBeGreaterThan(firstRun.profile.skill);
    expect(secondAvg).toBeGreaterThan(firstAvg);
  });

  it("is deterministic for same profile and seed", () => {
    const director = new AdaptiveDirector();
    const profile = createInitialProfile("deterministic");

    const runA = director.planRun(profile, { seed: "same-seed" });
    const runB = director.planRun(profile, { seed: "same-seed" });

    expect(
      runA.encounters.map((encounter) => encounter.blueprintId),
    ).toEqual(runB.encounters.map((encounter) => encounter.blueprintId));

    expect(
      runA.encounters.map((encounter) => encounter.targetDifficulty),
    ).toEqual(runB.encounters.map((encounter) => encounter.targetDifficulty));
  });
});
