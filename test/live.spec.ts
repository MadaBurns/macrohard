import { beforeEach, describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { GUARD_OUTAGE_KEY, dayKey } from '../src/limits';

const ORIGIN = 'https://macrohard.nz';

beforeEach(async () => {
	await env.KV.delete(dayKey(new Date()));
	await env.KV.delete(GUARD_OUTAGE_KEY);
});

describe('/api/live', () => {
	it('reports the desk against its cap without spending any of it', async () => {
		const key = dayKey(new Date());
		await env.KV.put(key, '117');

		const res = await SELF.fetch(`${ORIGIN}/api/live`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { desk: { used: number; cap: number }; guard: string };
		expect(body.desk.used).toBe(117);
		expect(body.desk.cap).toBe(Number(env.STAFF_DAILY_CAP));

		// Reading the counter must not consume against it, or the band would close its own desk.
		await SELF.fetch(`${ORIGIN}/api/live`);
		await SELF.fetch(`${ORIGIN}/api/live`);
		expect(await env.KV.get(key)).toBe('117');
	});

	it('reports an unspent day as zero rather than as missing', async () => {
		const body = (await (await SELF.fetch(`${ORIGIN}/api/live`)).json()) as { desk: { used: number } };
		expect(body.desk.used).toBe(0);
	});

	it('reports the guard as degraded only while an outage marker stands', async () => {
		const ok = (await (await SELF.fetch(`${ORIGIN}/api/live`)).json()) as { guard: string };
		expect(ok.guard).toBe('ok');

		await env.KV.put(GUARD_OUTAGE_KEY, '1');
		const bad = (await (await SELF.fetch(`${ORIGIN}/api/live`)).json()) as { guard: string };
		expect(bad.guard).toBe('degraded');
	});

	it('is cacheable and leaks no secret', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/live`);
		expect(res.headers.get('cache-control')).toContain('max-age=30');
		expect(JSON.stringify(await res.json())).not.toMatch(/secret|token/i);
	});
});
