import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SELF, env, fetchMock } from 'cloudflare:test';
import { RECEIPTS_KEY, type Receipts } from '../src/receipts';
import { FALLBACK_ORGS, cacheKeyText } from '../src/staff';
import { sha256Hex } from '../src/limits';

const ORIGIN = 'https://macrohard.nz';

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

beforeEach(async () => {
	await env.KV.delete(RECEIPTS_KEY);
});

describe('/api/config', () => {
	it('exposes public config only', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/config`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.contactEmail).toBe('hello@macrohard.nz');
		expect(body.repos).toEqual(expect.arrayContaining([expect.stringContaining('github.com/')]));
		expect(JSON.stringify(body)).not.toMatch(/secret|token/i);
	});
});

describe('/api/receipts', () => {
	it('reports warming (202) rather than zeros when there is no snapshot yet', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/receipts`);
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ status: 'warming' });
	});

	it('serves the snapshot and flags staleness', async () => {
		const snap = { generatedAt: new Date().toISOString(), totalCommits: 10, agentCommits: 6, ledger: [] } as unknown as Receipts;
		await env.KV.put(RECEIPTS_KEY, JSON.stringify(snap));
		const res = await SELF.fetch(`${ORIGIN}/api/receipts`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.stale).toBe(false);
		expect(body.agentCommits).toBe(6);

		await env.KV.put(RECEIPTS_KEY, JSON.stringify({ ...snap, generatedAt: '2020-01-01T00:00:00Z' }));
		const old = (await (await SELF.fetch(`${ORIGIN}/api/receipts`)).json()) as Record<string, unknown>;
		expect(old.stale).toBe(true);
		expect(old.agentCommits).toBe(6); // stale beats missing
	});
});

describe('/api/staff', () => {
	const post = (body: unknown) =>
		SELF.fetch(`${ORIGIN}/api/staff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

	it('rejects malformed and unacceptable input before touching any limiter', async () => {
		expect((await SELF.fetch(`${ORIGIN}/api/staff`, { method: 'POST', body: 'nope' })).status).toBe(400);
		expect((await post({ query: 'ab' })).status).toBe(400);
		expect((await post({ query: 'go to https://x.y' })).status).toBe(400);
	});

	it('serves a cached generation without calling the model', async () => {
		const query = 'A Newsroom';
		const stored = { id: 'abcdefgh', query, org: FALLBACK_ORGS.newsroom, mode: 'ai', createdAt: new Date().toISOString() };
		await env.KV.put(`org:${await sha256Hex(cacheKeyText(query))}`, JSON.stringify(stored));
		const res = await post({ query: '  a newsroom ' });
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.cached).toBe(true);
		expect(body.id).toBe('abcdefgh');
		expect((body.org as { title: string }).title).toBe('A newsroom');
	});
});

describe('/api/s/:id', () => {
	it('404s on bad ids and unknown ids, serves stored ones', async () => {
		expect((await SELF.fetch(`${ORIGIN}/api/s/NOPE!`)).status).toBe(404);
		expect((await SELF.fetch(`${ORIGIN}/api/s/zzzzzzzz`)).status).toBe(404);
		await env.KV.put('s:abcdefgh', JSON.stringify({ id: 'abcdefgh', query: 'x', org: FALLBACK_ORGS.generic, mode: 'ai', createdAt: '' }));
		const res = await SELF.fetch(`${ORIGIN}/api/s/abcdefgh`);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { org: { agents: number } }).org.agents).toBe(7);
	});
});

describe('edges', () => {
	it('redirects www to the apex', async () => {
		const res = await SELF.fetch('https://www.macrohard.nz/api/config', { redirect: 'manual' });
		expect(res.status).toBe(301);
		expect(res.headers.get('location')).toBe('https://macrohard.nz/api/config');
	});

	it('unknown API paths are JSON 404s', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/nope`);
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toContain('application/json');
	});
});
