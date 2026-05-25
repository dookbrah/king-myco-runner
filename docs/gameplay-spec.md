# Myco Quest Gameplay Spec (Professional Gameplay Baseline)

## Experience pillars

1. **Readable action:** movement and interaction are fast, clear, and reliable.
2. **Meaningful progression:** power gains are earned through grind, quests, puzzles, and exploration.
3. **Persistent identity:** clan, morality, nickname, and wallet-linked progression define each run.
4. **World continuity:** regions feel connected through portals and unlock conditions based on learned magic.

## Core loop

1. Explore region map.
2. Collect spores/golden spores and discover lore hooks.
3. Enter structures/interiors for quests, shops, riddles, and combat.
4. Fight or resolve encounters (including moral choices like spare/kill and rob/leave).
5. Unlock magic and systems that gate access to deeper regions.
6. Feed progression into seasonal and clan systems.

## Interaction expectations

- Arrow keys + mobile joystick must always remain functional.
- Spacebar overworld attack should feel immediate and visible.
- NPC conversations should be varied and context-aware, with clear interactive options.
- Interior points of interest must remain reachable.

## Battle standards

- Full-screen battle context for enemy/boss fights.
- Hero and enemy sprites always visible with robust render fallbacks.
- Distinct hit/guard/special/victory feedback and consistent UI affordances.
- Escape/flee and mercy-style outcomes stay available where appropriate.

## Live systems

- Daily shrine reset loops should produce fresh directives.
- Burn pits must support daily player cap behavior and traceable burn progress.
- Clan metrics (leaderboard, morality, magic, burn) remain visible in UI menus.

## Professional release checklist for gameplay updates

- No regression in movement, collision, portal spawn safety, or interior navigation.
- New systems include explanatory text and UI affordances.
- At least one automated verification path is added or updated.
