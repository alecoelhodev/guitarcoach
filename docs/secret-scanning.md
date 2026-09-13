# Secret scanning

Every commit is scanned for leaked credentials before it is created, and every PR and push to `main` is scanned again over the full git history in CI.

The scanner is [Betterleaks](https://github.com/betterleaks/betterleaks) — MIT-licensed, no account, no license key, no SaaS. It is a single Go binary that pattern-matches a diff, so the pre-commit scan costs ~0.1s.

## What runs where

| Where | Command | Scope |
| :--- | :--- | :--- |
| `.husky/pre-commit` | `betterleaks git . --pre-commit --staged --redact --no-banner -v` | Staged changes only |
| `.github/workflows/security.yml` | `betterleaks git . --redact --baseline-path .betterleaks-baseline.json` | Full history, every PR + push to `main` |
| `npm run secrets:scan` | same as CI | Full history, locally |

Both use the same pinned binary, the same `.betterleaks.toml` and the same baseline, so a commit cannot pass locally and fail in CI.

`--redact` is not optional. It keeps the matched value out of terminal scrollback, hook output and CI logs — the finding tells you the rule, file and line, which is all you need to fix it.

## Installation (automatic)

`scripts/install-betterleaks.mjs` downloads the version-pinned binary to `.tooling/bin/`, verifies its SHA-256 against the release `checksums.txt`, and is wired into the `prepare` npm script. **A fresh clone needs nothing beyond `npm install`.**

The script is dependency-free on purpose — adding an npm package here would pull the lockfile back into the macOS/Alpine `npm ci` hazard described in `CLAUDE.md`. It no-ops when the correct version is already present, when there is no `.git` directory (Docker build stages), and under `CI` unless `BETTERLEAKS_FORCE_INSTALL=1` is set (which only `security.yml` does).

To upgrade, bump `VERSION` in that script and run `npm run secrets:baseline` if the new version's rules surface different pre-existing findings.

## When the hook blocks a commit

The hook **fails closed**: if the binary is missing it blocks rather than skipping, because a silently skipped scan is worse than a noisy one. Run `node scripts/install-betterleaks.mjs` (or just `npm install`).

When a secret is found, in order of preference:

1. **It is a real secret** — remove it and load it from `.env` or Secret Manager instead. If it was ever pushed, rotate it; deleting the line does not un-leak it.
2. **It is a one-off false positive** — add a `betterleaks:allow` comment on that line.
3. **It is a whole class of false positives** — add a narrow path filter in `.betterleaks.toml`.

### Emergency bypass

```bash
BETTERLEAKS_SKIP=1 git commit ...
```

Use `BETTERLEAKS_SKIP`, not `--no-verify`: it is greppable, it prints a warning, and it leaves the lockfile check in place. CI still scans the commit, so this defers the problem rather than avoiding it.

## `.betterleaks.toml`

Scans run at full (default `low`) sensitivity. `--confidence medium` was measured to cut history noise from 50 findings to 5 with no config at all, but it also **misses** `BETTER_AUTH_SECRET`- and `POSTGRES_PASSWORD`-shaped generic secrets — precisely this project's risk profile — so it is not used.

Two rules (`generic-password`, `generic-credential-uri`) carry a path filter. Each override supplies `id` + `filter` and **no `regex`**, so the built-in detection pattern is inherited intact.

Two gotchas worth knowing before editing it:

- **A top-level `prefilter`/`filter` is silently discarded.** With `[extend] useDefault = true` the default config's own values replace them. Such a filter looks correct and does nothing. Use per-rule filters.
- **The baseline file must stay filtered.** It is scanner output, and a redacted `postgres://user:REDACTED@host` still has the shape of a credential URI, so the baseline would flag itself. It cannot be sanitized instead: betterleaks matches a baseline entry on much more than its fingerprint, and stripping those fields stops it suppressing anything at all.

Filter scope is kept deliberately narrow — prose docs, `*.example` templates, unit-test fixtures, vendored `.agents/` docs, and Prisma's generated client. Application code, k6 scripts and GitHub workflows are **not** filtered: a real credential committed there must still fail.

## `.betterleaks-baseline.json`

Pins the findings already present in git history so CI fails only on *new* ones. It currently holds 10 entries, all verified non-secrets: CI placeholder connection strings, Secret Manager reference names, k6 env-var reads, and the credential-detection regex in `src/observability/redaction.util.ts`.

Fingerprints are `commit:file:rule:line`, so a new commit produces a new fingerprint and is still flagged — the baseline suppresses only what already exists.

It is safe to commit: generated with `--redact`, so every value in it is the literal `REDACTED`.

Regenerate with `npm run secrets:baseline`, and **read the diff** — a new entry means a new finding is being permanently ignored. Prefer fixing or filtering over baselining.

## GitHub push protection

A server-side backstop for anything that bypasses both the hook and CI, free on this public repo.

**Already enabled** — public repositories get secret scanning and push protection on by default, verified with the command below. Nothing to do; the commands are kept for reference and for re-enabling if it is ever turned off:

```bash
gh api -X PATCH repos/alecoelhodev/guitarcoach \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

Or: **Settings → Code security and analysis → Secret scanning / Push protection → Enable**.

Verify with:

```bash
gh api repos/alecoelhodev/guitarcoach --jq '.security_and_analysis'
```

CI additionally uploads a SARIF report, so findings appear in the repository's **Security** tab rather than only in workflow logs.

Two related GitHub settings are **off** and were left alone, as they are outside this change: `secret_scanning_non_provider_patterns` (generic/non-provider patterns — overlaps with what Betterleaks already covers locally and in CI) and `dependabot_security_updates` (dependency CVEs, a different problem from leaked credentials).

## Why Betterleaks

See [Architecture decisions](architecture-decisions.md) for the comparison against Gitleaks, TruffleHog and Aikido.
