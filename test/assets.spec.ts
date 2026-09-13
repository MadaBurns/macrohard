import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { FALLBACK_ORGS } from '../src/staff';

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

	it('renders the front page for a minted permalink path', async () => {
		await env.KV.put('s:abcdefgh', JSON.stringify({ id: 'abcdefgh', query: 'x', org: FALLBACK_ORGS.generic, mode: 'ai', createdAt: '' }));
		const res = await SELF.fetch(`${ORIGIN}/s/abcdefgh`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('id="staff-form"');
	});

	it('returns the 404 page with a 404 status for unknown paths', async () => {
		const res = await SELF.fetch(`${ORIGIN}/definitely-not-here`);
		expect(res.status).toBe(404);
		const html = await res.text();
		expect(html).toContain('qualified opinion');
		expect(html).toContain('<code data-path>');
		expect(html).toContain('src="/404.js"');
		expect(html).not.toContain('<script>');
	});

	it('serves the 404 path filler as a static asset', async () => {
		const res = await SELF.fetch(`${ORIGIN}/404.js`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('location.pathname');
	});

	it('the Scope list matches the configured repositories, in number and in name', async () => {
		const res = await SELF.fetch(`${ORIGIN}/method`);
		expect(res.status).toBe(200);
		const html = await res.text();
		// Scope only: the Source section and the footer link to this repo as well.
		const scope = html.slice(html.indexOf('id="scope"'), html.indexOf('id="commits"'));
		expect(scope.length).toBeGreaterThan(0);
		const repos = env.GITHUB_REPOS.split(',')
			.map((r) => r.trim())
			.filter(Boolean);
		// Every configured repo is listed...
		for (const repo of repos) expect(scope).toContain(`https://github.com/${env.GITHUB_OWNER}/${repo}"`);
		// ...and nothing else is, so a repo dropped from the config cannot linger on the page.
		expect(scope.match(/https:\/\/github\.com\/[^"]+/g) ?? []).toHaveLength(repos.length);
		// The prose count is the figure that actually drifted: it said three while four were configured.
		const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
		expect(words[repos.length]).toBeDefined();
		expect(scope.toLowerCase()).toContain(`${words[repos.length]} public repositories`);
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
		const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
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

	it('has principal risks, a cautionary statement, and subsequent events as Note 9', async () => {
		const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
		expect(html).toContain('Note 8 — Principal risks and uncertainties');
		expect(html).toContain('Note 9 — Subsequent events');
		expect(html).not.toContain('Note 3 — Subsequent events');
		expect(html).toContain('This report contains none.');
		expect(html).toContain('data-n="8.7"');
	});

	it('describes the spent-budget fallback as the code serves it: one proposal, not a choice of five', async () => {
		// Past the cap the route serves FALLBACK_ORGS.generic only, because no guard
		// has seen the query. "One of five" is the model-failure path, not this one.
		const home = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
		expect(home).not.toContain('one of five standing proposals');
		expect(home).toContain('later visitors receive a standing proposal');
		const method = flat(await (await SELF.fetch(`${ORIGIN}/method`)).text());
		expect(method).not.toContain('budget is spent, one of five');
		expect(method).toContain('the generic one is served and your text is not stored');
	});

	it('carries the live band, and the band never ships a figure the page has not fetched', async () => {
		const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
		expect(html).toContain('id="live"');
		expect(html).toContain('id="live-dot"');
		expect(html).toContain('id="live-facts"');
		// Hidden until the first snapshot lands: an empty band is worse than none.
		expect(html).toMatch(/<div class="live" id="live" hidden>/);
		// The ceilings are configuration; hard-coding them into the markup is how they go stale.
		expect(html).not.toContain(env.STAFF_DAILY_CAP);
	});

	it('carries Note 10 with the cycle diagram and a run strip of provable figures', async () => {
		const html = flat(await (await SELF.fetch(`${ORIGIN}/`)).text());
		expect(html).toContain('Note 10 — Operations');
		expect(html).toContain('id="operations"');
		expect(html).toContain('is one of the four it counts');
		for (const hook of ['data-r="runAt"', 'data-r="runRepos"', 'data-r="runWindow"', 'data-r="runCommits"', 'data-r="runNext"']) {
			expect(html).toContain(hook);
		}
		// Notes run in order; Note 10 comes after Note 9.
		expect(html.indexOf('Note 9 — Subsequent events')).toBeLessThan(html.indexOf('Note 10 — Operations'));
	});

	it('serves /operations with all ten gates and no restated ceiling', async () => {
		const res = await SELF.fetch(`${ORIGIN}/operations`);
		expect(res.status).toBe(200);
		const html = flat(await res.text());
		expect(html).toContain('Ten gates');
		for (const n of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
			expect(html).toContain(`class="gate-n">${n}<`);
		}
		expect(html).toContain('Refuse');
		expect(html).toContain('Degrade');
		expect(html).toContain('Skip');
		// Same rule as the band: the numbers live in config, not in prose.
		expect(html).not.toContain(env.STAFF_DAILY_CAP);
		expect(html).not.toContain(env.OG_DAILY_CAP);
		expect(html).not.toContain('<script>');
	});

	it('generic share card is the headcount card and ships as a 1200x630 PNG', async () => {
		const html = await (await SELF.fetch(`${ORIGIN}/og.html`)).text();
		expect(html).toContain('Headcount, human');
		expect(html).toContain('Headcount, agent');
		expect(html).toContain('href="og.css"');
		const png = await SELF.fetch(`${ORIGIN}/og.png`);
		expect(png.status).toBe(200);
		expect(png.headers.get('content-type')).toContain('image/png');
		const bytes = new Uint8Array(await png.arrayBuffer());
		// IHDR width/height are big-endian at bytes 16..23.
		const dv = new DataView(bytes.buffer);
		expect(dv.getUint32(16)).toBe(1200);
		expect(dv.getUint32(20)).toBe(630);
	});
});
