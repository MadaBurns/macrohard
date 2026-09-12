# macrohard.nz

**The software company that runs itself.** An annual report for an engineering
organisation operated by AI agents — with receipts. Every figure on the front
page is computed from the public GitHub API and links to the commit that proves
it. The method is on the site: <https://macrohard.nz/method>.

Independent parody and commentary. Not affiliated with Microsoft, xAI or Tesla.
The domain is xAI's for the asking — free, no conditions. `hello@macrohard.nz`.

## What's here

One Cloudflare Worker, static assets plus a small API.

```
public/            the site (no framework, no build step)
src/index.ts       routes + cron
src/receipts.ts    GitHub → figures. The tests are the spec for every number on the page.
src/staff.ts       "Staff your company": Workers AI, strict schema, scrubbed output, canned fallback
src/limits.ts      daily spend cap, per-query cache, permalink ids, optional Turnstile
test/              hermetic — no network, no remote bindings
```

### The rule for "agent-authored"

A commit counts when its message carries a `Co-Authored-By: Claude …` trailer.
Nothing is inferred from author names. See `parseAgentTrailers` in
`src/receipts.ts` and its tests.

### Spend controls on the generator

1. Per-query result cache in KV (repeat prompts are free).
2. Per-IP rate limit (6/min) via a Workers rate-limit binding.
3. Global daily cap (`STAFF_DAILY_CAP`, default 400). Past it, a canned org is
   served and labelled as such. Set it to `0` to switch the model off entirely.
4. Optional Turnstile: set `TURNSTILE_SITE_KEY` (var) and `TURNSTILE_SECRET`
   (secret) and the form starts requiring a token.
5. Llama Guard 3 on the query before generation (unsafe → 400, nothing
   stored) and on the generated org after it (unsafe → canned fallback).
   When the daily cap is spent, the visitor's text is not stored at all.
   Nothing reaches a public permalink unmoderated.

### Optional secrets

- `GITHUB_TOKEN` — a read-only fine-grained token lifts the anonymous 60/hr
  ceiling on the receipts refresh. Not required; the cron is sized to fit
  without it and stale-serves on failure.
- `TURNSTILE_SECRET` — see above.

## Running it

```bash
npm ci
npm test            # vitest, inside the Workers runtime, hermetic
npm run typecheck
npm run dev         # wrangler dev — note Workers AI always runs remotely and bills
npm run deploy      # operator-run; custom domains + cron are in wrangler.jsonc
```

## Licence

MIT.
