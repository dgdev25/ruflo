# [Dream Cycle 2026-08-17] intelligence: EWC Fisher EMA weight inversion + capabilities,memory scan

**LOCAL** — GitHub Issues are disabled on this fork (`POST /issues` → 410, reconfirmed tonight via a real `mcp__github__issue_write` attempt, 5th consecutive Dream Cycle night to hit this).

Labels (would-be): `dream-cycle`, `research`, `intelligence`, `capabilities`, `memory`

## 1. Tonight's Rotation
DATE=2026-08-17, DEEP=intelligence, SCAN=capabilities,memory, SLOT=2 (no bonus deep dive: DAYINT%25=17, DAYINT%75=17).

## 2. Ledger Check
Last 3 ledger rows (2026-08-13 memory, 2026-08-14 swarm, 2026-08-15 performance) all draft/open except #3 (merged 2026-08-15, 8h turnaround). **Missing row found and backfilled tonight: 2026-08-16 security (PR #4, open/draft) never got a ledger row appended** — see LEDGER.md. Prior-gist self-score for 2026-08-16: 10/10 (see below). No duplicate-direction rejection needed (memory/swarm/performance/security/intelligence are 5 distinct surfaces). Reviewability bias maintained regardless (1/4 PRs merged so far; 0 review comments on any of the 4 open/closed PRs).

## 3. Deep Dive Findings
`EWCConsolidator.updateFisherFromConfidences()` (`v3/@claude-flow/cli/src/memory/ewc-consolidation.ts`) blended `globalFisher = alpha*old + (1-alpha)*new` where `alpha = config.fisherDecayRate` (default 0.01). The two call sites actually wired into production (`computeFisherMatrix()`/`recordGradient()`, invoked from `hooks-tools.ts`/`intelligence.ts`) use the same config field with the weights swapped: `(1-decay)*old + decay*new`. With the default 0.01, this meant the two production paths retain ~99% of accumulated Fisher-information history per update (slow, stable — the point of EWC), while the third path discarded ~99% of history on every single call — the opposite of EWC's purpose. Fixed by swapping the weights to match.

## 4. Hypothesis
Given repeated calls to `updateFisherFromConfidences()` on the shared `globalFisher` state, when the EMA blend is corrected to `(1-alpha)*old+alpha*new` (matching `computeFisherMatrix()`/`recordGradient()`'s convention for the same `fisherDecayRate` field), then 20-step historical-signal retention should rise from near-zero to ~(1-alpha)^20, subject to: (1) `getPenalty()`/`computeConfidencePenalty()`/`computeFisherMatrix()`/`recordGradient()` byte-identical for identical inputs; (2) both production-wired call sites' output unchanged vs baseline.

## 5. Evaluation Receipt
`receipt-2026-08-17.json` / `bench-ewc-fisher-ema-inversion.mjs`. **ACCEPT.** First-call: baseline maxFisher=99 vs candidate=1 (matches analytical formula exactly). 20-step retention: baseline=9.11e-10 vs candidate=0.8179069493110185 (analytical (1-alpha)^20=0.8179069375972308, matches to 7 sig figs). Regression guard: 4 unrelated methods byte-identical baseline vs candidate. 8/8 hand-executed test assertions pass (`v3/@claude-flow/cli/__tests__/ewc-consolidation.fisher-ema.test.ts`, `regression-check-2026-08-17.json`) — real `vitest` not runnable (no `node_modules` anywhere in this checkout, 5th consecutive night).

## 6. Darwin Results
`darwin-lineage-2026-08-17.json`. 1 generation, 2 real (independently executed) variants, frozen fitness `0.35*quality+0.20*success_rate+0.15*latency+0.10*cost_efficiency+0.10*reproducibility+0.10*safety`. Winner: Variant A (shipped, fitness 1.0). Rejected: Variant B — flip the 2 production-wired methods instead (fitness 0.35): doesn't fix the method under test (retention still 2.5e-9) AND silently changes `computeFisherMatrix()`/`recordGradient()`'s output vs baseline.

## 7. Flywheel Evidence
`flywheel-evidence.json` (provenance-classified). `npx ruvector harness flywheel gate` ran for real tonight: `{"promote":true,"reasons":[]}` (`flywheel-gate-evidence.json`/`flywheel-gate-output.json`). `flywheel verify` attempted and expected-failed (no signed replay chain for arbitrary source patches — same limitation as all 4 prior nights, `flywheel-verify-output.json`).

## 8. Reward Hack Check
**New capability discovered tonight**: `detectRewardHack` from `@metaharness/weight-eft@0.1.1` is genuinely importable (`import('@metaharness/weight-eft')`) even though no CLI subcommand wires it up — prior nights' "not applicable, library not CLI" verdict was one layer short. Ran it for real against a representative trajectory of tonight's actual file operations: 0 findings, clean (`reward-hack-evidence.json`). Manual checklist also run in full — no unresolved signal.

## 9. Security Review
Low sensitivity. Pure computational fix inside a continual-learning consolidation subsystem — no filesystem/network/credential/MCP-authority surface touched. `updateFisherFromConfidences()` has zero production callers today (confirmed via grep), so blast radius is zero until it's wired up — this fix corrects the contract before that happens rather than after.

## 10. Scan Findings: capabilities
No safe testable-tonight fix identified. Control-plane discovery surfaced two genuinely new capabilities worth recording for future nights: (a) `@metaharness/weight-eft`'s `detectRewardHack` is importable outside any CLI wiring (see §8); (b) `@metaharness/darwin`'s real `evolve()` is also importable, but is scoped to evolving an agent-harness SCAFFOLD (`profileRepo`/`generateBaselineHarness` against `SURFACES` like planner/reviewer templates) rather than arbitrary application source patches — confirmed by reading its source, not assumed. Neither changes tonight's DEEP=intelligence candidate, but both are durable capability-map updates for `.claude-flow/flywheel`-adjacent future work.

## 11. Scan Findings: memory
The `updateFisherFromConfidences()` bug fixed tonight lives in the memory-adjacent `@claude-flow/cli/src/memory/` module. No second, independent memory-surface finding identified tonight beyond tonight's DEEP candidate itself (the DEEP dive already covers this surface's most concrete finding).

## 12. Competitors Reviewed
LangGraph (graph-state persistence across turns, no EWC/Fisher-style continual-learning defense found), CrewAI (built-in short/long-term memory, no catastrophic-forgetting-specific mechanism), Microsoft Agent Framework 1.0 (April 2026 AutoGen+Semantic Kernel merger; custom memory stores, no EWC), OpenAI Agents SDK (no EWC/Fisher mechanism surfaced in this pass). None of the major agent frameworks researched tonight implement an EWC-style Fisher-information continual-learning guard — Ruflo's `EWCConsolidator` is a genuine differentiator when correct, which is exactly what tonight's fix restores for its one previously-inconsistent path.

## 13. Gist
`docs/dream-cycle/2026-08-17-intelligence-sota.md` (committed; no gist-creation tool in this session's toolset).

## 14. Witness
See LEDGER.md and the PR body for the final computed witness stamp (computed after this file and the gist were finalized).

## 15. Recommendation
1. **Human review and merge.** Small (2 methods touched across two files: the 1-method fix + its docstring, plus a new test file — well under the 300-line soft cap), fully covered by real dependency-free evaluation, independently adversarially confirmed, zero regressions, zero production blast radius today.
2. **Run the real `vitest` suite** for `v3/@claude-flow/cli` (specifically the new `ewc-consolidation.fisher-ema.test.ts`) once `npm install` is possible in this environment — 5th consecutive Dream Cycle night blocked by an absent `node_modules` at every level of this checkout.
3. **Consider whether `updateFisherFromConfidences()` should actually be wired into SONA's `distillLearning` path**, as its own docstring already claims it is — that wiring does not currently exist. This fix makes the method safe to wire up; actually wiring it is a separate, larger change (Darwin's fitness-scored `Variant B` in tonight's lineage shows why doing so carelessly (e.g. by "fixing" the other two methods instead) would be actively dangerous to the two paths already in production).
