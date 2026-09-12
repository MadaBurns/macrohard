import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { ID_RE, consumeDailyCap, dayKey, newId, sha256Hex, verifyTurnstile } from '../src/limits';

describe('daily cap', () => {
	it('keys by UTC day', () => {
		expect(dayKey(new Date('2026-09-12T23:59:59Z'))).toBe('cap:2026-09-12');
	});

	it('allows up to the cap then refuses, and tomorrow starts fresh', async () => {
		const day = new Date('2030-01-01T00:00:00Z');
		expect((await consumeDailyCap(env.KV, day, 2)).allowed).toBe(true);
		expect((await consumeDailyCap(env.KV, day, 2)).allowed).toBe(true);
		const third = await consumeDailyCap(env.KV, day, 2);
		expect(third.allowed).toBe(false);
		expect(third.used).toBe(2);
		expect((await consumeDailyCap(env.KV, new Date('2030-01-02T00:00:00Z'), 2)).allowed).toBe(true);
	});

	it('a cap of zero refuses everything (kill switch)', async () => {
		expect((await consumeDailyCap(env.KV, new Date('2030-02-01T00:00:00Z'), 0)).allowed).toBe(false);
	});
});

describe('ids and hashing', () => {
	it('generates ids that match the route guard and are unambiguous', () => {
		for (let i = 0; i < 50; i++) {
			const id = newId();
			expect(id).toMatch(ID_RE);
			expect(id).not.toMatch(/[01lio]/);
		}
	});

	it('hashes deterministically', async () => {
		expect(await sha256Hex('a')).toBe(await sha256Hex('a'));
		expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
		expect(await sha256Hex('a')).toHaveLength(64);
	});
});

describe('verifyTurnstile', () => {
	it('posts the secret and token and trusts only success:true', async () => {
		let body = '';
		const ok = await verifyTurnstile('sec', 'tok', '1.2.3.4', async (_u, init) => {
			body = String(init?.body);
			return new Response(JSON.stringify({ success: true }));
		});
		expect(ok).toBe(true);
		expect(body).toContain('secret=sec');
		expect(body).toContain('remoteip=1.2.3.4');
		expect(await verifyTurnstile('sec', 'tok', null, async () => new Response(JSON.stringify({ success: false })))).toBe(false);
		expect(await verifyTurnstile('sec', 'tok', null, async () => new Response('x', { status: 500 }))).toBe(false);
	});
});
