import { describe, expect, it } from 'vitest';

/**
 * Guards the guard. If test/setup.ts stops being applied to every spec file, this
 * fails — rather than the suite quietly starting to talk to the real internet (or
 * to the real, billed Workers AI binding) and nobody noticing until the invoice.
 */
describe('the test harness itself', () => {
	it('refuses outbound network, so hermeticity is not a matter of remembering', async () => {
		await expect(fetch('https://api.github.com/rate_limit')).rejects.toThrow();
	});
});
