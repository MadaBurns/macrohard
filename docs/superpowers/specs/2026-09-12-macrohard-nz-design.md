# macrohard.nz — design spec

**Date:** 2026-09-12 · **Doctrine:** bv-cc @ f9535a8 · **Status:** approved in chat, built same day

## Purpose

A site at macrohard.nz whose real goal is attention from the xAI/Tesla engineering
orbit — the people who forward things to Musk — by _being_ the thing Macrohard
was announced as (a software company operated by AI agents), rather than joking
about it. Founder contact is the tail outcome; an xAI engineer screenshotting it
is the design target.

## Constraints that shaped it

- **"Macrohard" is a live xAI mark** (US application filed 2025-08-01; active
  Tesla/xAI project as of 2026-03-11). Two real parties in frame: Microsoft
  (trade dress) and xAI (the mark).
- **The domain must never read as a squat.** Resolved by offering it to xAI
  free, publicly, with no price and no conditions — which is also the contact
  hook. A demand gets lawyers; a gift gets a reply.
- **No Microsoft trade dress.** Own identity; the parody targets the genre and
  the idea. Legal-risk matrix: 3×3 → 🟡 with these mitigations; would be 🟠+
  with Microsoft's visual identity.
- **Every published number must be reproducible by a stranger.** All
  substantive BlackVeil repos are private, so receipts are scoped to the three
  public ones. A number you cannot check is a claim, not a receipt.
- **Held out of scope on purpose:** a DNS/email-security scoreboard of Musk-orbit
  domains (would name real orgs' posture — 🟠/🔴 tier, and reads as a gotcha),
  and autonomous self-operation on a public prod site (phase 2 at most).

## Concept: "A + C"

An **annual report** (Direction A, chosen from four) for an AI-operated
engineering org, with the shareable toy from the gag-site concept (C) embedded
as Note 2.

- **Note 1 — Work performed.** Live ledger of agent-authored commits; every
  hash links to GitHub.
- **Note 2 — Proposed restructuring.** "Staff your company": describe an org,
  get a costed agent org chart. Permalinks + copy-link.
- **Note 3 — Subsequent events.** The free-domain offer and `hello@macrohard.nz`.
- Footer carries the non-affiliation line.

### Copy decisions

- Hero claims only what `git log` supports: agents write, review, and _open the
  release_; **one human holds the deploy key**. (Original draft said "no human
  approves by hand" — false for this fleet; corrected before build.)
- "Headcount, agent" = distinct `Co-Authored-By: Claude …` identities in the
  window — small, honest, and defined on the Method page. Not a made-up 36.
- "Meetings held: 0" stays; it is not from the API and the Method page says so.

## Architecture

One Cloudflare Worker (`macrohard`), static assets + small API, custom domains
`macrohard.nz` and `www.macrohard.nz` (www → apex 301). No D1, no Durable
Objects — nothing here is relational or coordinated.

```
GET  /api/config        public config (turnstile sitekey, contact, repos)
GET  /api/receipts      KV snapshot; 202 {status:"warming"} when none — never zeros
POST /api/staff         validate → cache → turnstile? → per-IP RL → daily cap → AI → validate+scrub → KV
GET  /api/s/:id         stored generation
GET  /s/:id             index.html (client hydrates from the id)
cron */30               refresh receipts snapshot
```

### Receipts (`src/receipts.ts`)

- Sources: `/repos/{o}/{r}/commits?since=` and `/pulls?state=closed` for
  `MadaBurns/{bv-mcp, blackveil-dns-action, bv-claude-dns}`, 90-day window,
  paginated via `Link: rel="next"`, PR pagination stops once a page predates the window.
- Rule: agent-authored ⇔ message has a `Co-Authored-By: Claude …` trailer
  (case-insensitive, line-anchored). Measured 2026-09-12: 305 of 555 commits in
  bv-mcp over 90d.
- Figures: agent commits, PRs merged, median PR open→merge (hours), distinct
  agent identities, share of commits, 8-row ledger newest-first.
- Failure posture: a refresh that counts zero commits never overwrites a real
  snapshot; a failed refresh leaves the previous one; the API flags `stale`.
- Unauthenticated GitHub: ~20 calls/refresh × 2/hr fits the 60/hr anonymous
  ceiling. `GITHUB_TOKEN` secret is optional and lifts it.

### Generator (`src/staff.ts`)

- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON-schema response
  format, 700 max tokens. System prompt forbids real people, real companies,
  URLs, and any named product.
- Output validated with zod (3–7 roles, bounded numbers, bounded strings) and
  scrubbed of anything link- or email-shaped before storage or display.
- Input: ≥3 chars, ≤200, no URLs, no `@`.
- Moderation (added after the post-commit security pass): Llama Guard 3
  (`@cf/meta/llama-guard-3-8b`, ~9 neurons/call) on the query before
  generation — unsafe → 400 and nothing stored — and on the generated org
  after — unsafe → canned fallback. A guard outage reads as "unknown" and
  passes, so it cannot take the toy down. When the daily cap is spent the
  visitor's text is not stored, so nothing unmoderated can reach a permalink.
- Fallback: five canned orgs keyed by keyword; served when the model fails or
  the cap trips; response carries `mode:"fallback"` and the UI says so. Fallbacks
  are not cached, so the next attempt tries the model again.

### Spend and abuse (`src/limits.ts` + bindings)

1. Per-query KV cache (30d) — repeats are free and skip every limiter.
2. Per-IP rate limit binding, 6/min.
3. Global daily cap in KV (`STAFF_DAILY_CAP`, default 400; `0` = kill switch).
   At ~$0.002/generation the ceiling is under a dollar a day.
4. Turnstile, optional: enforced only when `TURNSTILE_SECRET` is set; the
   client renders the widget only when `/api/config` returns a sitekey.

### Front end (`public/`)

No framework, no build. Two fetches and one form. Receipts render with a
warming state and poll while the first snapshot is built. All model output is
rendered via `textContent`. `_headers` sets a CSP (self + Google Fonts +
Turnstile), nosniff, referrer policy, `frame-ancestors 'none'`.

### Tests

Vitest in `@cloudflare/vitest-pool-workers`, hermetic: `fetchMock` with
`disableNetConnect`, fakes injected for GitHub and the AI binding. 41 tests:
trailer rule, aggregation from fixtures, pagination, stale/zero posture, schema
and scrub, fallback selection, JSON extraction, cap/ids/turnstile, and the routes
(warming 202, stale flag, input rejection, cache hit, permalink 404/hit, www
redirect, JSON 404s).

### Sharing (added 2026-09-12, second pass)

- `/s/:id` is server-personalised with HTMLRewriter: title, description,
  `og:*`, canonical — a shared chart renders as its own card.
- `/og/:id.png` is rendered once by Browser Rendering (`BROWSER` binding,
  puppeteer, 1200×630 from `ogCardHtml`) and cached in KV for the permalink's
  lifetime; pre-rendered in `waitUntil` at generation time so the response
  never waits. Any failure — quota, plan, timeout — 302s to the generic card.
- Every result carries pre-written share text (`shareText`) and the page
  offers "Post on X" (intent link; nothing auto-posts) and "Copy link".
- `/api/stats` exposes an "organisations restructured" KV counter.
- The `macrohard` repo is in the receipts list: the site counts itself.

## Not built (deliberately)

- Mobile-specific artboard — the CSS is responsive; no separate design.
- Any sale mechanism for the domain. There will not be one.
- Anything that posts on the operator's behalf, and anything astroturfed.
