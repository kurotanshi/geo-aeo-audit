# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js 20+ TypeScript CLI. Production code lives in `src/`: `cli.ts` is the entry point, `audit/` coordinates audits, `probe/` runs citation observations, `ora/` reads Ora cache entries and runs opt-in scans, `transport/` enforces safe fetching, `rules/` produces findings, `registry/` owns external-to-local check mappings, and `report/` renders HTML. Shared configuration, schemas, scoring, and version data remain near the `src/` root. Tests live in `tests/` and generally mirror source concerns; reusable local fixtures belong in `tests/fixtures/`. Public JSON Schemas live in `schemas/`. Design proposals and archived work are recorded under `sdd/`. Treat `dist/` as generated output.

## Build, Test, and Development Commands

- `pnpm install --frozen-lockfile` installs the locked pnpm 11 dependency set.
- `pnpm dev audit https://example.com/` runs the CLI directly with `tsx`.
- `pnpm run build` compiles `src/` into `dist/` with `tsc`.
- `pnpm run typecheck` checks strict TypeScript without emitting files.
- `pnpm test` builds first, then runs the Vitest suite once.
- `node dist/cli.js --help` smoke-tests the compiled entry point.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, double quotes, semicolons, trailing commas in multiline constructs, and ESM imports with `.js` extensions. Prefer named exports and explicit types at module boundaries. Use `camelCase` for values and functions, `PascalCase` for types/classes, and kebab-case filenames such as `safe-fetch.ts`. Keep security limits and validation fail-closed; reuse existing helpers before adding abstractions. No formatter or linter is configured, so match adjacent code and rely on `typecheck` plus tests.

## Testing Guidelines

Use Vitest (`describe`, `it`, `expect`) in files named `tests/<feature>.test.ts`; CLI workflows use `.e2e.test.ts`. Add the smallest regression test that proves changed behavior. Tests must use local fixtures and must not contact public sites or model APIs. There is no numeric coverage threshold. Schema or report-envelope changes should update the public schema and `schema-compat.test.ts` expectations.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects such as `feat: add category scorecards` and `chore: archive ...`. Write an imperative, concise `type: summary`; keep each commit focused. Pull requests should explain behavior and risk, link the relevant issue or SDD proposal, and list validation commands run. Include before/after output or screenshots only when JSON or HTML report behavior changes.
