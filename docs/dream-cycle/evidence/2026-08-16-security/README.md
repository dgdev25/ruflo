# Dream Cycle 2026-08-16 — Evidence Trail (DEEP=security)

Candidate: fix an allowlist-basename-collision bypass in
`v3/@claude-flow/security/src/safe-executor.ts` (`SafeExecutor.validateCommand()`
/ `isCommandAllowed()`) — a command string whose `path.basename()` matches an
allowlisted name was authorized regardless of its full path, letting a path
like `/tmp/attacker-controlled/git` pass the same check as `git`. Same bug
*class* as OpenClaw's CVE-2026-32973 (CVSS 9.8) and Cursor's CVE-2026-22708,
both shipped/fixed in 2026.

| File | What it is |
|---|---|
| `bench-safe-executor-allowlist-bypass.mjs` | Self-contained, dependency-free, git-reproducible benchmark. Extracts baseline live from `git show HEAD:...` and imports the working-tree candidate directly via `node --experimental-transform-types` (no transpile step, no npm deps). Covers decision-boundary ASR, legitimate-usage regression, one disclosed known-behavior-change case, and a real end-to-end proof-of-exploit (spawns a harmless planted sentinel binary). `node --experimental-transform-types bench-safe-executor-allowlist-bypass.mjs` to reproduce. |
| `receipt-2026-08-16.json` | Output of the benchmark above (committed as run). |
| `regression-check.mjs` | Manual re-expression of the repo's own `__tests__/safe-executor.test.ts` assertions as plain Node `assert` calls (no vitest — no `node_modules` in this checkout). `node --experimental-transform-types regression-check.mjs` to reproduce. |
| `regression-receipt-2026-08-16.json` | Output of the above (12/12 pass). |
| `darwin-explore.mjs` | Bounded 1-generation/3-variant exploration of alternative fix formulations, real execution not simulation. `node --experimental-transform-types darwin-explore.mjs` to reproduce. |
| `darwin-lineage-2026-08-16.json` | Output of the exploration above. |
| `adversarial-critique.md` | Independent critic's full checklist review, including the one behavior-change finding and disclosed limitations. |
| `flywheel-gate-evidence.json` / `flywheel-gate-output.json` | Real invocation of `npx ruvector harness flywheel gate <evidence>` — genuine advisory tool output (`{"promote":true,"reasons":[]}`), not fabricated. |
| `flywheel-evidence.json` | Provenance-classified evidence index (OBSERVATION/MEASUREMENT/INFERENCE/HYPOTHESIS/DECISION/REJECTION), reward-hack-check, flywheel gate+verify record, and security-review notes. |
| `issue-LOCAL.md` | Issue content — GitHub Issues are disabled on this fork (confirmed tonight, same as the last 3 Dream Cycles). |

**Why direct Node execution instead of `vitest`:** same environment gap as the
last 3 Dream Cycles — no `node_modules` anywhere in this checkout (root, `v3/`,
`v3/@claude-flow/cli/`, reconfirmed tonight). `safe-executor.ts` has zero
external imports (only `node:child_process`, `node:util`, `node:path`), so it
runs directly — but it uses TypeScript constructor parameter properties
(`constructor(message: string, public readonly code: string, ...)`), which
`--experimental-strip-types` alone rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`,
confirmed tonight). `--experimental-transform-types` (full type-erasure
transform, not strip-only) handles it. **A human reviewer or CI should still
run `npm install && npm run build && npm test` in `v3/@claude-flow/security`
before merge** — tonight's `regression-check.mjs` is a real but strictly
weaker substitute for the actual `vitest` suite.
