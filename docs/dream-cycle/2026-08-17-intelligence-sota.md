# Intelligence SOTA Report — 2026-08-17

TL;DR: In 2026, none of the major open agent frameworks ship an EWC-style Fisher-information continual-learning guard — Ruflo's `EWCConsolidator` is a real differentiator, but tonight's audit found one of its three online-update call sites silently defeated its own purpose. `EWCConsolidator.updateFisherFromConfidences()` (`v3/@claude-flow/cli/src/memory/ewc-consolidation.ts`) blended its Fisher-information exponential moving average with the two mixing weights swapped relative to the sibling methods (`computeFisherMatrix()`/`recordGradient()`) that share the exact same `fisherDecayRate` config field and mutate the exact same `globalFisher` state. With the shipped default (`fisherDecayRate=0.01`), this meant the method — publicly exported and documented as SONA's `distillLearning` integration point — discarded ~99% of accumulated Fisher history on every single call, instead of the ~1%-per-call the field's own name and default value clearly intend. Fixed tonight with a 2-line swap, a new regression test, and a real independent adversarial re-derivation.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Fast Spatial Memory (Elastic Test-Time Training) stabilizes fast-weight updates with a Fisher-weighted elastic prior whose anchor evolves as a slow exponential moving average of past fast weights, to balance stability and plasticity | [arXiv:2604.07350](https://arxiv.org/abs/2604.07350) | A (arXiv preprint, directly relevant mechanism) |
| A 2025 NeurIPS-workshop evaluation reported EWC reducing catastrophic forgetting from 12.62% to 6.85% on knowledge-graph link prediction (a 45.7% relative reduction) vs naive sequential training | [Zylos Research summary](https://zylos.ai/research/2026-04-09-continual-learning-catastrophic-forgetting-ai-agents/) | B (secondary summary, not the primary workshop paper itself) |
| Microsoft retired the original AutoGen into maintenance mode and merged it with Semantic Kernel into the unified Microsoft Agent Framework 1.0 (GA April 2026); memory is via caller-defined stores, no EWC-style mechanism | [Medium: agent framework consolidation](https://ealtili.medium.com/the-great-agent-framework-consolidation-how-langgraph-crewai-google-adk-and-autogen-stack-up-in-45c9331b5858) | B (industry summary, cross-checked against 2 other 2026 comparison articles this pass) |
| LangGraph uses persistent graph state across turns; CrewAI has built-in short/long-term memory — neither implements a catastrophic-forgetting-specific defense | [LangGraph vs CrewAI vs AutoGen 2026 comparisons](https://app.ailog.fr/en/blog/guides/agent-frameworks-comparison-2026) | C (framework-comparison blog aggregation, not vendor primary docs) |

## Ruflo Current Capability (pre-patch)

`EWCConsolidator` implements the real EWC++ penalty math (`(lambda/2)*sum(F_i*(theta_i-theta_old_i)^2)`) with an honestly-labeled Fisher-information proxy (`F_i = embedding_i^2`, documented as a heuristic, not true gradient-curvature Fisher — a correction shipped in an earlier remediation pass per `docs/reviews/intelligence-system-audit-2026-05-29.md`). Three methods mutate the shared `globalFisher` online-EMA state under the same `fisherDecayRate` config field:

```ts
// computeFisherMatrix() and recordGradient() — the 2 call sites wired into
// production (hooks-tools.ts / intelligence.ts):
this.globalFisher[i] = (1 - decay) * this.globalFisher[i] + decay * fisher[i];

// updateFisherFromConfidences() — documented as the SONA distillLearning
// integration point, but currently zero production callers (confirmed by grep):
this.globalFisher[i] = alpha * this.globalFisher[i] + (1 - alpha) * currentFisher[i];
```

Same field, same target state, opposite weighting. The default `fisherDecayRate=0.01` only makes sense under the first convention (slow, 99%-retained EMA, matching EWC's whole purpose of protecting historically-important weights); under the second, it discards ~99% of history per call.

## Competitor Comparison

| Framework | EWC / Fisher-style forgetting defense | Memory approach |
|---|---|---|
| Microsoft Agent Framework 1.0 (2026 AutoGen+SK merger) | None found | Caller-defined custom memory stores |
| LangGraph | None found | Persistent graph state across turns |
| CrewAI | None found | Built-in short-term + long-term memory |
| OpenAI Agents SDK | None found (April 2026 overhaul added native sandboxing instead) | Not primarily memory-focused |
| Ruflo `@claude-flow/cli.EWCConsolidator` (pre-patch) | Real, but 1 of 3 online-update paths inverted | Fisher-weighted pattern-weight consolidation |
| Ruflo `@claude-flow/cli.EWCConsolidator` (tonight) | Real, all 3 paths consistent | Fixed tonight |

*(No framework surveyed this pass ships an EWC-equivalent at all — Ruflo's gap tonight was an internal-consistency bug in a capability none of the four competitors reviewed even attempt, not a competitive parity gap.)*

## Hypothesis (frozen before evaluation)

Given repeated calls to `updateFisherFromConfidences()` on the shared `globalFisher` state, when the EMA blend is corrected from `alpha*old+(1-alpha)*new` to `(1-alpha)*old+alpha*new` (matching `computeFisherMatrix()`/`recordGradient()`'s convention for the same `fisherDecayRate` field), then 20-step historical-signal retention should rise from near-zero to ~(1-alpha)^20, subject to: (1) `getPenalty()`/`computeConfidencePenalty()`/`computeFisherMatrix()`/`recordGradient()` stay byte-identical for identical inputs; (2) both production-wired call sites' output stays unchanged vs baseline.

## Benchmarks & Evaluation

Real, dependency-free, git-reproducible (`node --experimental-strip-types` — no `node_modules` anywhere in this checkout, 5th consecutive Dream Cycle night to hit this gap):

| Metric | Baseline | Candidate | Analytical expectation |
|---|---|---|---|
| First-call `maxFisherValue` (zero-init state) | 99 | 1 | 1 (`(1-0.01)*0+0.01*100`) |
| 20-step retention fraction | 9.11e-10 | 0.8179069493 | 0.8179069376 (`(1-0.01)^20`) |
| Regression guard (4 unrelated methods) | — | byte-identical | — |

**Verdict: ACCEPT.** Candidate matches the independently-derived analytical formula to 7 significant digits. An independent adversarial critic subagent re-ran the existing benchmark, then wrote a from-scratch script sharing no code with it (different dims, different fixed vectors, 3 different `fisherDecayRate` values) and reproduced the same direction and magnitude of effect, including confirming the bug's *direction* is correct (not just its existence) by reasoning about which of two possible EMA conventions the default value and the 2-of-3 production-wired call sites actually imply.

**One correction made mid-review:** the critic found that an earlier receipt draft claimed a test file had already been added when it had not yet been. `v3/@claude-flow/cli/__tests__/ewc-consolidation.fisher-ema.test.ts` was added in direct response and its 8 assertions hand-verified against the real class (vitest itself still not runnable). Disclosed rather than silently backfilled.

## Darwin Results

1 generation, 2 real (independently executed) variants, frozen fitness `0.35*quality+0.20*success_rate+0.15*latency+0.10*cost_efficiency+0.10*reproducibility+0.10*safety`:

| Variant | Retention fixed? | Production paths unchanged? | Fitness | Verdict |
|---|---|---|---|---|
| **A — swap `updateFisherFromConfidences()`'s own weights (shipped)** | yes (0.818) | yes | **1.00** | **accepted** |
| B — flip `computeFisherMatrix()`/`recordGradient()` instead | no (2.5e-9, unchanged) | no | 0.35 | rejected — fixes nothing and breaks 2 production paths |

## SOTA Proof & Witness

Full evidence trail in `docs/dream-cycle/evidence/2026-08-17-intelligence/`. `npx ruvector harness flywheel gate` ran for real: `{"promote":true,"reasons":[]}`. **New capability discovered tonight**: `detectRewardHack` from `@metaharness/weight-eft` is genuinely importable outside any CLI wiring — ran for real against a representative trajectory of tonight's actual file operations, 0 findings. Witness stamp computed over this file's final SHA256 + session commit; see the PR body and `LEDGER.md` for the exact values.

## Recommended Next Steps

1. **Human review and merge tonight's PR.** Small, single-purpose (2-line semantics fix + docstring + 1 new test file), fully covered by dependency-free evaluation and an independent adversarial re-derivation, zero production blast radius today (the fixed method has zero current callers).
2. **Fix `npm install`/`pnpm install` bootstrap for this checkout.** 5th consecutive Dream Cycle night (2026-08-13 through tonight) blocked from the real `vitest` suite by an absent `node_modules` at root, `v3/`, and `v3/@claude-flow/cli/`.
3. **Decide whether to actually wire `updateFisherFromConfidences()` into SONA's `distillLearning` path**, as its own docstring already claims — that wiring does not exist yet. Tonight's fix makes the method safe to wire up; wiring it is a separate, larger change, and tonight's rejected Darwin `Variant B` shows why doing so carelessly would risk the two paths already in production.
