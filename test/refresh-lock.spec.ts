import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { RECEIPTS_KEY, type Receipts } from '../src/receipts';
import { REFRESH_LOCK_KEY } from '../src/limits';
import type { AppEnv } from '../src/env';
import commitsFixture from './fixtures/github-commits.json';
import pullsFixture from './fixtures/github-pulls.json';

const ORIGIN = 'https://macrohard.nz';
const appEnv = env as unknown as AppEnv;

/**
 * Answers every GitHub call with the fixtures and counts them. Interceptors are
 * persisted for the whole file, so an owner named BROKEN is left unanswered on
 * purpose: with net connect disabled, that is how a test makes a refresh throw.
 */
const BROKEN = 'broken-owner';
function mockGitHub() {
	let calls = 0;
	fetchMock
		.get('https://api.github.com')
		.intercept({ path: (p) => p.startsWith('/repos/') && !p.includes(BROKEN), method: 'GET' })
		.reply((req) => {
			calls++;
			const body = req.path.includes('/commits') ? commitsFixture : pullsFixture;
			return { statusCode: 200, data: JSON.stringify(body), responseOptions: { headers: { 'content-type': 'application/json' } } };
		})
		.persist();
	return { count: () => calls };
}

const stale = (): Receipts =>
	({ generatedAt: '2020-01-01T00:00:00Z', totalCommits: 10, agentCommits: 6, ledger: [], repos: [] }) as unknown as Receipts;

async function getReceipts() {
	const ctx = createExecutionContext();
	const res = await worker.fetch(new Request(`${ORIGIN}/api/receipts`), appEnv, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

async function runCron(e: AppEnv = appEnv) {
	const ctx = createExecutionContext();
	await worker.scheduled({ cron: '*/30 * * * *', scheduledTime: Date.now(), noRetry() {} } as ScheduledEvent, e, ctx);
	await waitOnExecutionContext(ctx);
}

beforeEach(async () => {
	await env.KV.delete(REFRESH_LOCK_KEY);
	await env.KV.delete(RECEIPTS_KEY);
});

describe('one refresh in flight at a time', () => {
	it('a stale visit refreshes once; the visits behind it do not start their own', async () => {
		const gh = mockGitHub();
		await env.KV.put(RECEIPTS_KEY, JSON.stringify(stale()));
		expect((await getReceipts()).status).toBe(200);
		const first = gh.count();
		expect(first).toBeGreaterThan(0);
		expect(await env.KV.get(REFRESH_LOCK_KEY)).toBe('1');
		// The refresh above wrote a fresh snapshot, so make it look stale again: the
		// second visitor must be stopped by the lock, not by freshness.
		await env.KV.put(RECEIPTS_KEY, JSON.stringify(stale()));
		await getReceipts();
		await getReceipts();
		expect(gh.count()).toBe(first);
	});

	it('the cron refreshes, and a thrown refresh is swallowed with the previous snapshot intact', async () => {
		// Nothing answers for this owner and net connect is disabled: every GitHub call throws.
		await env.KV.put(RECEIPTS_KEY, JSON.stringify(stale()));
		await expect(runCron({ ...appEnv, GITHUB_OWNER: BROKEN })).resolves.toBeUndefined();
		expect((await env.KV.get<Receipts>(RECEIPTS_KEY, 'json'))?.generatedAt).toBe('2020-01-01T00:00:00Z');

		// With GitHub answering, the cron writes a real snapshot.
		await env.KV.delete(REFRESH_LOCK_KEY);
		mockGitHub();
		await runCron();
		expect((await env.KV.get<Receipts>(RECEIPTS_KEY, 'json'))?.agentCommits).toBeGreaterThan(0);
	});

	it('the cron honours the lock too', async () => {
		const gh = mockGitHub();
		await env.KV.put(REFRESH_LOCK_KEY, '1', { expirationTtl: 120 });
		await runCron();
		expect(gh.count()).toBe(0);
	});
});
