# Receipts scope — adjudicated 2026-09-12

Three proposals for extending the receipts engine were raised and **two were
refuted by measurement**. Recorded here so they are not re-proposed; each was
plausible enough that it will be suggested again.

## 1. "Add more repos to `GITHUB_REPOS`" — EXHAUSTED, nothing to add

Every public repo with activity in the 90-day window is already tracked. The
untracked public repos are all outside it:

| repo                         | last push  | in window (since 2026-06-14)? |
| ---------------------------- | ---------- | ----------------------------- |
| `azure-ai-foundry-jumpstart` | 2025-05-17 | no                            |
| `bv-mattermost`              | 2026-05-17 | no                            |
| `bv-vibesdk`                 | 2026-03-30 | no                            |
| `the-augster`                | 2026-03-30 | no                            |

Adding them yields **zero** additional commits and spends GitHub API calls
against the anonymous ceiling.

## 2. "Add the private repos" — reverses a spec decision, and would break the method

The design spec already settled this: _"All substantive BlackVeil repos are
private, so receipts are scoped to the public ones. A number you cannot check
is a claim, not a receipt."_

The gap it leaves is real and large — measured via local `git log` over the same
90-day window, cross-checked against the live `/api/receipts` (which matched the
public figures exactly, 574/323):

|                            | commits | agent-authored | share |
| -------------------------- | ------- | -------------- | ----- |
| Published (4 public repos) | 574     | 323            | 56.3% |
| Fleet incl. private        | ~6,667  | ~4,064         | ~61%  |

`bv-web-prod` alone is 5,465/3,412. The site therefore publishes **~8.6%** of the
fleet's real volume. That is the cost of the decision, and the decision still
holds: the front page promises every figure links to a commit a stranger can
open, and a private commit cannot. Feeding private repos in as aggregate-only
counts would keep the totals honest but break that promise for the ledger.

If the internal number is ever wanted, run `aggregate()` locally over all repos —
it is a pure function over `RepoInput[]`. Publishing it externally is a separate,
operator-gated decision (public-surface freeze).

**Related trap:** `MAX_PAGES = 10` in `src/receipts.ts` caps a repo at 1,000
commits per refresh, silently. Already filed as backlog D5 — but note it would
bite immediately and invisibly if a high-volume repo were ever added.

## 3. "Make the trailer a CI gate" — REFUTED, it would destroy the metric

Measured over this repo's and bv-mcp's history: **109 of 230** human-authored
commits in bv-mcp's last 250 correctly carry no trailer, because no agent
co-authored them. A gate requiring the trailer would drive the published share
toward 100% and convert it from a measurement into a compliance counter.

What shipped instead is an **advisory well-formedness** check in bv-mcp's
reusable `repo-hygiene.yml`: when a Claude trailer is present it must parse under
`parseAgentTrailers`' exact regex; absence is never reported. 0 malformed across
625 trailers in the four tracked repos at adoption. Advisory placement follows
FA-13 (telemetry-derived checks ship fail-soft).

## Also checked: PR review metrics (backlog T4)

The hero claims agents "review each other's pull requests". Sampling the last 8
merged bv-mcp PRs via `/pulls/{n}/reviews` returned `reviews=0` on every one, so
the claim is not merely unmeasured — there is currently nothing to measure, and
it would cost ~421 extra API calls per refresh to keep confirming zero. T4's
"drop the claim" branch is the live option; the "prove it" branch is not.
