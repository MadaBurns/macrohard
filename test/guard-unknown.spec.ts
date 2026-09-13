import { describe, expect, it } from 'vitest';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { GUARD_MODEL, cacheKeyText, type Org } from '../src/staff';
import { sha256Hex } from '../src/limits';
import type { AppEnv } from '../src/env';

const ORIGIN = 'https://macrohard.nz';
const COUNT_KEY = 'count:total';

const ORG: Org = {
	title: 'A harbour ferry operator',
	agents: 5,
	runRateUsdPerDay: 210,
	cycleTime: '3h 10m',
	roles: [
		{ role: 'Timetable Agent', tools: 'schedule store, tide feed', tokensPerDay: '0.9M', standsInFor: 'the roster meeting' },
		{ role: 'Deck Squad (x3)', tools: 'maintenance log, parts catalogue', tokensPerDay: '2.1M', standsInFor: '14 deckhands' },
		{ role: 'Harbour Liaison Agent', tools: 'port notices, inbox', tokensPerDay: '0.4M', standsInFor: 'two schedulers' },
	],
};

type GuardScript = 'safe' | 'unsafe' | 'throw';

/**
 * An AI binding that answers exactly as scripted. The guard model is asked twice
 * per generation — once for the query, once for the finished org — so the script
 * names both in order. The generator answers with ORG unless told to throw.
 */
function fakeAi(onQuery: GuardScript, onOrg: GuardScript = 'safe', generator: 'ok' | 'throw' = 'ok') {
	let guardCalls = 0;
	return {
		async run(model: string) {
			if (model === GUARD_MODEL) {
				const verdict = guardCalls++ === 0 ? onQuery : onOrg;
				if (verdict === 'throw') throw new Error('guard unavailable');
				return { response: verdict === 'unsafe' ? 'unsafe\nS1' : 'safe' };
			}
			if (generator === 'throw') throw new Error('model unavailable');
			return { response: JSON.stringify(ORG) };
		},
	};
}

/** The real env with a scripted AI. STAFF_RL is left out: the limiter is orthogonal here. */
function envWith(ai: ReturnType<typeof fakeAi>): AppEnv {
	return { ...env, AI: ai, STAFF_RL: undefined } as unknown as AppEnv;
}

async function post(query: string, ai: ReturnType<typeof fakeAi>) {
	const ctx = createExecutionContext();
	const req = new Request(`${ORIGIN}/api/staff`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query }),
	});
	const res = await worker.fetch(req, envWith(ai), ctx);
	await waitOnExecutionContext(ctx);
	return { res, body: (await res.json()) as Record<string, unknown> };
}

/** What is in KV that a stranger could reach, or that cost us something. */
async function persisted(query: string) {
	const stored = await env.KV.list({ prefix: 's:' });
	const cacheKey = `org:${await sha256Hex(cacheKeyText(query))}`;
	return {
		permalinks: stored.keys.length,
		cached: (await env.KV.get(cacheKey)) !== null,
		count: Number((await env.KV.get(COUNT_KEY)) ?? '0'),
	};
}

describe('a guard outage must not mint a permalink', () => {
	it('serves the org but stores nothing when the query verdict is unknown', async () => {
		const q = 'A harbour ferry operator with ninety staff';
		const { res, body } = await post(q, fakeAi('throw'));
		expect(res.status).toBe(200);
		expect((body.org as Org).title).toBe(ORG.title);
		expect(body.mode).toBe('ai');
		expect(body.moderated).toBe(false);
		expect(body.id).toBeNull();
		expect(await persisted(q)).toEqual({ permalinks: 0, cached: false, count: 0 });
	});

	it('serves the org but stores nothing when the org verdict is unknown', async () => {
		const q = 'An alpine coastal ferry operator';
		const { res, body } = await post(q, fakeAi('safe', 'throw'));
		expect(res.status).toBe(200);
		expect(body.moderated).toBe(false);
		expect(body.id).toBeNull();
		expect(await persisted(q)).toEqual({ permalinks: 0, cached: false, count: 0 });
	});

	it('two clean verdicts persist, cache and count exactly as before', async () => {
		const q = 'A northern island ferry operator';
		const { res, body } = await post(q, fakeAi('safe', 'safe'));
		expect(res.status).toBe(200);
		expect(body.moderated).toBe(true);
		expect(typeof body.id).toBe('string');
		expect(await persisted(q)).toEqual({ permalinks: 1, cached: true, count: 1 });
		// And the permalink a stranger would open resolves to that org.
		const stored = await env.KV.get<{ org: Org }>(`s:${body.id as string}`, 'json');
		expect(stored?.org.title).toBe(ORG.title);
	});

	it('an unsafe query is still a 400 that stores nothing', async () => {
		const q = 'A river valley ferry operator';
		const { res, body } = await post(q, fakeAi('unsafe'));
		expect(res.status).toBe(400);
		expect(body.error).toBe('Not that one.');
		expect(await persisted(q)).toEqual({ permalinks: 0, cached: false, count: 0 });
	});

	it('a fallback under an unmoderated query is not moderated by construction: the title is the query', async () => {
		// The guard could not see the query, then the model failed. The canned body is
		// fixed text, but pickFallback puts the visitor's own words in the title — and
		// nothing has looked at those words. Without this test the permalink, its
		// <title> and its share card would all carry an unmoderated string.
		const q = 'A glacial fjord ferry operator';
		const { res, body } = await post(q, fakeAi('throw', 'safe', 'throw'));
		expect(res.status).toBe(200);
		expect(body.mode).toBe('fallback');
		expect((body.org as Org).title).toBe(q);
		expect(body.moderated).toBe(false);
		expect(body.id).toBeNull();
		expect(await persisted(q)).toEqual({ permalinks: 0, cached: false, count: 0 });
	});

	it('a fallback under a query the guard passed does persist, as before', async () => {
		const q = 'A sheltered bay ferry operator';
		const { res, body } = await post(q, fakeAi('safe', 'safe', 'throw'));
		expect(res.status).toBe(200);
		expect(body.mode).toBe('fallback');
		expect(body.moderated).toBe(true);
		expect(typeof body.id).toBe('string');
		expect(await persisted(q)).toEqual({ permalinks: 1, cached: false, count: 0 });
	});

	it('an unsafe org falls back to canned text under a passed query, which does persist', async () => {
		const q = 'A lakeside ferry operator';
		const { res, body } = await post(q, fakeAi('safe', 'unsafe'));
		expect(res.status).toBe(200);
		expect(body.mode).toBe('fallback');
		expect(body.moderated).toBe(true);
		expect(typeof body.id).toBe('string');
		expect((body.org as Org).title).toBe(q);
		// A fallback is deliberately not cached, so the next attempt tries the model again.
		expect(await persisted(q)).toEqual({ permalinks: 1, cached: false, count: 0 });
	});
});
