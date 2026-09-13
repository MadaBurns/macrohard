import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { ID_RE, consumeDailyCap, dayKey, newId, parseHostnames, sha256Hex, verifyTurnstile } from '../src/limits';

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
	const base = { secret: 'sec', token: 'tok', ip: '1.2.3.4', action: 'staff', hostnames: ['macrohard.nz'] };
	const reply =
		(payload: unknown, status = 200) =>
		async () =>
			new Response(JSON.stringify(payload), { status });
	const pass = { success: true, action: 'staff', hostname: 'macrohard.nz' };

	it('posts the secret, token and ip, and accepts a well-formed pass', async () => {
		let body = '';
		const ok = await verifyTurnstile(base, async (_u, init) => {
			body = String(init?.body);
			return new Response(JSON.stringify(pass));
		});
		expect(ok).toBe(true);
		expect(body).toContain('secret=sec');
		expect(body).toContain('remoteip=1.2.3.4');
	});

	it('refuses when Cloudflare says so, or cannot be asked', async () => {
		expect(await verifyTurnstile(base, reply({ ...pass, success: false }))).toBe(false);
		expect(await verifyTurnstile(base, reply('x', 500))).toBe(false);
		expect(
			await verifyTurnstile(base, async () => {
				throw new Error('network');
			}),
		).toBe(false);
	});

	it('refuses a token minted for another action', async () => {
		expect(await verifyTurnstile(base, reply({ ...pass, action: 'contact' }))).toBe(false);
		expect(await verifyTurnstile(base, reply({ success: true, hostname: 'macrohard.nz' }))).toBe(false);
	});

	it('refuses a token minted on a host we do not serve', async () => {
		expect(await verifyTurnstile(base, reply({ ...pass, hostname: 'localhost' }))).toBe(false);
		expect(await verifyTurnstile(base, reply({ success: true, action: 'staff' }))).toBe(false);
	});

	it('fails closed when no hostname is configured', async () => {
		expect(await verifyTurnstile({ ...base, hostnames: [] }, reply(pass))).toBe(false);
	});

	it('rejects a missing or oversized token without calling out', async () => {
		let called = false;
		const spy = async () => {
			called = true;
			return new Response(JSON.stringify(pass));
		};
		expect(await verifyTurnstile({ ...base, token: '' }, spy)).toBe(false);
		expect(await verifyTurnstile({ ...base, token: 'x'.repeat(2049) }, spy)).toBe(false);
		expect(called).toBe(false);
	});
});

describe('parseHostnames', () => {
	it('splits, trims and drops blanks', () => {
		expect(parseHostnames('a.example, b.example ,')).toEqual(['a.example', 'b.example']);
		expect(parseHostnames(undefined)).toEqual([]);
		expect(parseHostnames('')).toEqual([]);
	});
});
