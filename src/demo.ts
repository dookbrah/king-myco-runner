import { MycoQuestEngine } from "./mycoQuestEngine";

const summarize = (title: string, runData: ReturnType<MycoQuestEngine["generateRun"]>) => {
  console.log(`\n=== ${title} ===`);
  console.log(`Player: ${runData.profile.playerId}`);
  console.log(`Skill: ${runData.profile.skill.toFixed(2)} | Novelty: ${runData.profile.novelty.toFixed(2)}`);
  console.log(`Morality: ${runData.profile.morality.toFixed(2)} | Spores Collected: ${runData.profile.sporesCollected} | Learned Magic: ${runData.profile.learnedMagic.length}`);

  for (const encounter of runData.run.encounters) {
    const objective = encounter.suggestedLearningObjective
      ? ` | Objective: ${encounter.suggestedLearningObjective}`
      : "";
    const magic = encounter.suggestedMagicToPractice
      ? ` | Magic: ${encounter.suggestedMagicToPractice}`
      : "";
    const tone = encounter.narrativeTone
      ? ` | Tone: ${encounter.narrativeTone}`
      : "";
    console.log(
      `${encounter.encounterNumber}. [${encounter.lane}] ${encounter.title} (difficulty ${encounter.targetDifficulty})${objective}${magic}${tone}`,
    );
  }
};

const engine = new MycoQuestEngine();

const playerA = "aggressive-runner";
const playerB = "methodical-explorer";

const firstRunA = engine.generateRun(playerA, { seed: "demo-seed-a" });
const firstRunB = engine.generateRun(playerB, { seed: "demo-seed-b" });

summarize("First Run - Aggressive", firstRunA);
summarize("First Run - Methodical", firstRunB);

engine.recordSession({
  playerId: playerA,
  completedEncounters: 9,
  failedEncounters: 1,
  damageTaken: 55,
  perfectActions: 5,
  discoveryActions: 1,
  riskyActions: 8,
  sessionLengthSec: 760,
  usedElements: ["fire", "water", "void"],
  sporesCollected: 310,
  morality: {
    compassionateActions: 1,
    ruthlessActions: 4,
  },
  magic: {
    castsByElement: {
      fire: 14,
      water: 7,
      void: 9,
    },
    ritualsCompleted: ["obsidian-vow"],
  },
  abandoned: false,
  laneOutcomes: {
    swarm: { wins: 4, losses: 1 },
    boss: { wins: 2, losses: 0 },
    mobility: { wins: 3, losses: 0 },
  },
});

engine.recordSession({
  playerId: playerB,
  completedEncounters: 7,
  failedEncounters: 2,
  damageTaken: 29,
  perfectActions: 8,
  discoveryActions: 6,
  riskyActions: 2,
  sessionLengthSec: 880,
  usedElements: ["fire", "water", "ice", "nature"],
  sporesCollected: 420,
  morality: {
    compassionateActions: 6,
    ruthlessActions: 1,
  },
  magic: {
    castsByElement: {
      fire: 6,
      water: 14,
      ice: 11,
      nature: 8,
    },
    ritualsCompleted: ["verdant-oath"],
  },
  abandoned: false,
  laneOutcomes: {
    puzzle: { wins: 4, losses: 1 },
    tactics: { wins: 2, losses: 1 },
    mobility: { wins: 1, losses: 0 },
  },
});

const secondRunA = engine.generateRun(playerA, { seed: "demo-seed-a-next" });
const secondRunB = engine.generateRun(playerB, { seed: "demo-seed-b-next" });

summarize("Second Run - Aggressive", secondRunA);
summarize("Second Run - Methodical", secondRunB);
