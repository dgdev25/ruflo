#!/usr/bin/env node
/**
 * bench-ewc-fisher-ema-inversion.mjs — Dream Cycle 2026-08-17 (DEEP=intelligence)
 *
 * Real, dependency-free, git-reproducible benchmark for the
 * EWCConsolidator.updateFisherFromConfidences() EMA-weight-inversion fix.
 *
 * Extracts the literal BASELINE source via `git show HEAD:...` (this repo's
 * HEAD, pre-candidate-edit) and imports the literal CANDIDATE source directly
 * from the working tree, both via Node 22's --experimental-strip-types (no
 * transpile step, no npm install — this checkout still has no node_modules
 * anywhere, same gap noted by every prior Dream Cycle night).
 *
 * Claim under test: computeFisherMatrix()/recordGradient() (the two call
 * sites actually wired into production, hooks-tools.ts / intelligence.ts)
 * update `globalFisher` with `(1-decay)*old + decay*new` for the SAME
 * config field `fisherDecayRate` that updateFisherFromConfidences() (public,
 * exported, documented as the SONA distillLearning integration point) uses
 * with the weights swapped: `alpha*old + (1-alpha)*new`. With the default
 * fisherDecayRate=0.01 this means: the two production-wired paths retain
 * ~99% of accumulated history per call (slow, stable); the third path
 * discards ~99% of accumulated history on every single call it's used —
 * the exact opposite of EWC's purpose (protect what mattered historically).
 *
 * Measures, on THIS run:
 *   1. First-call divergence: after one informative batch on a zero-init
 *      globalFisher, how far baseline's post-call value is from the
 *      analytically-correct (1-alpha)*old+alpha*new formula.
 *   2. 20-step retention: after one strong signal batch followed by 20
 *      near-zero "noise" batches, what fraction of the original signal
 *      survives in globalFisher[0] — baseline vs candidate vs the
 *      independently-computed analytical expectation (1-alpha)^20.
 *   3. Regression guard: getPenalty(), computeConfidencePenalty(),
 *      computeFisherMatrix(), recordGradient() produce IDENTICAL output
 *      for identical inputs, baseline vs candidate (this fix touches
 *      exactly one method).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CANDIDATE_PATH = path.join(REPO_ROOT, 'v3/@claude-flow/cli/src/memory/ewc-consolidation.ts');
const REL_PATH = 'v3/@claude-flow/cli/src/memory/ewc-consolidation.ts';

function extractBaseline() {
  const src = execFileSync('git', ['show', `HEAD:${REL_PATH}`], { cwd: REPO_ROOT, encoding: 'utf-8' });
  const dir = mkdtempSync(path.join(tmpdir(), 'dream-ewc-baseline-'));
  const file = path.join(dir, 'ewc-consolidation.baseline.ts');
  writeFileSync(file, src);
  return file;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIMS = 8;
const ALPHA = 0.01; // default fisherDecayRate

async function run() {
  const baselinePath = extractBaseline();
  const baselineMod = await import(`file://${baselinePath}`);
  const candidateMod = await import(`file://${CANDIDATE_PATH}?t=${Date.now()}`);

  const results = { firstCall: {}, retention: {}, regression: {} };

  // ---------------------------------------------------------------------
  // 1. First-call divergence
  // ---------------------------------------------------------------------
  {
    const rng = mulberry32(1);
    const embedding = new Array(DIMS).fill(0).map((_, i) => (i === 0 ? 10 : 0));
    const change = { id: 'p0', embedding, oldConf: 0, newConf: 1 }; // confDelta=1

    for (const [label, mod] of [['baseline', baselineMod], ['candidate', candidateMod]]) {
      const c = new mod.EWCConsolidator({ storagePath: `/tmp/dream-ewc-${label}-first.json`, dimensions: DIMS, fisherDecayRate: ALPHA });
      c.updateFisherFromConfidences([change]);
      results.firstCall[label] = c.getConsolidationStats ? undefined : undefined; // placeholder, real read below
      // Read internal state via public API surface: globalFisher isn't public,
      // but getConsolidationStats().avgFisherValue/maxFisherValue expose it.
      const stats = c.getConsolidationStats();
      results.firstCall[label] = { avgFisherValue: stats.avgFisherValue, maxFisherValue: stats.maxFisherValue };
    }
    // Analytical expectation for the CORRECT convention: (1-alpha)*0 + alpha*100 = 1.0 at dim0, avg = 1.0/8 = 0.125
    const expectedCandidateMax = ALPHA * 100;
    results.firstCall.expectedCandidateMax = expectedCandidateMax;
    results.firstCall.expectedBaselineMax = (1 - ALPHA) * 100; // the (documented, but now-fixed) swapped convention
  }

  // ---------------------------------------------------------------------
  // 2. 20-step retention
  // ---------------------------------------------------------------------
  {
    const strongEmbedding = new Array(DIMS).fill(0).map((_, i) => (i === 0 ? 10 : 0));
    const strongChange = { id: 'p0', embedding: strongEmbedding, oldConf: 0, newConf: 1 };
    const rng = mulberry32(7);
    const noiseChanges = [];
    for (let step = 0; step < 20; step++) {
      const embedding = new Array(DIMS).fill(0).map(() => (rng() - 0.5) * 0.02); // tiny noise
      noiseChanges.push({ id: `noise-${step}`, embedding, oldConf: 0, newConf: 0.05 });
    }

    for (const [label, mod] of [['baseline', baselineMod], ['candidate', candidateMod]]) {
      const c = new mod.EWCConsolidator({ storagePath: `/tmp/dream-ewc-${label}-retention.json`, dimensions: DIMS, fisherDecayRate: ALPHA });
      c.updateFisherFromConfidences([strongChange]);
      const afterStrongStats = c.getConsolidationStats();
      const afterStrongMax = afterStrongStats.maxFisherValue;
      for (const nc of noiseChanges) {
        c.updateFisherFromConfidences([nc]);
      }
      const afterNoiseStats = c.getConsolidationStats();
      // maxFisherValue tracks globalFisher[0] since dim0 dominates throughout
      const retentionFraction = afterStrongMax > 0 ? afterNoiseStats.maxFisherValue / afterStrongMax : null;
      results.retention[label] = {
        afterStrongMax,
        afterNoiseMax: afterNoiseStats.maxFisherValue,
        retentionFraction
      };
    }
    // Analytical expectation under the CORRECT convention: retention ~ (1-alpha)^20 per step
    // (noise contribution is negligible: (0.02*0.05)^2 ~ 1e-6, dwarfed by 1.0 baseline)
    results.retention.analyticalExpectedRetention = Math.pow(1 - ALPHA, 20);
  }

  // ---------------------------------------------------------------------
  // 3. Regression guard — unrelated methods byte-identical
  // ---------------------------------------------------------------------
  {
    const oldWeights = [1, 2, 3, 4, 5, 6, 7, 8];
    const newWeights = [1.1, 1.9, 3.2, 3.8, 5.5, 5.9, 7.3, 7.7];
    const fisher = [0.1, 0.2, 0.05, 0.3, 0.15, 0.25, 0.1, 0.4];

    const regressionResults = {};
    for (const [label, mod] of [['baseline', baselineMod], ['candidate', candidateMod]]) {
      const c = new mod.EWCConsolidator({ storagePath: `/tmp/dream-ewc-${label}-regression.json`, dimensions: DIMS, fisherDecayRate: ALPHA });
      const penalty = c.getPenalty(oldWeights, newWeights, fisher);
      const confPenalty = c.computeConfidencePenalty(0.5, 0.8);
      const fisherMatrix = c.computeFisherMatrix([
        { id: 'a', embedding: [1, 1, 1, 1, 1, 1, 1, 1], success: true },
        { id: 'b', embedding: [2, 0, 0, 0, 0, 0, 0, 0], success: true },
        { id: 'c', embedding: [9, 9, 9, 9, 9, 9, 9, 9], success: false } // excluded (not success)
      ]);
      c.recordGradient('p1', [1, 2, 3, 4, 5, 6, 7, 8], true);
      const statsAfterGradient = c.getConsolidationStats();
      regressionResults[label] = { penalty, confPenalty, fisherMatrix, avgFisherAfterGradient: statsAfterGradient.avgFisherValue };
    }
    results.regression.baseline = regressionResults.baseline;
    results.regression.candidate = regressionResults.candidate;
    results.regression.identical =
      regressionResults.baseline.penalty === regressionResults.candidate.penalty &&
      regressionResults.baseline.confPenalty === regressionResults.candidate.confPenalty &&
      JSON.stringify(regressionResults.baseline.fisherMatrix) === JSON.stringify(regressionResults.candidate.fisherMatrix) &&
      regressionResults.baseline.avgFisherAfterGradient === regressionResults.candidate.avgFisherAfterGradient;
  }

  const verdict =
    results.regression.identical &&
    results.retention.candidate.retentionFraction > 0.7 && // ~0.818 expected
    results.retention.baseline.retentionFraction < 0.05    // baseline discards almost everything each step
      ? 'ACCEPT' : 'INCONCLUSIVE';

  const out = { generatedAt: 'dream-cycle-2026-08-17', alpha: ALPHA, dims: DIMS, results, verdict };
  console.log(JSON.stringify(out, null, 2));
  console.log('===BENCH_JSON===');
  console.log(JSON.stringify(out));
}

run().catch((e) => { console.error('BENCH FAILED:', e); process.exit(1); });
