import { Hono } from 'hono';
import type { AppEnv } from './env';
import { getReceipts, isStale, refreshReceipts, type Receipts } from './receipts';
import { FALLBACK_ORGS, cacheKeyText, generateOrg, pickFallback, validateQuery, type Org } from './staff';
import { ID_RE, consumeDailyCap, newId, sha256Hex, verifyTurnstile } from './limits';

type Bindings = AppEnv;

const app = new Hono<{ Bindings: Bindings }>();

const RECEIPTS_MAX_AGE_MS = 45 * 60_000;

interface StoredOrg {
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
	c.json({
		turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
		contactEmail: c.env.CONTACT_EMAIL,
		dailyCap: Number(c.env.STAFF_DAILY_CAP) || 0,
		repos: repoList(c.env).map((r) => `https://github.com/${c.env.GITHUB_OWNER}/${r}`),
	}),
);

app.get('/api/receipts', async (c) => {
	const now = new Date();
	const current = await getReceipts(c.env.KV);
	const needsRefresh = !current || isStale(current, now, RECEIPTS_MAX_AGE_MS);
	if (needsRefresh) {
		// Refresh out-of-band; serve what we have (or "warming") rather than block.
		c.executionCtx.waitUntil(
			refreshReceipts(c.env.KV, refreshOpts(c.env)).catch((err) => console.error('receipts refresh failed', String(err))),
		);
	}
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
	if (cached) return c.json({ id: cached.id, org: cached.org, mode: cached.mode, cached: true });

	if (c.env.TURNSTILE_SECRET) {
		const token = typeof payload.turnstile === 'string' ? payload.turnstile : '';
		if (!token || !(await verifyTurnstile(c.env.TURNSTILE_SECRET, token, ip))) {
			return c.json({ error: 'Please complete the check.' }, 403);
		}
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
	if (!cap.allowed) {
		org = pickFallback(query);
		mode = 'fallback';
	} else {
		try {
			org = await generateOrg(c.env.AI, c.env.AI_MODEL, query);
		} catch (err) {
			console.error('generateOrg failed', String(err));
			org = pickFallback(query);
			mode = 'fallback';
		}
	}

	const id = newId();
	const stored: StoredOrg = { id, query, org, mode, createdAt: now.toISOString() };
	await c.env.KV.put(`s:${id}`, JSON.stringify(stored), { expirationTtl: 180 * 86_400 });
	// Only cache real generations; a fallback should get another go next time.
	if (mode === 'ai') await c.env.KV.put(cacheKey, JSON.stringify(stored), { expirationTtl: 30 * 86_400 });

	return c.json({ id, org, mode, cached: false });
});

app.get('/api/s/:id', async (c) => {
	const id = c.req.param('id');
	if (!ID_RE.test(id)) return c.json({ error: 'Not found.' }, 404);
	const stored = await c.env.KV.get<StoredOrg>(`s:${id}`, 'json');
	if (!stored) return c.json({ error: 'Not found.' }, 404);
	return c.json(stored, 200, { 'cache-control': 'public, max-age=3600' });
});

app.get('/api/presets', (c) => c.json({ presets: Object.keys(FALLBACK_ORGS).filter((k) => k !== 'generic') }));

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

// Everything else is a static asset (run_worker_first is on so the www
// redirect above sees every request). Permalinks render the front page; the
// client reads the id from the path. Unknown paths get the 404 page.
app.get('*', async (c) => {
	const url = new URL(c.req.url);
	// Ask for extension-less paths: the binding's html_handling 308s `/x.html` → `/x`.
	if (/^\/s\/[a-z2-9]{6,12}$/.test(url.pathname)) url.pathname = '/';
	const res = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
	if (res.status !== 404) return res;
	url.pathname = '/404';
	const nf = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
	return new Response(nf.body, { status: 404, headers: nf.headers });
});

export default {
	fetch: app.fetch,
	async scheduled(_event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext) {
		ctx.waitUntil(refreshReceipts(env.KV, refreshOpts(env)).catch((err) => console.error('scheduled refresh failed', String(err))));
	},
};
