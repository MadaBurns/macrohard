import { beforeAll, describe, expect, it } from 'vitest';
import { SELF, env, fetchMock } from 'cloudflare:test';
import { FALLBACK_ORGS } from '../src/staff';

const ORIGIN = 'https://macrohard.nz';
const ID = 'sharetst';

beforeAll(async () => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
	await env.KV.put(`s:${ID}`, JSON.stringify({ id: ID, query: 'A newsroom', org: FALLBACK_ORGS.newsroom, mode: 'ai', createdAt: '' }));
});

describe('/api/stats', () => {
	it('reports the restructured counter, zero when unset', async () => {
		await env.KV.delete('count:total');
		expect(await (await SELF.fetch(`${ORIGIN}/api/stats`)).json()).toEqual({ restructured: 0 });
		await env.KV.put('count:total', '7');
		expect(await (await SELF.fetch(`${ORIGIN}/api/stats`)).json()).toEqual({ restructured: 7 });
	});
});

describe('personalised permalinks', () => {
	it('rewrites the meta tags for a stored org', async () => {
		const html = await (await SELF.fetch(`${ORIGIN}/s/${ID}`)).text();
		expect(html).toContain('<title>A newsroom — 7 agents, USD 241/day — Macrohard</title>');
		expect(html).toContain(`property="og:title" content="A newsroom — 7 agents, USD 241/day"`);
		expect(html).toContain(`property="og:image" content="${ORIGIN}/og/${ID}.png"`);
		expect(html).toContain(`property="og:url" content="${ORIGIN}/s/${ID}"`);
		expect(html).toContain('Desk Agent stands in for the night desk');
		expect(html).toContain(`rel="canonical" href="${ORIGIN}/s/${ID}"`);
	});

	it('an id that was never minted is a 404, like its API twin, not a blank front page', async () => {
		const res = await SELF.fetch(`${ORIGIN}/s/zzzzzzzz`);
		expect(res.status).toBe(404);
		const html = await res.text();
		expect(html).toContain('qualified opinion');
		expect(html).not.toContain('id="staff-form"');
	});

	it('/api/s/:id includes the pre-written share text', async () => {
		const body = (await (await SELF.fetch(`${ORIGIN}/api/s/${ID}`)).json()) as { share: string };
		expect(body.share).toContain('Macrohard restructured "A newsroom"');
	});
});

describe('/og/:id.png', () => {
	it('404s for malformed names and unknown ids', async () => {
		expect((await SELF.fetch(`${ORIGIN}/og/nope.png`)).status).toBe(404);
		expect((await SELF.fetch(`${ORIGIN}/og/zzzzzzzz.png`)).status).toBe(404);
	});

	it('serves a cached PNG from KV', async () => {
		await env.KV.put(`og:${ID}`, new Uint8Array([137, 80, 78, 71]));
		const res = await SELF.fetch(`${ORIGIN}/og/${ID}.png`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
	});

	it('falls back to the generic card when nothing is cached and rendering is unavailable', async () => {
		await env.KV.delete(`og:${ID}`);
		await env.KV.delete(`oglock:${ID}`);
		const res = await SELF.fetch(`${ORIGIN}/og/${ID}.png`, { redirect: 'manual' });
		// Either the renderer is unavailable here (302 to the generic card) or, if the
		// pool happens to provide one, a real PNG. Never a 5xx.
		expect([200, 302]).toContain(res.status);
		if (res.status === 302) {
			expect(res.headers.get('location')).toBe('/og.png');
			// A stand-in must not be cached as the answer by whoever followed it.
			expect(res.headers.get('cache-control')).toBe('no-store');
		}
	});

	it('waits for a render another request already started instead of handing a crawler the generic card', async () => {
		await env.KV.delete(`og:${ID}`);
		await env.KV.put(`oglock:${ID}`, '1', { expirationTtl: 120 });
		const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		// The other request's render lands while this one is waiting.
		setTimeout(() => env.KV.put(`og:${ID}`, bytes), 300);
		const res = await SELF.fetch(`${ORIGIN}/og/${ID}.png`, { redirect: 'manual' });
		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
		await env.KV.delete(`oglock:${ID}`);
	});
});
