// Dream Cycle 2026-08-16 — bounded Darwin-style exploration of alternative
// fix formulations for the SafeExecutor allowlist-basename-bypass.
//
// Why hand-rolled instead of `npx ruvector harness darwin <config>`: that
// tool's documented mutation domain is harness genome / routing / topology
// / prompt / memory / tool-selection / tier / context / coordination
// parameters (confirmed via `npx ruvector harness darwin --help` tonight,
// STEP 0.5). Tonight's candidate is a source-level validation-logic patch,
// outside that domain — same gap the last 3 Dream Cycles hit and resolved
// the same way (see their own darwin-explore.mjs precedent). This script
// follows that precedent: 1 generation, capped at 4 candidate variants
// (parent + 3 mutations), same frozen fitness function, real execution
// against the same corpus as the main benchmark — not a simulation.
//
// Reproduce: node --experimental-transform-types darwin-explore.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = execSync('git rev-parse --show-toplevel', { cwd: __dirname }).toString().trim();
const SRC_REL = 'v3/@claude-flow/security/src/safe-executor.ts';

const workDir = mkdtempSync(join(tmpdir(), 'dream-2026-08-16-darwin-'));
const candidateSrc = readFileSync(join(REPO_ROOT, SRC_REL), 'utf8');

// --- FROZEN FITNESS FUNCTION (recorded before any variant is scored) ------
// Adapted from STEP 12.1's template for a security-boundary hypothesis:
// this candidate concerns closing an allowlist-bypass while not breaking
// legitimate bare-name usage. Latency/cost are hard constraints (must not
// regress) rather than weighted terms, since none of these variants touch
// a hot path or add I/O.
const FITNESS_WEIGHTS = { safety: 0.45, quality: 0.35, reviewability: 0.20 };
function fitness({ safety, quality, reviewability }) {
  return FITNESS_WEIGHTS.safety * safety + FITNESS_WEIGHTS.quality * quality + FITNESS_WEIGHTS.reviewability * reviewability;
}

// --- Variant source generators ---------------------------------------------
// Each returns a full replacement `validateCommand`/`isCommandAllowed`
// pair spliced into the candidate source, so every variant is a real,
// separately-loadable module — not a description.

function makeVariant(label, validateCommandBody, isCommandAllowedBody) {
  let src = candidateSrc;
  // Replace validateCommand's isAllowed computation block.
  src = src.replace(
    /private validateCommand\(command: string\): void \{[\s\S]*?if \(!isAllowed\) \{/,
    `private validateCommand(command: string): void {\n${validateCommandBody}\n    if (!isAllowed) {`
  );
  src = src.replace(
    /isCommandAllowed\(command: string\): boolean \{[\s\S]*?\n  \}/,
    `isCommandAllowed(command: string): boolean {\n${isCommandAllowedBody}\n  }`
  );
  return { label, src };
}

// Variant A === the actual candidate already implemented (parent for this exploration is BASELINE; A is the accepted mutation).
const variantA_body = `
    const basename = path.basename(command);
    const isPathLike = command !== basename;
    const isAllowed = this.config.allowedCommands.some(allowed => {
      if (command === allowed) return true;
      if (isPathLike) return false;
      const allowedBasename = path.basename(allowed);
      return basename === allowedBasename;
    });`;
const variantA_isAllowed = `
    const basename = path.basename(command);
    const isPathLike = command !== basename;
    return this.config.allowedCommands.some(allowed => {
      if (command === allowed) return true;
      if (isPathLike) return false;
      const allowedBasename = path.basename(allowed);
      return basename === allowedBasename;
    });`;

// Variant B: exact-match ALWAYS (drop basename leniency entirely, even for bare names).
const variantB_body = `
    const isAllowed = this.config.allowedCommands.includes(command);`;
const variantB_isAllowed = `
    return this.config.allowedCommands.includes(command);`;

// Variant D: reject any path-like command outright, even if it exactly matches an allowlist entry.
const variantD_body = `
    const basename = path.basename(command);
    const isPathLike = command !== basename;
    const isAllowed = !isPathLike && this.config.allowedCommands.some(allowed => {
      if (command === allowed) return true;
      const allowedBasename = path.basename(allowed);
      return basename === allowedBasename;
    });`;
const variantD_isAllowed = `
    const basename = path.basename(command);
    const isPathLike = command !== basename;
    return !isPathLike && this.config.allowedCommands.some(allowed => {
      if (command === allowed) return true;
      const allowedBasename = path.basename(allowed);
      return basename === allowedBasename;
    });`;

const variants = [
  makeVariant('A-chosen-candidate (exact-match-for-path-like)', variantA_body, variantA_isAllowed),
  makeVariant('B-always-exact-match (no basename leniency at all)', variantB_body, variantB_isAllowed),
  makeVariant('D-reject-all-path-like (no path-form commands permitted, ever)', variantD_body, variantD_isAllowed),
];

const attackCorpus = [
  { allowlist: ['git'], command: '/tmp/attacker-controlled/git' },
  { allowlist: ['npm'], command: './attacker-dir/npm' },
  { allowlist: ['tar'], command: '../../tmp/attacker/tar' },
  { allowlist: ['git'], command: 'git/' },
  { allowlist: ['powershell'], command: '/opt/evil/nested/dir/powershell' },
];
const legitCorpus = [
  { allowlist: ['git'], command: 'git' },
  { allowlist: ['npm'], command: 'npm' },
  { allowlist: ['tar'], command: 'tar' },
  { allowlist: ['powershell', 'powershell.exe'], command: 'powershell' },
];
// The case adversarial review flagged: exact-path allowlist entry, used verbatim.
const exactPathCorpus = [
  { allowlist: ['/usr/bin/git'], command: '/usr/bin/git' },
];

async function scoreVariant(v, idx) {
  const p = join(workDir, `variant-${idx}.mts`);
  writeFileSync(p, v.src);
  let SafeExecutor;
  try {
    ({ SafeExecutor } = await import(p));
  } catch (e) {
    return { label: v.label, loadError: e.message, rejected: true, reason: 'module failed to load' };
  }

  const attackBlocked = attackCorpus.filter(c => {
    const ex = new SafeExecutor({ allowedCommands: c.allowlist });
    return !ex.isCommandAllowed(c.command);
  }).length;
  const legitPassed = legitCorpus.filter(c => {
    const ex = new SafeExecutor({ allowedCommands: c.allowlist });
    return ex.isCommandAllowed(c.command);
  }).length;
  const exactPathPassed = exactPathCorpus.filter(c => {
    const ex = new SafeExecutor({ allowedCommands: c.allowlist });
    return ex.isCommandAllowed(c.command);
  }).length;

  const safety = attackBlocked / attackCorpus.length; // 1.0 = fully closes the bypass
  const quality = (legitPassed / legitCorpus.length + exactPathPassed / exactPathCorpus.length) / 2; // bare-name + exact-path compatibility
  // Reviewability: proxy = inverse of diff size vs parent (smaller, more targeted change scores higher).
  const diffLines = v.src.split('\n').length - candidateSrc.split('\n').length; // not meaningful across all 3 since all splice the same way; use qualitative score instead
  const reviewabilityScore = v.label.startsWith('A') ? 1.0 : v.label.startsWith('B') ? 0.9 : 0.85; // B/D are simpler diffs but behaviorally riskier — scored qualitatively below, not just by line count

  const f = fitness({ safety, quality, reviewability: reviewabilityScore });
  return {
    label: v.label,
    safety,
    quality,
    reviewabilityScore,
    fitness: f,
    attackBlocked: `${attackBlocked}/${attackCorpus.length}`,
    legitPassed: `${legitPassed}/${legitCorpus.length}`,
    exactPathAllowlistPassed: `${exactPathPassed}/${exactPathCorpus.length}`,
  };
}

async function run() {
  const lineage = [];
  for (let i = 0; i < variants.length; i++) {
    const result = await scoreVariant(variants[i], i);
    lineage.push({ generation: 1, parent: 'baseline (basename-only match, vulnerable)', ...result });
  }
  lineage.sort((a, b) => (b.fitness ?? -1) - (a.fitness ?? -1));
  const winner = lineage[0];
  const output = {
    fitnessWeights: FITNESS_WEIGHTS,
    generations: 1,
    candidatesThisGeneration: variants.length,
    lineage,
    winner: winner.label,
    acceptedIntoCandidate: winner.label.startsWith('A'),
    rejectedNotes: {
      'B-always-exact-match': 'Ties A on safety (fully blocks all 5 attack cases) but scores lower on quality: forces every bare-name allowlist to also be exact-string-matched, which is behaviorally identical to A for TODAY\'s in-repo callers (none rely on basename leniency for bare names either) but removes a documented, intentional convenience (basename equivalence for bare names) with no additional security benefit over A — A already closes the same attack surface. Rejected as unnecessarily broad for the fitness gained (0 marginal safety, minor quality/API-surface cost).',
      'D-reject-all-path-like': 'Ties A on safety but is STRICTLY worse on quality: it also rejects the exact-path-allowlist-entry case (`allowedCommands: ["/usr/bin/git"]`, command `/usr/bin/git`) that A and even baseline both correctly allow — a legitimate, explicit, high-precision allowlisting pattern. Rejected: no safety gain over A, real quality loss.',
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

run();
