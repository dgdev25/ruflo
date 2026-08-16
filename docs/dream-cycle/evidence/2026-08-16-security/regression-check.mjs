// Dream Cycle 2026-08-16 — manual regression pass against the candidate
// `safe-executor.ts`, re-expressing the assertions in the repo's own
// `__tests__/safe-executor.test.ts` as plain Node assertions (no vitest —
// this checkout still has no node_modules anywhere, reconfirmed tonight,
// same as the last 3 Dream Cycles). Every assertion below is copied in
// substance from that file's existing `it(...)` blocks; this is NOT a new
// test design invented to make tonight's candidate look good — it exists
// to prove the candidate doesn't regress behavior the repo already commits
// to. A human reviewer with `npm install` can still run the real
// `vitest` suite as the authoritative check before merge.
//
// Reproduce: node --experimental-transform-types regression-check.mjs

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const CANDIDATE_SRC = join(fileURLToPath(REPO_ROOT), 'v3/@claude-flow/security/src/safe-executor.ts');

const workDir = mkdtempSync(join(tmpdir(), 'dream-2026-08-16-regress-'));
const modPath = join(workDir, 'candidate.mts');
writeFileSync(modPath, readFileSync(CANDIDATE_SRC, 'utf8'));

const { SafeExecutor, SafeExecutorError, createDevelopmentExecutor, createReadOnlyExecutor } = await import(modPath);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
}

async function main() {
  // From "should require at least one allowed command"
  await check('empty-allowlist-throws', () => {
    assert.throws(() => new SafeExecutor({ allowedCommands: [] }), SafeExecutorError);
  });

  // From "should reject dangerous commands in allowlist"
  await check('dangerous-command-in-allowlist-throws', () => {
    assert.throws(() => new SafeExecutor({ allowedCommands: ['rm'] }), SafeExecutorError);
  });

  // From "should allow commands in allowlist" / "should block commands not in allowlist"
  {
    const executor = new SafeExecutor({ allowedCommands: ['echo', 'ls', 'git', 'npm', 'node'], timeout: 5000 });
    await check('allow-commands-in-allowlist', async () => {
      const r = await executor.execute('echo', ['hello']);
      assert.equal(r.exitCode, 0);
    });
    await check('block-commands-not-in-allowlist', async () => {
      await assert.rejects(() => executor.execute('curl', ['http://example.com']), SafeExecutorError);
    });
  }

  // From "Allowlist Management" describe block
  {
    const executor = new SafeExecutor({ allowedCommands: ['echo', 'ls', 'git', 'npm', 'node'], timeout: 5000 });
    await check('isCommandAllowed-true-for-listed', () => {
      assert.equal(executor.isCommandAllowed('echo'), true);
    });
    await check('isCommandAllowed-false-for-unlisted', () => {
      assert.equal(executor.isCommandAllowed('cat'), false);
    });
    await check('allowCommand-then-isCommandAllowed-true', () => {
      assert.equal(executor.isCommandAllowed('pwd'), false);
      executor.allowCommand('pwd');
      assert.equal(executor.isCommandAllowed('pwd'), true);
    });
  }

  // From factory-function tests
  await check('createDevelopmentExecutor-allows-git-npm-node', () => {
    const devExecutor = createDevelopmentExecutor();
    assert.equal(devExecutor.isCommandAllowed('git'), true);
    assert.equal(devExecutor.isCommandAllowed('npm'), true);
    assert.equal(devExecutor.isCommandAllowed('node'), true);
  });
  await check('createReadOnlyExecutor-allows-git-cat-ls', () => {
    const readOnlyExecutor = createReadOnlyExecutor();
    assert.equal(readOnlyExecutor.isCommandAllowed('git'), true);
    assert.equal(readOnlyExecutor.isCommandAllowed('cat'), true);
    assert.equal(readOnlyExecutor.isCommandAllowed('ls'), true);
  });

  // Dangerous-pattern / injection assertions (unrelated to tonight's patch,
  // included to prove they're untouched)
  {
    const executor = new SafeExecutor({ allowedCommands: ['git'], timeout: 5000 });
    await check('blocks-shell-metacharacter-args', async () => {
      await assert.rejects(() => executor.execute('git', ['status; rm -rf /']), SafeExecutorError);
    });
    await check('blocks-null-byte-args', async () => {
      await assert.rejects(() => executor.execute('git', ['status\0']), SafeExecutorError);
    });
    await check('sudo-blocked-via-allowSudo-false', async () => {
      const sudoExec = new SafeExecutor({ allowedCommands: ['apt'], allowSudo: false });
      await assert.rejects(() => sudoExec.execute('sudo', ['apt', 'install', 'x']), SafeExecutorError);
    });
  }

  const failed = results.filter(r => !r.ok);
  console.log(JSON.stringify({ totalChecks: results.length, passed: results.length - failed.length, failed, results }, null, 2));
  if (failed.length > 0) process.exit(1);
}

main();
