// Dream Cycle 2026-08-16 (DEEP=security) — SafeExecutor allowlist-bypass benchmark.
//
// Dependency-free, git-reproducible. Extracts the baseline (parent commit)
// `safe-executor.ts` via `git show HEAD:...` and imports it side-by-side
// with the working-tree candidate, using Node's built-in
// `--experimental-transform-types` (safe-executor.ts uses TS constructor
// parameter properties, which `--experimental-strip-types` alone rejects —
// confirmed by hand tonight; `--experimental-transform-types` handles them).
// No npm dependencies: only `node:child_process`, `node:fs`, `node:os`,
// `node:path`, `node:url` — all built-in, matching this repo's
// node_modules-absent-checkout constraint (still true tonight, same as the
// last 3 Dream Cycles).
//
// Reproduce: node --experimental-transform-types bench-safe-executor-allowlist-bypass.mjs
//
// Two measurements:
//  1. Decision-boundary proof (isCommandAllowed) — pure, non-executing.
//  2. End-to-end proof-of-exploit — actually calls execute() against a
//     harmless sentinel script planted at a path whose *basename* collides
//     with an allowlisted command name, and checks whether the sentinel
//     file it writes on execution actually appears. This is the real
//     vulnerability (validateCommand() authorizing execFile() to run an
//     unintended binary), not just the boolean helper.

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = execSync('git rev-parse --show-toplevel', { cwd: __dirname }).toString().trim();
const SRC_REL = 'v3/@claude-flow/security/src/safe-executor.ts';
const CANDIDATE_PATH = join(REPO_ROOT, SRC_REL);

const workDir = mkdtempSync(join(tmpdir(), 'dream-2026-08-16-security-'));

function extractBaseline() {
  const baselineSrc = execSync(`git show HEAD:${SRC_REL}`, { cwd: REPO_ROOT }).toString();
  const p = join(workDir, 'baseline.mts');
  writeFileSync(p, baselineSrc);
  return p;
}

function copyCandidate() {
  const src = readFileSync(CANDIDATE_PATH, 'utf8');
  const p = join(workDir, 'candidate.mts');
  writeFileSync(p, src);
  return p;
}

// A harmless "spoofed" executable: when run, it writes a sentinel marker
// file. If it ever runs, the marker exists -> the allowlist was defeated.
// It is NOT a real payload — it never touches anything outside `workDir`.
function plantSpoofedBinary(basenameToSpoof) {
  const dir = mkdtempSync(join(workDir, 'attacker-'));
  const binPath = join(dir, basenameToSpoof);
  const markerPath = join(dir, '.sentinel-executed');
  writeFileSync(binPath, `#!/bin/sh\ntouch "${markerPath}"\necho "spoofed-${basenameToSpoof}-ran"\n`);
  chmodSync(binPath, 0o755);
  return { binPath, markerPath };
}

async function loadExecutor(modPath) {
  const mod = await import(modPath);
  return mod.SafeExecutor;
}

async function run() {
  const baselinePath = extractBaseline();
  const candidatePath = copyCandidate();
  const BaselineSafeExecutor = await loadExecutor(baselinePath);
  const CandidateSafeExecutor = await loadExecutor(candidatePath);

  const results = { decisionBoundary: [], endToEnd: [], legitimate: [], knownBehaviorChange: [] };

  // --- 1. Decision-boundary corpus (isCommandAllowed) ---------------------
  const attackCases = [
    { name: 'absolute-path-basename-spoof', allowlist: ['git'], command: '/tmp/attacker-controlled/git' },
    { name: 'relative-dotslash-basename-spoof', allowlist: ['npm'], command: './attacker-dir/npm' },
    { name: 'parent-traversal-basename-spoof', allowlist: ['tar'], command: '../../tmp/attacker/tar' },
    { name: 'trailing-slash-bare-name-mutation', allowlist: ['git'], command: 'git/' },
    { name: 'nested-path-basename-spoof', allowlist: ['powershell'], command: '/opt/evil/nested/dir/powershell' },
  ];
  for (const c of attackCases) {
    const baseEx = new BaselineSafeExecutor({ allowedCommands: c.allowlist });
    const candEx = new CandidateSafeExecutor({ allowedCommands: c.allowlist });
    const baselineAllowed = baseEx.isCommandAllowed(c.command);
    const candidateAllowed = candEx.isCommandAllowed(c.command);
    results.decisionBoundary.push({ ...c, baselineAllowed, candidateAllowed, fixed: baselineAllowed === true && candidateAllowed === false });
  }

  // --- 2. Legitimate-usage regression corpus (isCommandAllowed) ----------
  const legitCases = [
    { name: 'bare-git', allowlist: ['git'], command: 'git' },
    { name: 'bare-npm', allowlist: ['npm'], command: 'npm' },
    { name: 'bare-tar', allowlist: ['tar'], command: 'tar' },
    { name: 'bare-powershell', allowlist: ['powershell', 'powershell.exe'], command: 'powershell' },
    { name: 'exact-path-explicitly-allowlisted', allowlist: ['/usr/bin/git'], command: '/usr/bin/git' },
  ];
  for (const c of legitCases) {
    const baseEx = new BaselineSafeExecutor({ allowedCommands: c.allowlist });
    const candEx = new CandidateSafeExecutor({ allowedCommands: c.allowlist });
    const baselineAllowed = baseEx.isCommandAllowed(c.command);
    const candidateAllowed = candEx.isCommandAllowed(c.command);
    results.legitimate.push({ ...c, baselineAllowed, candidateAllowed, regressed: baselineAllowed === true && candidateAllowed === false });
  }

  // --- 2b. Known, deliberate behavior change (found by adversarial review) --
  // A caller that resolves a bare-allowlisted command to its absolute path
  // *before* calling execute() (e.g. `execute(which('git'), args)` with
  // allowlist=['git']) used to pass under baseline's basename-only match.
  // The candidate now rejects it, because "absolute path whose basename
  // matches an allowlisted bare name" is *exactly* the bypass surface being
  // closed — the fix cannot allow it for a legitimately-resolved path
  // without also allowing it for an attacker-crafted one; the two are
  // indistinguishable by basename alone. No in-repo caller does this today
  // (confirmed by grep across v3/ for `new SafeExecutor(` / factory calls —
  // all pass literal bare names). Documented, not silently absorbed into
  // the "legitimate" pass-rate metric above.
  {
    const allowlist = ['node'];
    const resolvedPath = process.execPath; // e.g. /usr/local/bin/node — real absolute path, basename is 'node'
    const baseEx = new BaselineSafeExecutor({ allowedCommands: allowlist });
    const candEx = new CandidateSafeExecutor({ allowedCommands: allowlist });
    results.knownBehaviorChange.push({
      name: 'resolved-absolute-path-matching-bare-allowlist-basename',
      allowlist,
      command: resolvedPath,
      baselineAllowed: baseEx.isCommandAllowed(resolvedPath),
      candidateAllowed: candEx.isCommandAllowed(resolvedPath),
      note: 'Deliberate: closing the bypass necessarily also closes this same-shaped legitimate pattern. Caller must add the literal resolved path to the allowlist instead of relying on basename leniency.',
    });
  }

  // --- 3. End-to-end proof-of-exploit (real execute(), real child process) ---
  {
    const { binPath, markerPath } = plantSpoofedBinary('git');
    const baseEx = new BaselineSafeExecutor({ allowedCommands: ['git'], timeout: 5000 });
    let baselineExploited = false;
    let baselineError = null;
    try {
      await baseEx.execute(binPath, []);
      baselineExploited = existsSync(markerPath);
    } catch (e) {
      baselineError = e.code ?? e.message;
    }
    results.endToEnd.push({ name: 'baseline-spoofed-git-execute', exploited: baselineExploited, error: baselineError });
  }
  {
    const { binPath, markerPath } = plantSpoofedBinary('git');
    const candEx = new CandidateSafeExecutor({ allowedCommands: ['git'], timeout: 5000 });
    let candidateExploited = false;
    let candidateError = null;
    try {
      await candEx.execute(binPath, []);
      candidateExploited = existsSync(markerPath);
    } catch (e) {
      candidateError = e.code ?? e.message;
    }
    results.endToEnd.push({ name: 'candidate-spoofed-git-execute', exploited: candidateExploited, error: candidateError });
  }
  // Legitimate end-to-end: real bare 'echo' should still actually run on both.
  {
    for (const [label, Ex] of [['baseline', BaselineSafeExecutor], ['candidate', CandidateSafeExecutor]]) {
      const ex = new Ex({ allowedCommands: ['echo'], timeout: 5000 });
      const r = await ex.execute('echo', ['dream-cycle-2026-08-16']);
      results.endToEnd.push({ name: `${label}-bare-echo-execute`, exitCode: r.exitCode, stdoutTrimmed: r.stdout.trim() });
    }
  }

  // --- Summary metrics ------------------------------------------------------
  const attackTotal = results.decisionBoundary.length;
  const baselineAsr = results.decisionBoundary.filter(r => r.baselineAllowed).length / attackTotal;
  const candidateAsr = results.decisionBoundary.filter(r => r.candidateAllowed).length / attackTotal;
  const legitTotal = results.legitimate.length;
  const baselineLegitPass = results.legitimate.filter(r => r.baselineAllowed).length / legitTotal;
  const candidateLegitPass = results.legitimate.filter(r => r.candidateAllowed).length / legitTotal;
  const anyRegression = results.legitimate.some(r => r.regressed);

  const summary = {
    date: '2026-08-16',
    corpus: { attackCases: attackTotal, legitimateCases: legitTotal },
    decisionBoundaryASR: { baseline: baselineAsr, candidate: candidateAsr },
    legitimateUsagePassRate: { baseline: baselineLegitPass, candidate: candidateLegitPass },
    endToEndExploit: {
      baselineExploited: results.endToEnd.find(r => r.name === 'baseline-spoofed-git-execute')?.exploited,
      candidateExploited: results.endToEnd.find(r => r.name === 'candidate-spoofed-git-execute')?.exploited,
    },
    anyLegitimateRegression: anyRegression,
  };

  const receipt = {
    summary,
    decisionBoundary: results.decisionBoundary,
    legitimate: results.legitimate,
    knownBehaviorChange: results.knownBehaviorChange,
    endToEnd: results.endToEnd,
  };
  console.log(JSON.stringify(receipt, null, 2));

  rmSync(workDir, { recursive: true, force: true });
}

run().catch(e => {
  console.error('BENCHMARK FAILED', e);
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
});
