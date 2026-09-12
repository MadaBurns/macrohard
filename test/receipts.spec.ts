import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
	RECEIPTS_KEY,
	aggregate,
	fetchRepo,
	firstLine,
	isAgentAuthored,
	isStale,
	median,
	parseAgentTrailers,
	refreshReceipts,
	type Fetcher,
	type GitHubCommit,
	type GitHubPull,
	type Receipts,
} from '../src/receipts';
import commitsFixture from './fixtures/github-commits.json';
import pullsFixture from './fixtures/github-pulls.json';

const NOW = new Date('2026-09-12T00:00:00Z');
const commits = commitsFixture as GitHubCommit[];
const pulls = pullsFixture as GitHubPull[];

describe('agent trailer rule', () => {
	it('recognises a Co-Authored-By: Claude trailer, case-insensitively', () => {
		expect(parseAgentTrailers('fix\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>')).toEqual([
			'Claude Opus 5 (1M context)',
		]);
		expect(parseAgentTrailers('fix\n\nco-authored-by: Claude Fable 5.1 <x@y>')).toEqual(['Claude Fable 5.1']);
	});

	it('ignores non-Claude co-authors and plain mentions', () => {
		expect(parseAgentTrailers('pair session\n\nCo-Authored-By: Jane Doe <jane@example.com>')).toEqual([]);
		expect(isAgentAuthored('talked to claude about this')).toBe(false);
	});

	it('dedupes identities within one message', () => {
		const msg = 'x\n\nCo-Authored-By: Claude Opus 5 <a@b>\nCo-Authored-By: Claude Opus 5 <a@b>';
		expect(parseAgentTrailers(msg)).toHaveLength(1);
	});

	it('takes only the first line as the ledger message', () => {
		expect(firstLine('subject\n\nbody')).toBe('subject');
	});
});

describe('median', () => {
	it('handles empty, odd and even', () => {
		expect(median([])).toBeNull();
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
	});
});

describe('aggregate', () => {
	const inputs = [{ name: 'repo', url: 'https://github.com/example/repo', commits, pulls }];

	it('counts only commits inside the window and applies the trailer rule', () => {
		const r = aggregate(inputs, NOW, 90);
		expect(r.totalCommits).toBe(5); // the January commit is excluded
		expect(r.agentCommits).toBe(3);
		expect(r.agentShare).toBe(60);
		expect(r.agentIdentities).toEqual(['Claude Fable 5.1', 'Claude Opus 5 (1M context)']);
	});

	it('counts merged PRs in window and computes the median open→merge in hours', () => {
		const r = aggregate(inputs, NOW, 90);
		expect(r.prsMerged).toBe(3); // #98 unmerged, #5 out of window
		expect(r.medianPrHours).toBe(4); // 4h, 2h, 12h → median 4
	});

	it('builds the ledger newest-first from agent commits only, with links', () => {
		const r = aggregate(inputs, NOW, 90);
		expect(r.ledger.map((l) => l.short)).toEqual(['a4f19c2', 'be0731d', '71de4aa']);
		expect(r.ledger[0].url).toContain('/commit/');
		expect(r.ledger[0].agent).toBe('Claude Opus 5 (1M context)');
		expect(r.ledger[0].message).toBe('harden rate-limit path on public scan endpoint');
	});

	it('reports zero share without dividing by zero', () => {
		const r = aggregate([{ name: 'empty', url: '', commits: [], pulls: [] }], NOW, 90);
		expect(r.totalCommits).toBe(0);
		expect(r.agentShare).toBe(0);
		expect(r.medianPrHours).toBeNull();
	});
});

describe('isStale', () => {
	it('is stale only past the max age', () => {
		const r = { generatedAt: '2026-09-12T00:00:00Z' } as Receipts;
		expect(isStale(r, new Date('2026-09-12T00:30:00Z'), 45 * 60_000)).toBe(false);
		expect(isStale(r, new Date('2026-09-12T01:00:00Z'), 45 * 60_000)).toBe(true);
	});
});

function fakeGitHub(pages: Record<string, { body: unknown; next?: string; status?: number }>): { fetcher: Fetcher; calls: string[] } {
	const calls: string[] = [];
	const fetcher: Fetcher = async (url) => {
		calls.push(url);
		// Longest matching prefix wins, so `commits?page=2` is not swallowed by `commits?`.
		const key = Object.keys(pages)
			.filter((k) => url.startsWith(k))
			.sort((a, b) => b.length - a.length)[0];
		const page = key ? pages[key] : undefined;
		if (!page) return new Response('not found', { status: 404 });
		const headers = new Headers({ 'content-type': 'application/json' });
		if (page.next) headers.set('link', `<${page.next}>; rel="next"`);
		return new Response(JSON.stringify(page.body), { status: page.status ?? 200, headers });
	};
	return { fetcher, calls };
}

describe('fetchRepo', () => {
	it('follows Link: rel=next for commits and stops PR pagination once a page predates the window', async () => {
		const base = 'https://api.github.com/repos/o/r';
		const since = new Date('2026-06-14T00:00:00Z');
		const oldPulls = [{ number: 1, html_url: '', created_at: '2026-01-01T00:00:00Z', merged_at: '2026-01-02T00:00:00Z' }];
		const { fetcher, calls } = fakeGitHub({
			[`${base}/commits?`]: { body: commits.slice(0, 3), next: `${base}/commits?page=2` },
			[`${base}/commits?page=2`]: { body: commits.slice(3) },
			[`${base}/pulls?`]: { body: pulls, next: `${base}/pulls?page=2` },
			[`${base}/pulls?page=2`]: { body: oldPulls, next: `${base}/pulls?page=3` },
			[`${base}/pulls?page=3`]: { body: oldPulls },
		});
		const repo = await fetchRepo(fetcher, 'o', 'r', since);
		expect(repo.commits).toHaveLength(6);
		expect(repo.pulls).toHaveLength(6);
		expect(calls.some((c) => c.includes('pulls?page=3'))).toBe(false);
	});

	it('sends an Authorization header only when a token is given', async () => {
		let seen: Record<string, string> = {};
		const fetcher: Fetcher = async (_url, init) => {
			seen = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
			return new Response('[]', { headers: { 'content-type': 'application/json' } });
		};
		await fetchRepo(fetcher, 'o', 'r', NOW);
		expect(seen.authorization).toBeUndefined();
		await fetchRepo(fetcher, 'o', 'r', NOW, 'tok');
		expect(seen.authorization).toBe('Bearer tok');
	});

	it('throws on a non-2xx so the caller keeps the previous snapshot', async () => {
		const { fetcher } = fakeGitHub({});
		await expect(fetchRepo(fetcher, 'o', 'r', NOW)).rejects.toThrow(/GitHub 404/);
	});
});

describe('refreshReceipts', () => {
	it('writes a snapshot to KV', async () => {
		const base = 'https://api.github.com/repos/o/r';
		const { fetcher } = fakeGitHub({ [`${base}/commits?`]: { body: commits }, [`${base}/pulls?`]: { body: pulls } });
		const r = await refreshReceipts(env.KV, { owner: 'o', repos: ['r'], windowDays: 90, now: NOW, fetcher });
		expect(r.agentCommits).toBe(3);
		const stored = await env.KV.get<Receipts>(RECEIPTS_KEY, 'json');
		expect(stored?.agentCommits).toBe(3);
	});

	it('never replaces a real snapshot with an all-zero one', async () => {
		const good = { generatedAt: NOW.toISOString(), totalCommits: 42, agentCommits: 40 } as Receipts;
		await env.KV.put(RECEIPTS_KEY, JSON.stringify(good));
		const base = 'https://api.github.com/repos/o/r';
		const { fetcher } = fakeGitHub({ [`${base}/commits?`]: { body: [] }, [`${base}/pulls?`]: { body: [] } });
		const r = await refreshReceipts(env.KV, { owner: 'o', repos: ['r'], windowDays: 90, now: NOW, fetcher });
		expect(r.totalCommits).toBe(42);
		const stored = await env.KV.get<Receipts>(RECEIPTS_KEY, 'json');
		expect(stored?.totalCommits).toBe(42);
	});
});
