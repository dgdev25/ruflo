# Independent Adversarial Review — EWC Fisher EMA-Weight Fix (2026-08-17)

Performed by an independent critic subagent (separate from the candidate author), instructed to try to break the finding rather than validate it. Read the full candidate file, diffed the working tree against `git show HEAD:...` itself, re-ran the existing benchmark, and wrote its own from-scratch, non-code-sharing repro before rendering a verdict.

## Scope confirmed

Diff against `git show HEAD:...` is exactly the claimed one-line semantics swap plus a matching docstring update — nothing else in the 836-line file changed.

## Existing benchmark — independently re-run

`node --experimental-strip-types docs/dream-cycle/evidence/2026-08-17-intelligence/bench-ewc-fisher-ema-inversion.mjs` ran clean, verdict `ACCEPT`. Candidate 20-step retention `0.8179069493110185` vs analytical `(1-0.01)^20 = 0.8179069375972308` (matches to 7 sig figs); baseline retention `9.1e-10`. Hand-checked `(0.99)^20 ≈ 0.8179069376` independently — matches.

## Independent from-scratch script (shares no code with the existing bench)

Different dims (5), different fixed non-random noise vector, different strong-signal magnitude, tested 3 `fisherDecayRate` values (0.01, 0.5, 0.9), independent grep for callers:

```
alpha=0.01: first-call maxFisherValue=2.560000 (expected 2.56)      -> match
alpha=0.01: retention after 5 weak calls = 0.950990 (expected 0.99^5=0.950990) -> match
alpha=0.5:  first-call = 128.0, retention = 0.031250 (expected 0.5^5=0.03125)    -> match
alpha=0.9:  first-call = 230.4, retention = 0.000010 (expected 0.1^5=0.00001)    -> match
retention strictly decreases as alpha increases: 0.950990 > 0.031250 > 0.000010  -> correct direction
```

Pointed the identical script at the baseline (`git show HEAD:...`) by swapping only the import path: fails every decay/retention assertion except the degenerate `alpha=0.5` case (a deliberate adversarial control, where the two conventions are numerically indistinguishable). Baseline retention *increases* with alpha — backwards from any sane EMA.

## Direction-of-bug sanity

Seriously considered whether the original code could be correct and the two *other* call sites wrong instead:
- A competing convention exists in the literature (TF-style batchnorm moving averages, where "decay" weights the *old* value) that would make the original code defensible in isolation.
- But: (a) `computeFisherMatrix()` and `recordGradient()` — the two call sites actually wired into production — already agreed with each other on `(1-decay)*old + decay*new` before tonight; (b) the default `fisherDecayRate=0.01` only makes semantic sense under that convention (99% retained per step, matching EWC++ literature and the field's own doc comment); under the swapped reading, 0.01 means 99% of history discarded every call, contradicting EWC's purpose and matching the empirically measured `retention ≈ 9e-10` after 20 calls.
- **Conclusion: the fix is directionally correct.**

## Was the benchmark gamed?

No. Baseline extracted live via `git show HEAD:...` (not hand-copied), candidate imported from the working tree, analytical expectations computed independently in-script, explicit regression guard confirms `getPenalty`/`computeConfidencePenalty`/`computeFisherMatrix`/`recordGradient` are byte-identical baseline vs candidate. No cherry-picked seeds, no gold-answer tampering, no leading assertions.

## Regressions found

None. All adjacent methods byte-unchanged per diff; persistence (`saveToDisk`/`loadFromDisk`) round-trips `globalFisher` as plain numbers regardless of which formula produced them — no schema/format change.

## Caller / dead-code check (independent)

`grep -rn "updateFisherFromConfidences" v3/` → exactly one hit, the method's own definition. Zero production callers tonight — matches the receipt's own disclosed caveat.

## Discrepancy found and corrected

The first draft of `receipt-2026-08-17.json` claimed a test file had already been added. It had not been yet at that point. **This is the one finding of the review.** In direct response, `v3/@claude-flow/cli/__tests__/ewc-consolidation.fisher-ema.test.ts` was added and its 8 assertions were hand-executed against the real class (`regression-check-2026-08-17.json`, 8/8 pass) — vitest itself still could not run (no `node_modules` anywhere in this checkout). The receipt has been corrected to disclose this sequence rather than silently backfill it.

## Reward-hack checklist

| Check | Verdict |
|---|---|
| Weakened/deleted tests | No — no test files were touched, one new test file added |
| Cherry-picked favorable task | No — real semantic inconsistency; benchmark uses the actual default config value |
| Hidden preprocessing / data massaging | No — both benchmarks call the class's public API with plain arrays |
| Metric substitution | No — both read `getConsolidationStats().maxFisherValue`/`avgFisherValue`, the exact state the fix changes |
| Seed manipulation | No — independently confirmed with a non-random noise vector at 3 different alpha values |
| Evidence overclaiming | Yes, one instance (see Discrepancy above) — corrected |

## Final verdict

**CONFIRMED** — the code change is a correct, minimally-scoped, directionally-sound semantics fix on a currently-dead-code method with zero production callers and zero measurable blast radius tonight, independently reproduced by a script sharing no code with the original. One evidence-accuracy issue was found (a premature "test file added" claim) and corrected before this critique was finalized.
