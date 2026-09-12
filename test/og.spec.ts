import { describe, expect, it } from 'vitest';
import { escapeHtml, ogCardHtml, shareDescription, shareText, shareTitle } from '../src/og';
import { FALLBACK_ORGS } from '../src/staff';

describe('share copy', () => {
	it('title carries the headline numbers', () => {
		expect(shareTitle(FALLBACK_ORGS.saas)).toBe('A 200-person SaaS company — 10 agents, USD 412/day');
	});

	it('description leads with the first "stands in for" line', () => {
		const d = shareDescription(FALLBACK_ORGS.saas);
		expect(d).toContain('Principal Agent stands in for VP Engineering');
		expect(d).toContain('5 roles');
	});

	it('share text stays short enough for a post with a link', () => {
		for (const org of Object.values(FALLBACK_ORGS)) expect(shareText(org).length).toBeLessThan(220);
	});
});

describe('ogCardHtml', () => {
	it('escapes everything that came from the model', () => {
		const org = { ...FALLBACK_ORGS.generic, title: '<script>alert(1)</script> & "co"', roles: [...FALLBACK_ORGS.generic.roles] };
		org.roles[0] = { ...org.roles[0], standsInFor: "<img src=x onerror='1'>" };
		const html = ogCardHtml(org);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp; &quot;co&quot;');
		expect(html).not.toContain('<img');
	});

	it('shows at most four roles and a smaller title size for long titles', () => {
		const html = ogCardHtml(FALLBACK_ORGS.saas);
		expect(html.match(/class="row"/g)).toHaveLength(4);
		expect(html).toContain('font-size:66px');
		expect(ogCardHtml({ ...FALLBACK_ORGS.saas, title: 'x'.repeat(60) })).toContain('font-size:52px');
	});

	it('escapeHtml covers the five characters', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
	});
});
