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

	it('serves the generic page for an unknown id', async () => {
		const html = await (await SELF.fetch(`${ORIGIN}/s/zzzzzzzz`)).text();
		expect(html).toContain('property="og:title" content="Macrohard — the software company that runs itself"');
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
		const res = await SELF.fetch(`${ORIGIN}/og/${ID}.png`, { redirect: 'manual' });
		// Either the renderer is unavailable here (302 to the generic card) or, if the
		// pool happens to provide one, a real PNG. Never a 5xx.
		expect([200, 302]).toContain(res.status);
		if (res.status === 302) expect(res.headers.get('location')).toBe('/og.png');
	});
});
