/**
 * Hermeticity by construction, not by convention.
 *
 * Every spec file gets the outbound-network kill switch, so no test can reach the
 * real internet even by accident. Before this, 2 of 14 files asked for it and the
 * other 12 were hermetic only because every author remembered to inject a fake.
 *
 * It also bounds the one binding that costs money. Workers AI runs remotely even
 * under test — the pool warns about it on every run — and a declared `ai` binding
 * cannot be stubbed in this version of the pool: `ai` is its own key in the
 * runtime's worker options with no slot for an implementation, and mutating
 * `env.AI` from a test does not reach the worker under test. Both measured, not
 * assumed. With net connect disabled, a test that reaches the real model hangs
 * and fails on the timeout instead of quietly billing the account.
 *
 * So: inject a fake AI binding (see test/guard-unknown.spec.ts) and never rely on
 * `env.AI`.
 */
import { fetchMock } from 'cloudflare:test';
import { beforeAll } from 'vitest';

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});
