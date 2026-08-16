Title: [Dream Cycle 2026-08-16] security: SafeExecutor allowlist basename-collision bypass, fixed + intelligence,swarm scan

Labels: dream-cycle, research, security, intelligence, swarm

## 1. Tonight's Rotation

DATE=2026-08-16, DAYINT=20260816, SLOT=1 (DAYINT % 5). DEEP=security,
SCAN=intelligence,swarm. No bonus deep dive (DAYINT % 25 = 16, DAYINT % 75 = 16
— neither trigger condition met).

## 2. Ledger Check

Read `docs/dream-cycle/LEDGER.md` (3 prior rows: 2026-08-13 memory,
2026-08-14 swarm, 2026-08-15 performance). Re-checked all 3 prior PRs via the
GitHub MCP tools tonight:

- **PR #1** (2026-08-13, memory): OPEN, draft, 3 days old — not stale (<14d threshold).
- **PR #2** (2026-08-14, swarm): OPEN, draft, 2 days old — not stale.
- **PR #3** (2026-08-15, performance): **MERGED** 2026-08-15T14:06:11Z (`state: closed`,
  `merged_at` set) — the ledger row from that night still said "open, draft"
  because it was written before the human merge. First Dream Cycle PR to
  merge (1/3 to date). Confirmed via `git log`: the merge commit
  (`fca2615`) is on `origin/main`'s tip, which this session's branch was cut
  from.

Issues: `list_issues` returns 0 open issues — consistent with the "GitHub
Issues disabled (410)" finding reconfirmed on each of the last 3 nights.

Prior-night gist self-score (STEP 1.2, rubric out of 10, scored against
2026-08-15's performance gist): **10/10** — grade-B-or-better reproducible
benchmark evidence (2), ≥4 competitor rows (2, had 4), 3 specific executable
recommendations (2), valid witness hash chain (2), 1497 words < 1500 (1),
genuinely novel finding — a real silent-NaN bug (1).

## 3. Deep Dive Findings

`SafeExecutor.validateCommand()`/`isCommandAllowed()`
(`v3/@claude-flow/security/src/safe-executor.ts`) authorize a `command`
string by `path.basename()` equality against the allowlist alone — no
requirement that a *path-like* command match an allowlist entry exactly. A
path such as `/tmp/attacker-controlled/git` passes the same check as `git`
and is handed to `execFile()` unmodified. Real production usage exists:
`v3/@claude-flow/cli/src/proxy/install.ts` / `release.ts` construct
`SafeExecutor` instances for `tar`/`powershell`/`gh` release-archive
extraction (current call sites pass literal bare names, so this specific
checkout isn't actively exploited today — this is a defense-in-depth closure
of a latent gap in a documented, reusable security primitive).

Same bug **class** — allowlist match logic looser than the string actually
executed — as two 2026 CVEs found in comparable agentic tools: OpenClaw's
exec-allowlist pattern overmatch (CVE-2026-32973, CVSS 9.8,
GHSA-f8r2-vg7x-gh8m) and Cursor's terminal-allowlist bypass (CVE-2026-22708,
GHSA-82wg-qcm4-fp2w). Neither of the 2 prior (pre-ledger) security Dream
Cycle reports (`docs/dream-cycle/2026-06-21-security-sota.md`, and
`v3/docs/dream-cycle/2026-07-01`/`2026-07-06`) flagged this — their
recommendations (SandboxEnforcer/Cordon rollback, memory-fragmentation
detection, CmdNeedle equivalence-class audit, VMG, RepE-based IPI detection,
skill-file signature verification) were all still unimplemented and remain
open; tonight's finding is a fresh code-read, not a re-derivation of any of
those.

## 4. Hypothesis

See "Hypothesis (frozen before evaluation)" in the gist — reproduced
verbatim there; not duplicated here to avoid drift between two copies.

## 5. Evaluation Receipt

`evaluated: accepted`. `docs/dream-cycle/evidence/2026-08-16-security/receipt-2026-08-16.json`:
decision-boundary ASR 100%→0% (5/5 attack cases), legitimate-usage pass rate
unchanged at 100% (4/4 bare-name + 1/1 exact-path), real end-to-end
proof-of-exploit (planted sentinel binary executes on baseline, blocked on
candidate). `regression-receipt-2026-08-16.json`: 12/12 manually-reconstructed
existing-test assertions pass.

## 6. Darwin Results

1 generation, 3 real variants, frozen fitness
`0.45·safety + 0.35·quality + 0.20·reviewability`. Winner: shipped Variant A
(fitness 1.00). Rejected: Variant B (0.98, zero marginal safety over A),
Variant D (0.795, breaks a legitimate exact-path-allowlist pattern). Full
lineage: `darwin-lineage-2026-08-16.json`.

## 7. Flywheel Evidence

`flywheel-evidence.json` — provenance-classified (OBSERVATION/MEASUREMENT/
INFERENCE/HYPOTHESIS/DECISION/REJECTION). `flywheel gate` (real tool
invocation): `{"promote": true, "reasons": []}`. `flywheel verify` attempted
and errored — requires a signed `{chain: Receipt[]}` bundle this application
repo doesn't produce for arbitrary source patches (true for all 4 Dream
Cycles to date). Disclosed as a reproducibility caveat, not hidden.

## 8. Reward Hack Check

No dedicated reward-hack-detection CLI surfaced (`npx ruvector harness --help`
exposes status/doctor/route/flywheel/darwin only). Manual STEP 11 checklist
run in full in `adversarial-critique.md` — signal: none.

## 9. Security Review

High sensitivity — this candidate IS the security-sensitive surface. Change
narrows an authorization check fail-closed (previously-allowed inputs become
rejected, never the reverse). No new filesystem/network/credential/MCP
surface touched. Full notes in `flywheel-evidence.json`.

## 10. Scan Findings: intelligence

Time-boxed tonight in favor of the security deep-dive's real evaluation
(STEP 0.6 budget discipline) — no concrete, testable intelligence-surface
finding produced tonight. No regression from prior nights' intelligence-
adjacent state either.

## 11. Scan Findings: swarm

Same as above — time-boxed, no concrete finding produced tonight beyond
what's already tracked from 2026-08-14's ledger row.

## 12. Competitors Reviewed

OpenClaw, Cursor (both via real 2026 security advisories), LangGraph,
AutoGen, CrewAI, OpenAI Agents SDK (framework-landscape pass, no
allowlist-bypass CVE surfaced for these four in this pass).

## 13. Gist

No `gh gist create` / gist-creation MCP tool available in this session's
toolset (GitHub MCP server exposes repo/PR/issue tools, not Gist). Report
kept local: `docs/dream-cycle/2026-08-16-security-sota.md` (committed to this
PR).

## 14. Witness

Report SHA256: `3df74c57ec9aff3c34a1a30e1e69358c36a51560f4f7619a1760c50f1891ceb7`
Witness stamp: `3fd654ced58d0fddfbcdcdf122bd8bf294216d5792b6da9366f1a813d4b68353`
(= SHA256(Report SHA256 + session commit `fca26153048a87511d1e9a22b269bcbc615ac129`))

## 15. Recommendation

Human review and merge. See gist's "Recommended Next Steps" for the 3 concrete
follow-ups (merge tonight's fix; binary-hash-pin high-value SafeExecutor call
sites as a PATH-poisoning follow-up; fix the `node_modules`-absent bootstrap,
now 4 consecutive nights blocked from the real `vitest` suite).
