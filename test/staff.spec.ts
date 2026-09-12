import { describe, expect, it } from 'vitest';
import {
	FALLBACK_ORGS,
	OrgSchema,
	buildInput,
	cacheKeyText,
	extractJson,
	generateOrg,
	normalizeQuery,
	pickFallback,
	scrub,
	validateQuery,
} from '../src/staff';
import type { AiLike } from '../src/env';

describe('validateQuery', () => {
	it('accepts a short description and normalises whitespace', () => {
		const r = validateQuery('  A   200-person\nSaaS company ');
		expect(r).toEqual({ ok: true, query: 'A 200-person SaaS company' });
	});

	it('rejects non-strings, too-short, links and emails', () => {
		expect(validateQuery(42).ok).toBe(false);
		expect(validateQuery('ab').ok).toBe(false);
		expect(validateQuery('see https://example.com').ok).toBe(false);
		expect(validateQuery('see www.example.com').ok).toBe(false);
		expect(validateQuery('mail me at a@b.co').ok).toBe(false);
	});

	it('caps length at 200 characters', () => {
		const r = validateQuery('x'.repeat(500));
		expect(r.ok && r.query.length).toBe(200);
	});

	it('cache key is case-insensitive', () => {
		expect(cacheKeyText('A Newsroom')).toBe(cacheKeyText('a newsroom'));
		expect(normalizeQuery('a  b')).toBe('a b');
	});
});

describe('OrgSchema + scrub', () => {
	it('every fallback org satisfies the schema', () => {
		for (const org of Object.values(FALLBACK_ORGS)) expect(() => OrgSchema.parse(org)).not.toThrow();
	});

	it('rejects too few roles and out-of-range numbers', () => {
		const base = FALLBACK_ORGS.generic;
		expect(() => OrgSchema.parse({ ...base, roles: base.roles.slice(0, 2) })).toThrow();
		expect(() => OrgSchema.parse({ ...base, agents: 0 })).toThrow();
		expect(() => OrgSchema.parse({ ...base, runRateUsdPerDay: 10.5 })).toThrow();
	});

	it('strips links and emails from model output', () => {
		const dirty = { ...FALLBACK_ORGS.generic, title: 'Visit https://evil.example now', roles: [...FALLBACK_ORGS.generic.roles] };
		dirty.roles[0] = { ...dirty.roles[0], standsInFor: 'contact ceo@corp.example today' };
		const clean = scrub(dirty);
		expect(clean.title).toBe('Visit now');
		expect(clean.roles[0].standsInFor).toBe('contact today');
	});

	it('never leaves a field empty after scrubbing', () => {
		const dirty = { ...FALLBACK_ORGS.generic, cycleTime: 'https://only.a.link' };
		expect(scrub(dirty).cycleTime).toBe('—');
	});
});

describe('pickFallback', () => {
	it('matches on keywords and restates the query as the title', () => {
		expect(pickFallback('a small bank in Dunedin').roles[0].role).toBe(FALLBACK_ORGS.bank.roles[0].role);
		expect(pickFallback('a small bank in Dunedin').title).toBe('a small bank in Dunedin');
		expect(pickFallback('a llama farm').roles).toEqual(FALLBACK_ORGS.generic.roles);
	});
});

describe('extractJson', () => {
	it('handles string responses, object responses, and fenced junk around JSON', () => {
		expect(extractJson({ response: '{"a":1}' })).toEqual({ a: 1 });
		expect(extractJson({ response: { a: 1 } })).toEqual({ a: 1 });
		expect(extractJson({ response: 'Sure! ```json\n{"a":1}\n```' })).toEqual({ a: 1 });
		expect(() => extractJson({ response: 'no json here' })).toThrow();
	});
});

describe('generateOrg', () => {
	const fakeAi = (reply: unknown): AiLike & { calls: unknown[] } => {
		const calls: unknown[] = [];
		return {
			calls,
			async run(_model, input) {
				calls.push(input);
				return reply;
			},
		};
	};

	it('sends the query in JSON mode and returns a validated, scrubbed org', async () => {
		const ai = fakeAi({ response: JSON.stringify({ ...FALLBACK_ORGS.agency, title: 'An agency https://x.y' }) });
		const org = await generateOrg(ai, 'model', 'An agency');
		expect(org.title).toBe('An agency');
		expect(org.roles).toHaveLength(4);
		const input = ai.calls[0] as ReturnType<typeof buildInput>;
		expect((input.response_format as { type: string }).type).toBe('json_schema');
		expect(JSON.stringify(input.messages)).toContain('Organisation: An agency');
	});

	it('throws when the model returns something off-schema, so the caller can fall back', async () => {
		const ai = fakeAi({ response: '{"title":"x","agents":3}' });
		await expect(generateOrg(ai, 'model', 'x')).rejects.toThrow();
	});
});
