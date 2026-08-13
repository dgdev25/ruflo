import { describe, it, expect, vi } from 'vitest';
import {
  smartSearch,
  defaultQueryExpansions,
  type SearchCandidate,
  type SearchFn,
} from './smart-retrieval.js';

function makeCandidate(partial: Partial<SearchCandidate> & { id: string; content: string }): SearchCandidate {
  return {
    key: partial.id,
    namespace: 'test',
    score: 0.5,
    ...partial,
  };
}

describe('defaultQueryExpansions', () => {
  it('returns the original query plus keyword-only and context variants', () => {
    const variants = defaultQueryExpansions('What is the capital of France?');
    expect(variants.length).toBeGreaterThanOrEqual(2);
    expect(variants[0]).toBe('What is the capital of France?');
    // Keyword variant strips stopwords
    expect(variants.some((v) => v.includes('capital') && v.includes('france'))).toBe(true);
  });

  it('drops duplicate variants', () => {
    const variants = defaultQueryExpansions('hello');
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('handles empty input', () => {
    expect(defaultQueryExpansions('')).toEqual([]);
  });
});

describe('smartSearch — multi-query fan-out', () => {
  it('fans out one call per variant and fuses with RRF', async () => {
    const calls: string[] = [];
    const search: SearchFn = async ({ query }) => {
      calls.push(query);
      // Each variant returns a slightly different list. Item A is top of first,
      // bottom of second; item B is the inverse. RRF should put A and B both
      // near the top because they each appear in two variant lists.
      if (query.includes('tell me about')) {
        return {
          results: [
            makeCandidate({ id: 'b', content: 'beta content', score: 0.9 }),
            makeCandidate({ id: 'a', content: 'alpha content', score: 0.4 }),
          ],
        };
      }
      return {
        results: [
          makeCandidate({ id: 'a', content: 'alpha content', score: 0.9 }),
          makeCandidate({ id: 'b', content: 'beta content', score: 0.4 }),
        ],
      };
    };

    const { results, stats } = await smartSearch(search, {
      query: 'alpha beta',
      limit: 5,
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });

    expect(stats.variantCount).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBe(stats.variantCount);
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('falls back to a single raw call when multiQuery=false', async () => {
    // NOTE: no vi.fn<T> generic — the hoisted vitest (1.x) types Mock as
    // Mock<Args extends any[], Returns>, so the vitest-4 single-generic
    // form fails `tsc`. The inferred signature is identical.
    const search: SearchFn = vi.fn(async () => ({
      results: [makeCandidate({ id: 'x', content: 'only one' })],
    }));

    await smartSearch(search, {
      query: 'whatever',
      multiQuery: false,
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });

    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe('smartSearch — recency boost', () => {
  it('reorders stale candidates below fresh ones at equal similarity', async () => {
    const now = Date.parse('2026-04-11T00:00:00Z');
    const oneDay = 24 * 60 * 60 * 1000;

    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'stale',
          content: 'stale content',
          score: 0.8,
          updatedAt: now - 365 * oneDay, // a year old
        }),
        makeCandidate({
          id: 'fresh',
          content: 'fresh content',
          score: 0.78,
          updatedAt: now - oneDay, // yesterday
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'something',
      limit: 2,
      multiQuery: false,
      diversityMMR: false,
      sessionDiversity: false,
      recencyHalfLifeDays: 30,
      recencyWeight: 0.5,
      now,
    });

    expect(results[0].id).toBe('fresh');
    expect(results[1].id).toBe('stale');
  });

  it('is a no-op when candidates have no timestamps', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'alpha', score: 0.9 }),
        makeCandidate({ id: 'b', content: 'beta', score: 0.8 }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      multiQuery: false,
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: true,
    });

    expect(results.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('smartSearch — MMR diversity', () => {
  it('pushes near-duplicate content down the list', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: '1', content: 'the cat sat on the mat quietly', score: 0.95 }),
        makeCandidate({ id: '2', content: 'the cat sat on the mat quietly today', score: 0.94 }),
        makeCandidate({ id: '3', content: 'quantum entanglement paradox resolved', score: 0.6 }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      sessionDiversity: false,
      diversityMMR: true,
      mmrLambda: 0.3, // lean heavily on diversity
    });

    // Seed is #1 (top). Between #2 (near-duplicate) and #3 (different topic),
    // MMR with λ=0.3 should pick #3 second.
    expect(results[0].id).toBe('1');
    expect(results[1].id).toBe('3');
  });
});

describe('smartSearch — session round-robin', () => {
  it('interleaves results across distinct sessions', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'a1',
          content: 'alpha one',
          score: 0.95,
          metadata: { session_id: 'A' },
        }),
        makeCandidate({
          id: 'a2',
          content: 'alpha two',
          score: 0.9,
          metadata: { session_id: 'A' },
        }),
        makeCandidate({
          id: 'b1',
          content: 'beta one',
          score: 0.85,
          metadata: { session_id: 'B' },
        }),
        makeCandidate({
          id: 'c1',
          content: 'gamma one',
          score: 0.8,
          metadata: { session_id: 'C' },
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 3,
      multiQuery: false,
      recencyBoost: false,
      diversityMMR: false,
      sessionDiversity: true,
    });

    const sessions = results.map((r) => r.metadata?.session_id);
    // Top-3 should cover 3 distinct sessions, not just session A twice.
    expect(new Set(sessions).size).toBe(3);
    expect(sessions[0]).toBe('A'); // Highest-scored bucket leader first
  });

  it('passes through when all candidates share one session', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({
          id: 'a1',
          content: 'one',
          score: 0.9,
          metadata: { session_id: 'S' },
        }),
        makeCandidate({
          id: 'a2',
          content: 'two',
          score: 0.8,
          metadata: { session_id: 'S' },
        }),
      ],
    });

    const { results } = await smartSearch(search, {
      query: 'x',
      limit: 2,
      multiQuery: false,
      recencyBoost: false,
      diversityMMR: false,
      sessionDiversity: true,
    });

    expect(results.map((r) => r.id)).toEqual(['a1', 'a2']);
  });
});

describe('smartSearch — stats reporting', () => {
  it('reports variant count, raw candidate count, and phase counts', async () => {
    const search: SearchFn = async () => ({
      results: [
        makeCandidate({ id: 'a', content: 'alpha' }),
        makeCandidate({ id: 'b', content: 'beta' }),
      ],
    });

    const { stats } = await smartSearch(search, {
      query: 'hello world',
      limit: 2,
    });

    expect(stats.variantCount).toBeGreaterThanOrEqual(1);
    expect(stats.rawCandidateCount).toBeGreaterThan(0);
    expect(stats.variants.length).toBe(stats.variantCount);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('smartSearch — concurrent variant fan-out (dream-cycle 2026-08-13 candidate)', () => {
  it('runs variant queries concurrently instead of one-at-a-time', async () => {
    const perCallDelayMs = 40;
    const search: SearchFn = async ({ query }) => {
      await new Promise((resolve) => setTimeout(resolve, perCallDelayMs));
      return { results: [makeCandidate({ id: query, content: query })] };
    };

    const start = Date.now();
    const { stats } = await smartSearch(search, {
      query: 'alpha beta gamma',
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });
    const elapsed = Date.now() - start;

    // A sequential for-await loop takes roughly variantCount * perCallDelayMs.
    // Concurrent fan-out should take roughly one perCallDelayMs regardless of
    // variant count. Assert well under 2x a single call's delay — a loose
    // bound that tolerates CI jitter but still fails hard on a regression
    // back to sequential awaiting (which would take >=3x for 3 variants).
    expect(stats.variantCount).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThan(perCallDelayMs * 2);
  });

  it('preserves variant order in the fused results regardless of per-call resolution order', async () => {
    // The first variant resolves slowest, the rest resolve fastest. RRF
    // fusion is a stable sort over equal scores, so if Promise.all-based
    // fan-out preserves input order (not completion order) the fused
    // result order must still match the original variants array.
    const search: SearchFn = async ({ query }) => {
      const delay = query.startsWith('slow') ? 30 : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { results: [makeCandidate({ id: query, content: query, score: 0.9 })] };
    };

    const { results, stats } = await smartSearch(search, {
      query: 'whatever',
      queryExpansions: () => ['slow-variant', 'fast-variant-a', 'fast-variant-b'],
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });

    expect(stats.variants).toEqual(['slow-variant', 'fast-variant-a', 'fast-variant-b']);
    expect(results.map((r) => r.id)).toEqual(['slow-variant', 'fast-variant-a', 'fast-variant-b']);
  });
});
