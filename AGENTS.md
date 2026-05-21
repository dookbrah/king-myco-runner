# AGENTS.md

## Cursor Cloud specific instructions

This is a self-contained TypeScript computation library (no external services, databases, or APIs required).

### Key commands

All standard commands are in `package.json` scripts:

- `npm run build` — compile TypeScript to `dist/`
- `npm run test` — run Vitest test suite
- `npm run test:watch` — run tests in watch mode
- `npm run demo` — run adaptive AI demo showing personalization divergence

### Notes

- Node.js v18+ is required (v22 works well).
- There are no environment variables, secrets, or external service dependencies.
- The project uses CommonJS module format (`"type": "commonjs"` in package.json) with Node16 module resolution.
- TypeScript strict mode is enabled; all source is in `src/`, tests in `tests/`.
- `tsx` is used for running TypeScript files directly (e.g., the demo script) without a build step.
