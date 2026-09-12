import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { RECEIPTS_KEY, fetchRepo, refreshReceipts, type Fetcher, type Receipts } from '../src/receipts';
import commitsFixture from './fixtures/github-commits.json';
import pullsFixture from './fixtures/github-pulls.json';

const NOW = new Date('2026-09-12T00:00:00Z');
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Records every request's Authorization header; 401s the first N authenticated calls. */
function recorder(opts: { rejectAuth?: boolean } = {}) {
	const auths: Array<string | undefined> = [];
	const fetcher: Fetcher = async (_url, init) => {
		const h = (init?.headers ?? {}) as Record<string, string>;
		auths.push(h.authorization);
		if (opts.rejectAuth && h.authorization) return new Response('Bad credentials', { status: 401 });
		return json([]);
	};
	return { fetcher, auths };
}

describe('token handling', () => {
	it('sends the token when it works, and never sends an anonymous duplicate', async () => {
		const { fetcher, auths } = recorder();
		await fetchRepo(fetcher, 'o', 'r', NOW, 'good-token');
		expect(auths).toEqual(['Bearer good-token', 'Bearer good-token']);
	});

	it('trims whitespace — a secret set from a file often carries a trailing newline', async () => {
		const { fetcher, auths } = recorder();
		await fetchRepo(fetcher, 'o', 'r', NOW, '  tok-with-space\n');
		expect(auths[0]).toBe('Bearer tok-with-space');
	});

	it('falls back to anonymous when GitHub 401s the token, instead of throwing', async () => {
		const { fetcher, auths } = recorder({ rejectAuth: true });
		const repo = await fetchRepo(fetcher, 'o', 'r', NOW, 'bad-token');
		expect(repo.commits).toEqual([]); // succeeded anonymously rather than throwing
		expect(auths[0]).toBe('Bearer bad-token');
		expect(auths[1]).toBeUndefined(); // retried without the header
	});

	it('bounds authenticated retries to one per repo, not one per request', async () => {
		const { fetcher, auths } = recorder({ rejectAuth: true });
		const repos = ['a', 'b', 'c'];
		await refreshReceipts(env.KV, { owner: 'o', repos, windowDays: 90, token: 'bad-token', now: NOW, fetcher });
		// Repos are fetched concurrently, so each one's first request is already in flight
		// before the first 401 lands — one wasted probe per repo, never one per request
		// (which would be 2x per repo here, and worse under pagination).
		const authed = auths.filter((a) => a !== undefined);
		expect(authed.length).toBeGreaterThan(0);
		expect(authed.length).toBeLessThanOrEqual(repos.length);
		expect(auths.filter((a) => a === undefined).length).toBeGreaterThanOrEqual(repos.length);
	});

	it('a 401 fallback still produces a real snapshot', async () => {
		await env.KV.delete(RECEIPTS_KEY);
		let sawAuth = false;
		const fetcher: Fetcher = async (url, init) => {
			const h = (init?.headers ?? {}) as Record<string, string>;
			if (h.authorization) {
				sawAuth = true;
				return new Response('Bad credentials', { status: 401 });
			}
			return json(url.includes('/commits') ? commitsFixture : pullsFixture);
		};
		const r = await refreshReceipts(env.KV, { owner: 'o', repos: ['r'], windowDays: 90, token: 'bad', now: NOW, fetcher });
		expect(sawAuth).toBe(true);
		expect(r.agentCommits).toBe(3);
		expect((await env.KV.get<Receipts>(RECEIPTS_KEY, 'json'))?.agentCommits).toBe(3);
	});

	it('records on the snapshot whether the token was still authenticating', async () => {
		await env.KV.delete(RECEIPTS_KEY);
		const good: Fetcher = async (url) => json(url.includes('/commits') ? commitsFixture : pullsFixture);
		const clean = await refreshReceipts(env.KV, { owner: 'o', repos: ['r'], windowDays: 90, token: 'good', now: NOW, fetcher: good });
		expect(clean.tokenRejected).toBe(false);

		const rejecting: Fetcher = async (url, init) => {
			const h = (init?.headers ?? {}) as Record<string, string>;
			if (h.authorization) return new Response('Bad credentials', { status: 401 });
			return json(url.includes('/commits') ? commitsFixture : pullsFixture);
		};
		const lapsed = await refreshReceipts(env.KV, { owner: 'o', repos: ['r'], windowDays: 90, token: 'bad', now: NOW, fetcher: rejecting });
		expect(lapsed.tokenRejected).toBe(true);
		// The page reads it off the stored snapshot, not off a second endpoint.
		expect((await env.KV.get<Receipts>(RECEIPTS_KEY, 'json'))?.tokenRejected).toBe(true);
	});

	it('still throws on a non-401 failure so the previous snapshot is kept', async () => {
		const fetcher: Fetcher = async () => new Response('rate limited', { status: 403 });
		await expect(fetchRepo(fetcher, 'o', 'r', NOW, 'tok')).rejects.toThrow(/GitHub 403/);
	});
});
