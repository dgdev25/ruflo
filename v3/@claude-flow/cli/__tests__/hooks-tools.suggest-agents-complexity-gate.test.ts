/**
 * Dream Cycle 2026-08-14 (DEEP=swarm) — regression tests for the
 * complexity-gated agent-count discount added to `hooksPreTask` /
 * `suggestAgentsForTask` in ../src/mcp-tools/hooks-tools.ts.
 *
 * NOT RUN in this session: this checkout has no installed dependencies
 * (`v3/node_modules`, `v3/@claude-flow/cli/node_modules`, and root
 * `node_modules` are all absent) and `hooks-tools.ts` transitively imports
 * `@claude-flow/cli-core` (via `./validate-input.js`, an alpha.5 re-export
 * shim — see that file's own header comment), which is not built in this
 * environment (confirmed: `npx tsx -e "import('./hooks-tools.ts')"` fails
 * with `Cannot find package '@claude-flow/cli-core'`). Tonight's evaluation
 * evidence (docs/dream-cycle/evidence/2026-08-14-swarm/) is therefore a
 * standalone extraction of the pure logic rather than a run of this file.
 * This file exists so the real module gets real regression coverage the
 * next time `npm install && npm run build && npm test` runs in this
 * package (see v3/CLAUDE.md's build instructions).
 */
import { describe, it, expect } from 'vitest';
import { hooksPreTask } from '../src/mcp-tools/hooks-tools.js';

async function preTask(description: string) {
  const result = await hooksPreTask.handler({ taskId: 'dream-cycle-2026-08-14-test', description });
  return result as {
    complexity: 'low' | 'medium' | 'high';
    suggestedAgents: { type: string }[];
    recommendations: string[];
  };
}

describe('hooksPreTask — complexity-gated agent-count discount (Dream Cycle 2026-08-14)', () => {
  it('discounts a low-complexity, non-security task to a single suggested agent', async () => {
    const result = await preTask('fix a typo'); // <50 chars, no security keyword -> complexity 'low'
    expect(result.complexity).toBe('low');
    expect(result.suggestedAgents).toHaveLength(1);
  });

  it('does NOT discount a low-complexity task whose match includes a protected security role', async () => {
    const result = await preTask('fix auth token bug'); // <50 chars -> 'low', but matches 'auth' keyword pattern
    expect(result.complexity).toBe('low');
    expect(result.suggestedAgents.map((a) => a.type)).toContain('security-architect');
    expect(result.suggestedAgents.length).toBeGreaterThan(1);
  });

  it('does NOT discount a medium-complexity task', async () => {
    const result = await preTask('Update the api module to support a new configuration option requested by the team.');
    expect(result.complexity).toBe('medium');
    expect(result.suggestedAgents.length).toBeGreaterThan(1);
  });

  it('does NOT discount a high-complexity task', async () => {
    const result = await preTask(
      'This is a complex architecture-level change touching the database subsystem across multiple ' +
        'modules and services, requiring careful design review, cross-team coordination, migration ' +
        'planning, and a phased rollout strategy with backward-compatibility guarantees.',
    );
    expect(result.complexity).toBe('high');
    expect(result.suggestedAgents.length).toBeGreaterThan(1);
  });

  it('keeps the recommendations text consistent with the (now complexity-aware) agent count', async () => {
    const low = await preTask('fix a typo');
    expect(low.recommendations).toContain('Single agent recommended');

    const high = await preTask(
      'This is a complex architecture-level change touching the backend subsystem across multiple ' +
        'modules and services, requiring careful design review and phased rollout.',
    );
    expect(high.recommendations).toContain('Consider using swarm coordination');
  });
});
