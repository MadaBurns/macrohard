import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

const ORIGIN = 'https://macrohard.nz';

const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('static routes through the Worker (run_worker_first)', () => {
	it('serves the front page', async () => {
		const res = await SELF.fetch(`${ORIGIN}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		expect(await res.text()).toContain('runs itself');
	});

	it('serves /method via the assets binding', async () => {
		const res = await SELF.fetch(`${ORIGIN}/method`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Co-Authored-By');
	});

	it('renders the front page for a permalink path', async () => {
		const res = await SELF.fetch(`${ORIGIN}/s/abcdefgh`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('id="staff-form"');
	});

	it('returns the 404 page with a 404 status for unknown paths', async () => {
		const res = await SELF.fetch(`${ORIGIN}/definitely-not-here`);
		expect(res.status).toBe(404);
		expect(await res.text()).toContain('Nothing here');
	});

	it('redirects www even for asset paths', async () => {
		const res = await SELF.fetch('https://www.macrohard.nz/method', { redirect: 'manual' });
		expect(res.status).toBe(301);
		expect(res.headers.get('location')).toBe('https://macrohard.nz/method');
	});

	it('hero claims only what the receipts support', async () => {
		const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
		expect(html).toContain('Headcount: <em>one</em>.');
		expect(html).not.toContain('review each other');
		expect(html).not.toContain('mostly watches');
		expect(html).not.toContain('Every figure on this page links to the public commit');
		expect(html).toContain('every line of the ledger links to the commit that proves it');
	});
});
