# Engineering Quality Gates

Use this checklist before merging gameplay, rendering, or UI changes.

## 1) Static quality gates

Run:

```bash
npm run lint
npm run format:check
npm run test
```

## 2) Visual quality gate

Run:

```bash
npm run test:visual
```

This validates that the playable view can render and that the cinematic title screen draws pixels on canvas in an expected non-blank state.

## 3) Manual high-risk smoke checks

- Desktop:
  - movement,
  - overworld combat input,
  - battle transition rendering,
  - interior entry/exit,
  - portal spawn safety.
- Mobile:
  - joystick movement,
  - attack/engage buttons,
  - dropdown/drop-up menu visibility without blocking gameplay.

## 4) Deployment confidence notes

- Capture which branch/commit was validated.
- Note any known visual compromises.
- Note if environment assumptions are required (browser install, secrets, etc.).
