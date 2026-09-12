# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

macrohard.nz — a single Cloudflare Worker serving a static site plus a small API.
`README.md` is the reader-facing version of this; `docs/superpowers/specs/2026-09-12-macrohard-nz-design.md`
records why each piece is shaped the way it is, and `docs/superpowers/2026-09-12-improvement-backlog.md`
is the ranked list of known gaps (read it before proposing "improvements" — most are already triaged there).

## Commands

```bash
npm ci
npm test                         # vitest inside the Workers runtime (vitest-pool-workers), hermetic
npx vitest run test/receipts.spec.ts          # one file
npx vitest run -t 'trailer'                   # one test by name
npm run typecheck                # tsc --noEmit
npm run format / format:check    # prettier (tabs, single quotes, printWidth 140)
npm run types                    # regenerate worker-configuration.d.ts from wrangler.jsonc (gitignored)
npm run dev                      # wrangler dev — Workers AI always runs REMOTELY and bills
npm run deploy                   # operator-run only
scripts/e2e.sh                   # live smoke; BASE=http://127.0.0.1:8787 to point it local. Costs model calls.
scripts/watch.sh [--tail 30] [--loop]   # read-only launch monitor: receipts freshness, KV spend counters
```

`.github/workflows/ci.yml` runs that same chain on every PR and push to `main`; it holds no
secrets and has no deploy step, because deploy stays operator-run. `repo-hygiene.yml` is a thin
consumer of bv-mcp's shared reusable workflow. `typecheck` is preceded by `npm run types`
(`pretypecheck`) so it works on a clean clone, and `predeploy` re-runs typecheck + tests so
`npm run deploy` refuses when red.

## Architecture

One Worker (`src/index.ts`, Hono). `wrangler.jsonc` `assets.run_worker_first` lists the only
paths that invoke it (`/`, `/method`, `/api/*`, `/s/*`, `/og/*`); everything else is served as a
free static asset. **Adding a Worker-handled route means adding it to that list** — otherwise the
handler never runs. Unmatched paths still reach the catch-all so the 404 page keeps its 404 status.

Four modules, each programming against the narrow hand-written `AppEnv` in `src/env.ts` (not the
generated `Env`) so tests can inject fakes:

- **`receipts.ts`** — GitHub REST → the figures on the front page. Refreshed by a `*/30` cron and
  opportunistically by `/api/receipts` via `waitUntil`; cached in KV under `receipts:latest`.
  The agent-authored rule is mechanical and load-bearing: a `Co-Authored-By: Claude …` trailer
  (`parseAgentTrailers`). Never infer it from author names or commit style — the method page
  publishes this rule and the tests are its spec.
  Two deliberate fail-safes: a snapshot counting 0 commits keeps the previous one rather than
  publishing a false zero, and `GITHUB_TOKEN` is an optimisation only — a 401 disables it for the
  rest of the refresh and falls back to anonymous.
- **`staff.ts`** — the generator. Workers AI → strict Zod `OrgSchema` → `scrub()` (strips anything
  link- or email-shaped) → Llama Guard 3 on the query _and_ on the generated org. `BLOCKED_CATEGORIES`
  is a deliberate subset (S7 fires on any long digit run; S2/S6/S8/S13/S14 aren't the vector here).
  A guard _outage_ returns `unknown`, which callers treat as pass.
- **`limits.ts`** — `consumeDailyCap` (KV counter, UTC day, best-effort and may overshoot slightly),
  `newId`/`ID_RE` (permalink ids), `sha256Hex`, optional Turnstile.
- **`og.ts`** — per-permalink share card HTML → PNG via Browser Rendering, cached in KV.

**Spend is the design constraint.** Every expensive path is bounded and every bound degrades to
something serveable, never to an error: per-query KV cache → per-IP rate-limit binding → global
daily cap (`STAFF_DAILY_CAP`; past it a canned org is served _and labelled_, and the visitor's
text is not stored at all) → guard. OG renders have their own `OG_DAILY_CAP` plus a per-id lock
(held, not released, so a failed render throttles retries). The reasoning behind each number is in
the `wrangler.jsonc` comments — update those comments when you change a cap.

Nothing unmoderated may reach a public permalink. Only real generations (`mode === 'ai'`) are
cached and counted; fallbacks get another go next time.

Front end is `public/` — no framework, no build step. Permalinks (`/s/:id`) serve the front page
with its meta tags rewritten by `HTMLRewriter` (`personalise`); the client reads the id from the path.

## Tests

`test/` is hermetic by contract: no network, no remote bindings. Anything leaving the sandbox is
either `fetchMock`ed or reached through an injected fake (`AiLike`, `RateLimiterLike`, `Fetcher`).
Keep it that way — a test that needs a real binding belongs in `scripts/e2e.sh` instead.
`test/fixtures/github-*.json` back the receipts tests.

## Gotchas

- `.claude/worktrees/` holds a full second checkout. Grep/glob from the repo root will match it —
  scope searches to `src/`, `test/`, `public/`.
- `STAFF_RL` is optional in `AppEnv` because the test pool's wrangler doesn't provide the binding;
  the daily cap is what holds there. `BROWSER` is optional for the same reason.
- The per-IP rate limit is per-location and approximate. It is not a spend bound; the daily cap is.
