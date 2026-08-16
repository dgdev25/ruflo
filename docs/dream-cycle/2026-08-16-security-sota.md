# Security SOTA Report — 2026-08-16

TL;DR: In 2026, agentic coding tools keep shipping the same allowlist-bypass bug
class — OpenClaw's exec-allowlist pattern overmatch (CVE-2026-32973, CVSS 9.8)
and Cursor's terminal-allowlist bypass (CVE-2026-22708) both landed this year.
Ruflo's own `SafeExecutor` (`@claude-flow/security`) — the documented
command-injection remediation primitive — has the same shape of gap:
`validateCommand()`/`isCommandAllowed()` authorize any command string whose
`path.basename()` matches an allowlisted name, so `/tmp/attacker/git` passes
the same check as `git`. Fixed tonight, with a real end-to-end
proof-of-exploit (spoofed binary actually executes on baseline, blocked on
candidate) and a disclosed, deliberate compatibility trade-off.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| OpenClaw exec-allowlist bypass via `?` wildcard crossing path segments + case-folding overmatch, CVSS 9.8 | [VulnCheck advisory](https://www.vulncheck.com/advisories/openclaw-exec-allowlist-pattern-overmatch-via-posix-path-normalization), [GHSA-f8r2-vg7x-gh8m](https://github.com/openclaw/openclaw/security/advisories/GHSA-f8r2-vg7x-gh8m) | A (official GH Security Advisory, cross-checked vs VulnCheck/NVD) |
| Cursor terminal-allowlist bypass via environment-variable poisoning of trusted commands, CVE-2026-22708 | [GHSA-82wg-qcm4-fp2w](https://github.com/cursor/cursor/security/advisories/GHSA-82wg-qcm4-fp2w) | A (official GH Security Advisory) |
| OWASP Top 10 for Agentic Applications 2026: Tool Misuse (ASI02) — 64% of findings in agentic-AI projects involve tool functions accepting unvalidated LLM input | [OWASP Agentic AI 2026 coverage](https://www.indusface.com/learning/owasp-top-10-agentic-ai/) | B (secondary summary of OWASP material; not the primary OWASP document itself) |
| OpenAI Agents SDK's April 2026 overhaul added native sandboxing + Codex-style filesystem tools as a first-class feature, not a bolt-on | [Uvik framework comparison](https://uvik.net/blog/agentic-ai-frameworks/) | C (single vendor-comparison source, not cross-checked against OpenAI's own docs tonight) |

## Ruflo Current Capability (pre-patch)

`SafeExecutor` (`v3/@claude-flow/security/src/safe-executor.ts`) replaces
shell-interpreted `exec()` with `execFile(..., { shell: false })` plus an
allowlist — real, load-bearing hardening against classic shell-metacharacter
injection (`;`, `` ` ``, `$()`, etc. — all still correctly blocked, confirmed
tonight, see Evaluation). But `validateCommand()` and its public twin
`isCommandAllowed()` authorize a command by `path.basename()` equality alone:

```ts
const isAllowed = this.config.allowedCommands.some(allowed => {
  const allowedBasename = path.basename(allowed);
  return command === allowed || basename === allowedBasename;
});
```

`allowedCommands: ['git']` and `command: '/tmp/attacker-controlled/git'` pass
this check — `path.basename('/tmp/attacker-controlled/git') === 'git'` — and
get handed to `execFile()` as-is. This is a real, currently-shipping,
production-used primitive: `v3/@claude-flow/cli/src/proxy/install.ts` and
`release.ts` construct `SafeExecutor` instances for `tar`/`powershell`/`gh`
extraction of downloaded release archives.

## Competitor Comparison

| Tool | Allowlist bypass class found in 2026 | Fix direction |
|---|---|---|
| OpenClaw (`openclaw/openclaw`) | Glob/case-fold overmatch crossing path segments (CVE-2026-32973) | Regression tests added for case-folding + slash-crossing (v2026.3.11) |
| Cursor | Env-var poisoning of trusted-command behavior bypasses allowlist without appearing in it (CVE-2026-22708) | Stricter terminal-command parsing of edge cases (v2.3) |
| LangGraph / AutoGen / CrewAI / OpenAI Agents SDK | No allowlist-bypass CVE surfaced in this pass; OpenAI Agents SDK shipped native sandboxing in April 2026 | Sandboxing over allowlisting where available (different mitigation strategy, not directly comparable) |
| Ruflo `@claude-flow/security.SafeExecutor` (pre-patch) | Basename-only matching authorizes any path sharing an allowlisted basename | — |
| Ruflo `@claude-flow/security.SafeExecutor` (tonight) | Path-like commands must match an allowlist entry exactly; bare-name basename leniency preserved | Fixed tonight |

*(Ruflo's flaw is a different specific mechanism than OpenClaw's or Cursor's —
no shared codebase — but the same bug **class**: an allowlist's match logic is
looser than the string actually handed to the executor.)*

## Hypothesis (frozen before evaluation)

Given `SafeExecutor.execute()`/`executeStreaming()` invocations where the
`command` argument is a filesystem path (contains a directory separator)
rather than a bare name, when `validateCommand()`'s match rule changes from
"basename equality, unconditionally" to "basename equality only for bare
names; path-like commands must match an allowlist entry exactly," then the
allowlist's decision-boundary attack success rate (ASR) on basename-collision
inputs should fall from 100% to 0% relative to baseline, subject to:
- **quality invariant**: 0% regression on bare-name allowlisted usage (`git`,
  `npm`, `tar`, `powershell`, ...) and on explicit exact-path allowlist entries
- **safety invariant**: existing argument-injection blocking (shell
  metacharacters, null bytes, sudo-blocking) unaffected
- **regression threshold**: 0 changes to the repo's own existing
  `safe-executor.test.ts` assertions

## Evaluation

Real, dependency-free, git-reproducible (`node --experimental-transform-types`
— this checkout still has no `node_modules` anywhere, root/`v3`/
`v3/@claude-flow/cli`, reconfirmed tonight, 4th consecutive Dream Cycle to hit
this; `--experimental-strip-types` alone fails on this file's TS constructor
parameter properties, `--experimental-transform-types` handles them).

| Metric | Baseline | Candidate |
|---|---|---|
| Decision-boundary ASR (5-case basename-collision corpus) | 100% (5/5) | **0% (0/5)** |
| Legitimate bare-name usage pass rate (4 cases) | 100% | 100% (unchanged) |
| Exact-path-allowlist-entry pass rate (1 case) | 100% | 100% (unchanged) |
| End-to-end proof-of-exploit (real spawned sentinel binary at spoofed path) | **executes** | **blocked** (`COMMAND_NOT_ALLOWED`, never spawned) |
| Repo's own test-assertions replicated manually (12 checks, argument injection / sudo / factories / allowlist mgmt) | — | **12/12 pass** |

One **deliberate, disclosed behavior change** found during adversarial review:
a caller resolving a bare-allowlisted command to its absolute path before
calling `execute()` (e.g. `execute(which('git'), args)` with
`allowedCommands: ['git']`) now gets rejected, where baseline allowed it. This
is not a defect — allowing "absolute path whose basename matches an
allowlisted bare name" **is** the vulnerability; the fix cannot tell a
legitimately-resolved path from an attacker-crafted one by basename alone. No
in-repo caller does this today (confirmed by grep across `v3/`).

Full receipts: `bench-safe-executor-allowlist-bypass.mjs` /
`receipt-2026-08-16.json`, `regression-check.mjs` /
`regression-receipt-2026-08-16.json`.

## Darwin Results

1 generation, 3 real (independently executed, not simulated) variants against
a frozen fitness function (`0.45·safety + 0.35·quality + 0.20·reviewability`):

| Variant | Safety | Quality | Fitness | Verdict |
|---|---|---|---|---|
| **A — exact-match-for-path-like (shipped)** | 1.00 | 1.00 | **1.00** | **accepted** |
| B — always-exact-match, no basename leniency at all | 1.00 | 1.00 | 0.98 | rejected — zero marginal safety over A, removes a documented convenience with no in-repo dependent either way |
| D — reject all path-like commands outright | 1.00 | 0.50 | 0.795 | rejected — breaks the legitimate exact-path-allowlist-entry pattern for no safety gain over A |

Full lineage: `darwin-lineage-2026-08-16.json`.

## SOTA Proof & Witness

Full evidence trail in `docs/dream-cycle/evidence/2026-08-16-security/`.

- Session commit: `fca26153048a87511d1e9a22b269bcbc615ac129`
- Report SHA256 (pre-stamp body): `3df74c57ec9aff3c34a1a30e1e69358c36a51560f4f7619a1760c50f1891ceb7`
- Witness stamp: `3fd654ced58d0fddfbcdcdf122bd8bf294216d5792b6da9366f1a813d4b68353`
- Evaluation receipt / regression receipt / Darwin lineage / adversarial
  critique / Flywheel gate+verify record: all in the evidence directory above

**Verifier procedure:** Report SHA256 was computed over this file with this
section still reading its pre-stamp placeholders — an external verifier
cannot re-derive that exact byte sequence from the published copy alone.
Witness stamp = SHA256(Report SHA256 + session commit). The authoritative
reproduction path is the checked-in evidence trail, independently re-runnable
via:
`node --experimental-transform-types docs/dream-cycle/evidence/2026-08-16-security/bench-safe-executor-allowlist-bypass.mjs`,
`regression-check.mjs`, and `darwin-explore.mjs` in the same directory — all
dependency-free. **Caveat, disclosed rather than hidden:** `npx ruvector
harness flywheel verify` (the tool's cryptographic-replay-bundle check) was
attempted and errored — it expects a signed `{chain: Receipt[]}` bundle from
a metaharness-scaffolded harness with a receipt-signing pipeline, which this
application repo doesn't have wired up for arbitrary source patches (true for
all 4 Dream Cycles to date, not just tonight's). `npx ruvector harness
flywheel gate` (the promotion-rule advisory, a different tool) DID run for
real: `{"promote": true, "reasons": []}` — see `flywheel-gate-evidence.json` /
`flywheel-gate-output.json`.

## Recommended Next Steps

1. **Human review and merge tonight's PR.** Small (2 methods, ~30 changed
   lines, 1 file), fully covered by real dependency-free evaluation with a
   real end-to-end proof-of-exploit, zero regressions on tested legitimate
   usage. A CVSS-9.8-class bug pattern (OpenClaw CVE-2026-32973) in a
   documented, reusable security primitive is worth prioritizing over the
   usual review queue.
2. **Extend the SafeExecutor allowlist model with binary-hash pinning for
   high-value call sites** (`proxy/install.ts`, `proxy/release.ts`): even
   after tonight's fix, a bare-name allowlist entry (`'tar'`, `'gh'`) still
   trusts whatever binary `$PATH` resolves to. Tonight's fix closes the
   *path-argument* bypass; it does not address PATH-poisoning, which is a
   different (environment/supply-chain) threat model — flagged, not silently
   left uncovered, in `adversarial-critique.md`.
3. **Fix `npm install`/`pnpm install` bootstrap for this checkout.** 4th
   consecutive Dream Cycle (2026-08-13 through tonight) blocked from the real
   `vitest` suite by a `node_modules`-absent workspace at root, `v3/`, and
   `v3/@claude-flow/cli/`. Tonight's manual 12-assertion regression pass is a
   real but strictly weaker substitute than the actual suite — a human with
   `npm install` should still run it before merge.
