import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { consumeDailyCap, dayKey } from '../src/limits';

const DAY = new Date('2030-03-01T00:00:00Z');

beforeEach(async () => {
	await env.KV.delete(dayKey(DAY, 'ogcap'));
	await env.KV.delete(dayKey(DAY));
});

describe('separate daily budgets', () => {
	it('keeps the og render budget in its own keyspace', () => {
		expect(dayKey(DAY, 'ogcap')).toBe('ogcap:2030-03-01');
		expect(dayKey(DAY)).toBe('cap:2030-03-01');
	});

	it('spending the AI cap does not spend the render budget', async () => {
		await consumeDailyCap(env.KV, DAY, 1);
		expect((await consumeDailyCap(env.KV, DAY, 1)).allowed).toBe(false);
		expect((await consumeDailyCap(env.KV, DAY, 1, 'ogcap')).allowed).toBe(true);
	});

	it('a zero render budget switches share-image rendering off', async () => {
		expect((await consumeDailyCap(env.KV, DAY, 0, 'ogcap')).allowed).toBe(false);
	});
});

describe('per-id render lock', () => {
	it('the lock key is what a second concurrent viewer would see', async () => {
		const id = 'abcdefgh';
		expect(await env.KV.get(`oglock:${id}`)).toBeNull();
		await env.KV.put(`oglock:${id}`, '1', { expirationTtl: 120 });
		expect(await env.KV.get(`oglock:${id}`)).toBe('1');
		await env.KV.delete(`oglock:${id}`);
	});
});
