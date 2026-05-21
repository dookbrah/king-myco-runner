# king-myco-runner

Myco Quest adaptive AI game-core prototype.

## What this gives you

This repo now contains a production-style **core personalization engine** for Myco Quest that can power highly replayable runs:

- Player profile model (skill, playstyle, mastery, novelty appetite)
- Adaptive Game Director (bandit-style lane selection + progression arc)
- Procedural run generation (encounter sequence + encounter tuning)
- Session telemetry ingestion to continuously update each player profile
- Deterministic seeds for debugging and competitive integrity
- Tests proving personalization and adaptation behavior

## Architecture

- `src/mycoQuestEngine.ts` - public orchestration API
- `src/ai/playerModel.ts` - online player model updates from telemetry
- `src/ai/adaptiveDirector.ts` - run planner and per-lane exploration/exploitation logic
- `src/quest/catalog.ts` - encounter blueprint catalog
- `src/types.ts` - shared contracts

## Active learning loop

1. Generate a run for player X using current profile + seeded randomness.
2. Track in-session telemetry: outcomes, damage, risk behavior, exploration actions.
3. Record telemetry after the run.
4. Update profile + lane reward priors.
5. Generate next run with adjusted difficulty, lane mix, and learning objectives.

This creates runs that stay fresh while still learning what each player finds satisfying.

## Scripts

- `npm run demo` - print two simulated players and how their runs diverge
- `npm run test` - run unit tests
- `npm run build` - compile TypeScript

## Suggested next steps

1. Plug this core into your frontend game client and backend profile storage.
2. Add real retention metrics (D1/D7 return, quit point, reward claim behavior).
3. Extend the encounter catalog and reward economy definitions.
4. Add anti-exploit checks for competitive leaderboards.
