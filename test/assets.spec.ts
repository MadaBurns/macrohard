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

	it('the generator never convenes a board in a company with no meetings', async () => {
		const js = await (await SELF.fetch(`${ORIGIN}/app.js`)).text();
		expect(js).not.toContain('Convening the board');
		expect(js).not.toContain('reconvene');
		expect(js).not.toContain('That would be news');
		expect(js).toContain('Costing the proposal');
		const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
		expect(html).not.toContain("staff's morale");
		expect(html).toContain('They were produced by a language model from your description.');
	});

	it('method page states only provable scope and headcount', async () => {
		const html = flat(await (await SELF.fetch(`${ORIGIN}/method`)).text());
		expect(html).toContain('Four public repositories');
		expect(html).not.toContain('Three public repositories');
		expect(html).not.toContain('one human maintainer with commit access');
		expect(html).toContain('One human has committed to these repositories in the window');
		expect(html).not.toContain('counted as human');
		expect(html).toContain('counted as not agent-authored');
		expect(html).toContain('id="segments"');
		expect(html).toContain('id="notes"');
	});

	it('carries Notes 3 to 7 with their live hooks', async () => {
		const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
		for (const s of [
			'Note 3 — Segment information',
			'Note 4 — Basis of preparation',
			'Note 5 — Related parties',
			'Note 6 — Key management personnel',
			'Note 7 — Off-balance-sheet arrangements',
			'id="segment-rows"',
			'id="tpl-segment-row"',
			'data-self="macrohard"',
			'id="kmp-list"',
			'data-r="segShare"',
		]) {
			expect(html).toContain(s);
		}
	});
});
