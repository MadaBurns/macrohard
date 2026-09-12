import { describe, expect, it } from 'vitest';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { GUARD_MODEL, type Org } from '../src/staff';
import type { AppEnv } from '../src/env';

const ORIGIN = 'https://macrohard.nz';

const ORG: Org = {
	title: 'A coastal ferry operator',
	agents: 4,
	runRateUsdPerDay: 180,
	cycleTime: '2h 40m',
	roles: [
		{ role: 'Timetable Agent', tools: 'schedule store, tide feed', tokensPerDay: '0.9M', standsInFor: 'the roster meeting' },
		{ role: 'Deck Squad (x3)', tools: 'maintenance log', tokensPerDay: '2.1M', standsInFor: '14 deckhands' },
		{ role: 'Harbour Liaison Agent', tools: 'port notices, inbox', tokensPerDay: '0.4M', standsInFor: 'two schedulers' },
	],
};

/** Guards pass, the generator returns ORG. */
const cleanAi = {
	async run(model: string) {
		return model === GUARD_MODEL ? { response: 'safe' } : { response: JSON.stringify(ORG) };
	},
};

describe('permalink lifetime', () => {
	it('a permalink is stored with no expiry, so a shared link cannot rot', async () => {
		// Record what the route asks KV to store, then let the real KV store it.
		const puts: Array<{ key: string; options?: KVNamespacePutOptions }> = [];
		const kv = new Proxy(env.KV, {
			get(target, prop, receiver) {
				if (prop === 'put') {
					return (key: string, value: Parameters<KVNamespace['put']>[1], options?: KVNamespacePutOptions) => {
						puts.push({ key, options });
						return target.put(key, value, options);
					};
				}
				const value = Reflect.get(target, prop, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const testEnv = { ...env, AI: cleanAi, KV: kv, STAFF_RL: undefined } as unknown as AppEnv;

		const ctx = createExecutionContext();
		const res = await worker.fetch(
			new Request(`${ORIGIN}/api/staff`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query: 'A coastal ferry operator with ninety staff' }),
			}),
			testEnv,
			ctx,
		);
		await waitOnExecutionContext(ctx);
		expect(res.status).toBe(200);
		const { id } = (await res.json()) as { id: string };

		// The permalink: no TTL asked for, and nothing in KV says it expires.
		const permalinkPut = puts.find((p) => p.key === `s:${id}`);
		expect(permalinkPut).toBeDefined();
		expect(permalinkPut?.options?.expirationTtl).toBeUndefined();
		expect(permalinkPut?.options?.expiration).toBeUndefined();
		const listed = await env.KV.list({ prefix: `s:${id}` });
		expect(listed.keys).toHaveLength(1);
		expect(listed.keys[0].expiration).toBeUndefined();

		// Positive control for the assertion above: KV's list does report an expiry when
		// there is one, so `undefined` means permanent rather than unsupported-by-the-pool.
		await env.KV.put('s:ttlprobe', 'x', { expirationTtl: 600 });
		const probe = await env.KV.list({ prefix: 's:ttlprobe' });
		expect(probe.keys[0]?.expiration).toBeGreaterThan(0);
		await env.KV.delete('s:ttlprobe');

		// The query cache still expires — a 30-day cache is a cost control, not a promise.
		const cachePut = puts.find((p) => p.key.startsWith('org:'));
		expect(cachePut?.options?.expirationTtl).toBe(30 * 86_400);
	});
});
