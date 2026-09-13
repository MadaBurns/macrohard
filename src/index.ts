import { Hono } from 'hono';
import type { AppEnv } from './env';
import { getReceipts, isStale, refreshReceipts, type Receipts } from './receipts';
import { FALLBACK_ORGS, cacheKeyText, proposeOrg, validateQuery, type Org } from './staff';
import {
	GUARD_OUTAGE_KEY,
	GUARD_OUTAGE_TTL,
	ID_RE,
	REFRESH_LOCK_KEY,
	REFRESH_LOCK_TTL,
	TURNSTILE_ACTION,
	consumeDailyCap,
	newId,
	parseHostnames,
	readDailyCap,
	sha256Hex,
	verifyTurnstile,
} from './limits';
import { ogCardHtml, renderOgPng, shareDescription, shareText, shareTitle } from './og';

type Bindings = AppEnv;

const app = new Hono<{ Bindings: Bindings }>();

const RECEIPTS_MAX_AGE_MS = 45 * 60_000;
// A share image can expire: it re-renders from the stored org on a miss, bounded
// by the per-id lock and the daily render budget. The permalink itself cannot —
// someone posted that link, and a link that 404s is worse than one never shared.
// At ~1 KB a stored org, KV storage was never the constraint here.
const OG_TTL = 365 * 86_400;
const COUNT_KEY = 'count:total';
const ogLockKey = (id: string) => `oglock:${id}`;
// How long /og/:id.png waits for a render another request already started.
// A share link is posted seconds after it is minted, while the pre-render is
// still running; a crawler that arrives inside that window and is handed the
// generic card caches the generic card. A render takes a few seconds, so a
// bounded wait usually returns the real one. KV is eventually consistent, so
// this is best effort, never a guarantee.
const OG_WAIT_POLLS = 5;
const OG_WAIT_INTERVAL_MS = 1000;

export interface StoredOrg {
	id: string;
	query: string;
	org: Org;
	mode: 'ai' | 'fallback';
	createdAt: string;
}

function repoList(env: AppEnv): string[] {
	return env.GITHUB_REPOS.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function refreshOpts(env: AppEnv) {
	return {
		owner: env.GITHUB_OWNER,
		repos: repoList(env),
		windowDays: Number(env.RECEIPTS_WINDOW_DAYS) || 90,
		token: env.GITHUB_TOKEN || undefined,
	};
}

/**
 * Refresh the receipts unless a refresh is already in flight (see
 * REFRESH_LOCK_KEY). Never throws: a failed refresh is logged and the previous
 * snapshot stands, for the cron and the stale-visit path alike.
 */
async function refreshOnce(env: AppEnv, reason: string): Promise<void> {
	if (await env.KV.get(REFRESH_LOCK_KEY)) return;
	await env.KV.put(REFRESH_LOCK_KEY, '1', { expirationTtl: REFRESH_LOCK_TTL });
	try {
		await refreshReceipts(env.KV, refreshOpts(env));
	} catch (err) {
		console.error(`${reason} refresh failed`, String(err));
	}
}

async function bump(kv: KVNamespace, key: string): Promise<void> {
	// Eventually consistent; a counter, not a ledger.
	const n = Number((await kv.get(key)) ?? '0') || 0;
	await kv.put(key, String(n + 1));
}

/**
 * Render + cache the share image for a permalink. Silent on failure: the generic
 * card stands in.
 *
 * Two bounds, because Browser Rendering is the scarcest resource here and a
 * shared link is exactly the thing that arrives as a burst. A per-id lock stops
 * N simultaneous viewers of one link each starting their own render, and a daily
 * budget stops the whole feature from exhausting the account's minutes. Both
 * degrade to the generic card, never to an error.
 */
async function prerenderOg(env: AppEnv, id: string, org: Org): Promise<Uint8Array | null> {
	if (!env.BROWSER) return null;
	const lockKey = ogLockKey(id);
	if (await env.KV.get(lockKey)) return null; // a render for this id is already in flight
	const budget = await consumeDailyCap(env.KV, new Date(), Number(env.OG_DAILY_CAP) || 0, 'ogcap');
	if (!budget.allowed) return null;
	// Held, not released on success: once the PNG is cached no re-render is wanted,
	// and if the render failed this throttles retries instead of hammering.
	await env.KV.put(lockKey, '1', { expirationTtl: 120 });
	try {
		const png = await renderOgPng(env.BROWSER, ogCardHtml(org));
		await env.KV.put(`og:${id}`, png, { expirationTtl: OG_TTL });
		return png;
	} catch (err) {
		console.error('og render failed', id, String(err));
		return null;
	}
}

/** Poll for a PNG that another request is rendering right now. */
async function awaitOgPng(kv: KVNamespace, id: string): Promise<ArrayBuffer | null> {
	for (let i = 0; i < OG_WAIT_POLLS; i++) {
		await new Promise((r) => setTimeout(r, OG_WAIT_INTERVAL_MS));
		const png = await kv.get(`og:${id}`, 'arrayBuffer');
		if (png) return png;
	}
	return null;
}

/** Rewrite the front page's meta tags so a shared permalink is its own card. */
function personalise(res: Response, origin: string, id: string, org: Org): Response {
	const title = shareTitle(org);
	const desc = shareDescription(org);
	const url = `${origin}/s/${id}`;
	const img = `${origin}/og/${id}.png`;
	const content = (v: string) => ({
		element(e: Element) {
			e.setAttribute('content', v);
		},
	});
	return new HTMLRewriter()
		.on('title', {
			element(e) {
				e.setInnerContent(`${title} — Macrohard`);
			},
		})
		.on('meta[property="og:title"]', content(title))
		.on('meta[property="og:description"]', content(desc))
		.on('meta[name="description"]', content(desc))
		.on('meta[property="og:url"]', content(url))
		.on('meta[property="og:image"]', content(img))
		.on('link[rel="canonical"]', {
			element(e) {
				e.setAttribute('href', url);
			},
		})
		.transform(res);
}

// www → apex
app.use('*', async (c, next) => {
	const url = new URL(c.req.url);
	if (url.hostname.startsWith('www.')) {
		url.hostname = url.hostname.slice(4);
		return c.redirect(url.toString(), 301);
	}
	await next();
});

app.get('/api/config', (c) =>
	c.json(
		{
			turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
			turnstileAction: TURNSTILE_ACTION,
			contactEmail: c.env.CONTACT_EMAIL,
			dailyCap: Number(c.env.STAFF_DAILY_CAP) || 0,
			repos: repoList(c.env).map((r) => `https://github.com/${c.env.GITHUB_OWNER}/${r}`),
		},
		200,
		{ 'cache-control': 'public, max-age=300' },
	),
);

/**
 * What the company is doing right now, for the band under the header.
 *
 * Deliberately only the two things the Worker actually knows without being
 * asked to guess: the day's spend against its ceiling, and whether the guard
 * answered last time it was asked. Everything else the band shows — the age of
 * the figures, the next refresh, whether the token still authenticates — rides
 * on /api/receipts, which the page already fetches.
 */
app.get('/api/live', async (c) => {
	const desk = await readDailyCap(c.env.KV, new Date(), Number(c.env.STAFF_DAILY_CAP) || 0);
	const guard = (await c.env.KV.get(GUARD_OUTAGE_KEY)) ? 'degraded' : 'ok';
	return c.json({ desk: { used: desk.used, cap: desk.cap }, guard }, 200, { 'cache-control': 'public, max-age=30' });
});

app.get('/api/stats', async (c) => {
	const restructured = Number((await c.env.KV.get(COUNT_KEY)) ?? '0') || 0;
	return c.json({ restructured }, 200, { 'cache-control': 'public, max-age=30' });
});

app.get('/api/receipts', async (c) => {
	const now = new Date();
	const current = await getReceipts(c.env.KV);
	const needsRefresh = !current || isStale(current, now, RECEIPTS_MAX_AGE_MS);
	// Refresh out-of-band; serve what we have (or "warming") rather than block.
	if (needsRefresh) c.executionCtx.waitUntil(refreshOnce(c.env, 'receipts'));
	if (!current) return c.json({ status: 'warming' as const }, 202);
	const body: Receipts & { status: 'ok'; stale: boolean } = { ...current, status: 'ok', stale: needsRefresh };
	return c.json(body, 200, { 'cache-control': 'public, max-age=60' });
});

app.post('/api/staff', async (c) => {
	let payload: { query?: unknown; turnstile?: unknown } = {};
	try {
		payload = await c.req.json();
	} catch {
		return c.json({ error: 'Send JSON.' }, 400);
	}

	const check = validateQuery(payload.query);
	if (!check.ok) return c.json({ error: check.reason }, 400);
	const query = check.query;
	const ip = c.req.header('cf-connecting-ip') ?? null;

	// Cache first: repeats are free and skip every limiter.
	const cacheKey = `org:${await sha256Hex(cacheKeyText(query))}`;
	const cached = await c.env.KV.get<StoredOrg>(cacheKey, 'json');
	// Only moderated generations are ever cached, so a cache hit is moderated by construction.
	if (cached)
		return c.json({ id: cached.id, org: cached.org, mode: cached.mode, moderated: true, cached: true, share: shareText(cached.org) });

	if (c.env.TURNSTILE_SECRET) {
		const token = typeof payload.turnstile === 'string' ? payload.turnstile : '';
		const ok = await verifyTurnstile({
			secret: c.env.TURNSTILE_SECRET,
			token,
			ip,
			action: TURNSTILE_ACTION,
			hostnames: parseHostnames(c.env.TURNSTILE_HOSTNAMES),
		});
		if (!ok) return c.json({ error: 'Please complete the check.' }, 403);
	}

	// The binding is absent under the test pool's older wrangler; the daily cap still holds there.
	if (c.env.STAFF_RL) {
		const rl = await c.env.STAFF_RL.limit({ key: ip ?? 'anon' });
		if (!rl.success) return c.json({ error: 'Slow down — six a minute is plenty.' }, 429);
	}

	const now = new Date();
	const cap = await consumeDailyCap(c.env.KV, now, Number(c.env.STAFF_DAILY_CAP) || 0);

	let org: Org;
	let mode: StoredOrg['mode'] = 'ai';
	let moderated = true;
	let storedQuery = query;
	if (!cap.allowed) {
		// Budget spent: a standing proposal, and the visitor's text is not stored at all
		// (nothing unmoderated may reach a permalink).
		org = { ...FALLBACK_ORGS.generic };
		mode = 'fallback';
		storedQuery = '';
	} else {
		const proposal = await proposeOrg(c.env.AI, c.env.AI_MODEL, query);
		if (proposal.outcome === 'rejected') return c.json({ error: 'Not that one.' }, 400);
		org = proposal.org;
		mode = proposal.mode;
		moderated = proposal.moderated;
	}

	// A guard outage still gets an answer — an outage must not take the toy down —
	// but never a permalink: nothing stored, nothing cached, nothing counted, no
	// share image. Without this, "nothing reaches a public permalink unmoderated"
	// would be false at exactly the moment the guard cannot say. The client already
	// hides the share actions when there is no id.
	if (!moderated) {
		// The one place that learns the guard is unreachable. Recorded so the band
		// can say so; it does not change what this visitor is served.
		c.executionCtx.waitUntil(c.env.KV.put(GUARD_OUTAGE_KEY, '1', { expirationTtl: GUARD_OUTAGE_TTL }));
		return c.json({ id: null, org, mode, moderated, cached: false, share: shareText(org) });
	}

	const id = newId();
	const stored: StoredOrg = { id, query: storedQuery, org, mode, createdAt: now.toISOString() };
	await c.env.KV.put(`s:${id}`, JSON.stringify(stored));
	// Only cache real generations; a fallback should get another go next time.
	if (mode === 'ai') {
		await c.env.KV.put(cacheKey, JSON.stringify(stored), { expirationTtl: 30 * 86_400 });
		c.executionCtx.waitUntil(bump(c.env.KV, COUNT_KEY));
	}
	// The share image renders in the background; the response never waits on it.
	c.executionCtx.waitUntil(prerenderOg(c.env, id, org));

	return c.json({ id, org, mode, moderated, cached: false, share: shareText(org) });
});

app.get('/api/s/:id', async (c) => {
	const id = c.req.param('id');
	if (!ID_RE.test(id)) return c.json({ error: 'Not found.' }, 404);
	const stored = await c.env.KV.get<StoredOrg>(`s:${id}`, 'json');
	if (!stored) return c.json({ error: 'Not found.' }, 404);
	return c.json({ ...stored, share: shareText(stored.org) }, 200, { 'cache-control': 'public, max-age=3600' });
});

app.get('/api/presets', (c) => c.json({ presets: Object.keys(FALLBACK_ORGS).filter((k) => k !== 'generic') }));

// Share image for a permalink: cached PNG, else render now, else the generic card.
app.get('/og/:file', async (c) => {
	const m = c.req.param('file').match(/^([a-z2-9]{6,12})\.png$/);
	if (!m) return c.json({ error: 'Not found.' }, 404);
	const id = m[1];
	const headers = { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' };
	const cachedPng = await c.env.KV.get(`og:${id}`, 'arrayBuffer');
	if (cachedPng) return new Response(cachedPng, { headers });
	const stored = await c.env.KV.get<StoredOrg>(`s:${id}`, 'json');
	if (!stored) return c.json({ error: 'Not found.' }, 404);
	// Someone else is rendering it: wait for theirs rather than hand out the generic card.
	const inFlight = await c.env.KV.get(ogLockKey(id));
	const png = inFlight ? await awaitOgPng(c.env.KV, id) : await prerenderOg(c.env, id, stored.org);
	if (png) return new Response(png, { headers });
	// The generic card is a stand-in, not the answer: nothing should cache this redirect.
	c.header('cache-control', 'no-store');
	return c.redirect('/og.png', 302);
});

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

/** The 404 page, with a 404 status: the assets binding would serve it as a 200. */
async function notFound(c: { env: AppEnv; req: { raw: Request } }, url: URL): Promise<Response> {
	url.pathname = '/404';
	const nf = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
	return new Response(nf.body, { status: 404, headers: nf.headers });
}

// Everything else is a static asset. run_worker_first lists the paths that
// reach here, so the www redirect above sees what a human navigates to, not
// every stylesheet. Permalinks render the front page with their own meta tags;
// the client reads the id from the path. Unknown paths, and permalinks that
// were never minted, get the 404 page.
app.get('*', async (c) => {
	const url = new URL(c.req.url);
	// Ask for extension-less paths: the binding's html_handling 308s `/x.html` → `/x`.
	const perma = url.pathname.match(/^\/s\/([a-z2-9]{6,12})$/);
	if (perma) {
		const stored = await c.env.KV.get<StoredOrg>(`s:${perma[1]}`, 'json');
		if (!stored) return notFound(c, url);
		url.pathname = '/';
		const page = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
		return personalise(page, url.origin, perma[1], stored.org);
	}
	const res = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
	if (res.status !== 404) return res;
	return notFound(c, url);
});

export default {
	fetch: app.fetch,
	async scheduled(_event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext) {
		ctx.waitUntil(refreshOnce(env, 'scheduled'));
	},
};
