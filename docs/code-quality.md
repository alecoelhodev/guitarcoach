# Code quality

Static analysis runs in two places against the same rule family: locally in
`npm run lint` (and therefore at pre-commit), and in CI as a full SonarQube
Cloud analysis with test coverage attached.

## What runs where

| | Local (`npm run lint`) | CI (`code-quality` workflow) |
| --- | --- | --- |
| Engine | `eslint-plugin-sonarjs` | SonarQube Cloud |
| Scope | files you changed, on demand | whole project, every PR and push to `main` |
| Coverage | no | yes, from `coverage/lcov.info` |
| Duplication / complexity trend | no | yes |
| Blocks the build | yes — SonarJS rules are `error` | no, deliberately (see [Quality gate](#quality-gate)) |

The ESLint plugin is not a replacement for the cloud analysis; it is the fast
half of it. SonarJS ships ~174 recommended rules covering bug patterns, dead
code and cognitive complexity, and running them locally means you see most of
what Sonar will say before you push. What it cannot do is measure coverage,
detect duplicated blocks across files, or track any of it over time.

## One-time setup

Only the token is manual; everything else is committed.

1. Sign in to [SonarQube Cloud](https://www.sonarsource.com/products/sonarcloud/)
   with GitHub and create an organization bound to your GitHub account. Pick the
   **OSS plan** — free, and unlike the "Free" plan it covers unlimited branch
   and pull-request analysis rather than `main` only. It is limited to public
   repositories, which this one is.
2. Import `guitarcoach` as a project. Its **project key** and **organization
   key** — `alecoelhodev_guitarcoach` and `alecoelhodev` — are already in
   `sonar-project.properties`. Re-importing under a different organization would
   change them, and the scan then fails with "project not found".
3. Turn **Automatic Analysis off**: *Administration → Analysis Method*.
   Automatic Analysis cannot ingest test coverage, and leaving it on alongside
   CI-based analysis makes the scan fail. This is the most common first-run
   failure.
4. Generate a token under *My Account → Security* and add it to the repo:

   ```bash
   gh secret set SONAR_TOKEN
   ```

   On the OSS and Free plans this is a personal access token — scoped
   organization tokens start at the Team plan — so it is tied to your account
   and yours to rotate.

## Coverage

`npm run test:cov` writes `coverage/lcov.info`, which the CI workflow produces
immediately before the scan. Two constraints keep that report readable by
Sonar, both easy to break:

- The paths inside the report are relative to the **current working
  directory**, so the test step must run from the repo root. Adding a
  `working-directory:` to it would silently prefix every path wrong and show the
  whole project as 0% covered.
- The file set in the report must match `sonar.sources`. Any source file Sonar
  indexes but the report omits is counted as 0% covered, so `collectCoverageFrom`
  in `package.json` and `sonar.exclusions` in `sonar-project.properties` exclude
  the same things: generated Prisma client, and spec files.

The reporter is `lcovonly` rather than `lcov`, which skips generating a
`coverage/lcov-report/` HTML tree nobody reads in CI. For a browsable local
report when you actually want one:

```bash
npx jest --coverage --coverageReporters=html && open coverage/lcov-report/index.html
```

## Quality gate

The gate is **report-only**. `sonar.qualitygate.wait` is commented out in
`sonar-project.properties`, so the scanner uploads results and exits 0 — a
failing gate never turns the workflow red. Uncomment that line to make it
blocking once the numbers have settled.

Note that this controls the *workflow*. The SonarQube Cloud GitHub App posts
its own `SonarQube Cloud Code Analysis` check on the PR, which can show red
independently of the workflow's own status. If you want the PR to be able to
merge regardless, make sure that check is not in the branch-protection required
list.

Sonar measures the gate against **new code** — lines changed since the
baseline — not the whole project, so an existing 76% line coverage does not
have to be fixed before the gate can be useful.

## Handling a finding

In order of preference:

1. **Fix it.** Most SonarJS findings are small and real.
2. **Scope the rule off where it does not apply**, with a one-line reason, in
   `eslint.config.mjs`. The config already has a test-file block doing this for
   eight rules that only ever fire on test code here — `assertions-in-tests`, for
   instance, does not recognise supertest's own `.expect(200)` as an assertion
   and flagged all 73 e2e request tests.
3. **Turn the rule off globally**, with a reason. Only
   `sonarjs/different-types-comparison` is off this way: it cannot distinguish
   `T | null` from `T | undefined` and reported both of its findings here as
   guaranteed-false comparisons that TypeScript itself accepts.

On the Sonar side, an issue can be marked *Won't Fix* or *False Positive* in the
UI, which persists across analyses. `// NOSONAR` on a line suppresses it too,
but it is blunt — it silences every rule on that line and leaves no reason
behind, so prefer the UI or a scoped ESLint rule.

Do **not** blanket-downgrade the SonarJS plugin to `warn`. `npm run lint` has no
`--max-warnings`, so a warning there is indistinguishable from deleting the
rule.

## Fork and Dependabot pull requests

The workflow skips itself on PRs from forks and on Dependabot PRs. GitHub
withholds repository secrets from both, and the scan action has no soft-fail
mode, so without the guard they would fail hard on a missing `SONAR_TOKEN`.

Those PRs get no Sonar check; the analysis lands on the post-merge `main` run
instead. Sonar's documented alternative is a `workflow_run` pattern that checks
out the fork's code inside a job holding the token — a secret-exfiltration risk
their own docs call sensitive, and not worth it here.
