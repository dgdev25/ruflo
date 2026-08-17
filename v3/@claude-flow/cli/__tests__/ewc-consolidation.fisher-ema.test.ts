/**
 * EWCConsolidator.updateFisherFromConfidences() — Fisher EMA weight regression test
 *
 * Dream Cycle 2026-08-17 (DEEP=intelligence). Guards against the EMA-weight
 * inversion this candidate fixes: `updateFisherFromConfidences()` previously
 * blended `globalFisher = alpha*old + (1-alpha)*new` while the two
 * production-wired call sites (`computeFisherMatrix()`/`recordGradient()`,
 * same `fisherDecayRate` config field, same `globalFisher` state) use
 * `(1-decay)*old + decay*new`. With the default `fisherDecayRate=0.01` the
 * inverted convention discarded ~99% of accumulated Fisher history on every
 * single call — the opposite of what EWC exists to do.
 *
 * NOTE: this checkout has no installed dependencies anywhere (root, v3/,
 * v3/@claude-flow/cli/ node_modules all absent — 5th consecutive Dream
 * Cycle night blocked from `vitest`). This file is written to the repo's
 * real vitest conventions (see mcp-tools-deep.test.ts) and MUST be run by
 * a human/CI with `npm install && npm test` before merge — see
 * docs/dream-cycle/evidence/2026-08-17-intelligence/receipt-2026-08-17.json
 * caveats and the independent adversarial critique in the same directory
 * for the equivalent dependency-free manual verification performed tonight.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate from real disk I/O, same pattern as mcp-tools-deep.test.ts.
vi.mock('fs', () => {
  const memStore = new Map<string, string>();
  return {
    existsSync: vi.fn((p: string) => memStore.has(p)),
    readFileSync: vi.fn((p: string) => memStore.get(p) || '{}'),
    writeFileSync: vi.fn((p: string, d: string) => memStore.set(p, d)),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((p: string) => memStore.delete(p)),
    statSync: vi.fn(() => ({ size: 0 })),
  };
});

import { EWCConsolidator } from '../src/memory/ewc-consolidation.js';

const ALPHA = 0.01;
const DIMS = 8;

function makeConsolidator() {
  return new EWCConsolidator({ storagePath: '/mem/ewc-fisher-ema-test.json', dimensions: DIMS, fisherDecayRate: ALPHA });
}

describe('EWCConsolidator.updateFisherFromConfidences — Fisher EMA weighting', () => {
  let consolidator: EWCConsolidator;

  beforeEach(() => {
    consolidator = makeConsolidator();
  });

  it('a single call from a zero-init state matches (1-alpha)*0 + alpha*new, not the inverse', () => {
    const embedding = new Array(DIMS).fill(0).map((_, i) => (i === 0 ? 10 : 0));
    consolidator.updateFisherFromConfidences([{ id: 'p0', embedding, oldConf: 0, newConf: 1 }]);

    const stats = consolidator.getConsolidationStats();
    // currentFisher[0] = (10*1)^2 = 100; correct formula: (1-0.01)*0 + 0.01*100 = 1.0
    expect(stats.maxFisherValue).toBeCloseTo(ALPHA * 100, 6);
    // The pre-fix (buggy) formula would have produced (1-0.01)*100 = 99 here instead.
    expect(stats.maxFisherValue).not.toBeCloseTo((1 - ALPHA) * 100, 1);
  });

  it('retains ~(1-alpha)^N of an early strong signal after N subsequent weak updates', () => {
    const strongEmbedding = new Array(DIMS).fill(0).map((_, i) => (i === 0 ? 10 : 0));
    consolidator.updateFisherFromConfidences([{ id: 'p0', embedding: strongEmbedding, oldConf: 0, newConf: 1 }]);
    const afterStrong = consolidator.getConsolidationStats().maxFisherValue;

    const N = 20;
    for (let step = 0; step < N; step++) {
      const weakEmbedding = new Array(DIMS).fill(0.01);
      consolidator.updateFisherFromConfidences([{ id: `noise-${step}`, embedding: weakEmbedding, oldConf: 0, newConf: 0.05 }]);
    }
    const afterNoise = consolidator.getConsolidationStats().maxFisherValue;
    const retention = afterNoise / afterStrong;

    // Correct EMA: retention ≈ (1-alpha)^N ≈ 0.818 for alpha=0.01, N=20.
    expect(retention).toBeGreaterThan(0.7);
    expect(retention).toBeCloseTo(Math.pow(1 - ALPHA, N), 2);
  });

  it('leaves getPenalty()/computeConfidencePenalty()/computeFisherMatrix()/recordGradient() behavior untouched', () => {
    const oldWeights = [1, 2, 3, 4, 5, 6, 7, 8];
    const newWeights = [1.1, 1.9, 3.2, 3.8, 5.5, 5.9, 7.3, 7.7];
    const fisher = [0.1, 0.2, 0.05, 0.3, 0.15, 0.25, 0.1, 0.4];

    const penalty = consolidator.getPenalty(oldWeights, newWeights, fisher);
    expect(penalty).toBeGreaterThan(0);

    const confPenalty = consolidator.computeConfidencePenalty(0.5, 0.8);
    expect(confPenalty).toBeGreaterThanOrEqual(0);

    const fisherMatrix = consolidator.computeFisherMatrix([
      { id: 'a', embedding: [1, 1, 1, 1, 1, 1, 1, 1], success: true },
      { id: 'b', embedding: [2, 0, 0, 0, 0, 0, 0, 0], success: true },
      { id: 'c', embedding: [9, 9, 9, 9, 9, 9, 9, 9], success: false }, // excluded
    ]);
    expect(fisherMatrix[0]).toBeCloseTo(2.5, 6); // (1^2 + 2^2)/2
    expect(fisherMatrix[1]).toBeCloseTo(0.5, 6); // (1^2 + 0)/2

    expect(() => consolidator.recordGradient('p1', [1, 2, 3, 4, 5, 6, 7, 8], true)).not.toThrow();
  });
});
