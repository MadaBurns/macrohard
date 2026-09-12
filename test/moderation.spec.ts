import { describe, expect, it } from 'vitest';
import { FALLBACK_ORGS, GUARD_MODEL, moderateOrg, moderateQuery, orgToText, parseGuard } from '../src/staff';
import type { AiLike } from '../src/env';

const fakeAi = (reply: unknown | Error): AiLike & { calls: Array<{ model: string; input: Record<string, unknown> }> } => {
	const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
	return {
		calls,
		async run(model, input) {
			calls.push({ model, input });
			if (reply instanceof Error) throw reply;
			return reply;
		},
	};
};

describe('parseGuard', () => {
	it('reads Llama Guard text verdicts, tolerating whitespace and casing', () => {
		expect(parseGuard({ response: '\n\nsafe' })).toBe('safe');
		expect(parseGuard({ response: 'unsafe\nS10' })).toBe('unsafe');
		expect(parseGuard({ response: ' SAFE ' })).toBe('safe');
		expect(parseGuard('unsafe')).toBe('unsafe');
	});

	it('is unknown for anything else', () => {
		expect(parseGuard({ response: '' })).toBe('unknown');
		expect(parseGuard(undefined)).toBe('unknown');
		expect(parseGuard({ nope: 1 })).toBe('unknown');
	});
});

describe('moderateQuery', () => {
	it('sends the query as a single user turn to the guard model', async () => {
		const ai = fakeAi({ response: 'safe' });
		expect(await moderateQuery(ai, 'A newsroom')).toBe('safe');
		expect(ai.calls[0].model).toBe(GUARD_MODEL);
		expect(ai.calls[0].input.messages).toEqual([{ role: 'user', content: 'A newsroom' }]);
	});

	it('flags unsafe and degrades to unknown on error rather than throwing', async () => {
		expect(await moderateQuery(fakeAi({ response: 'unsafe\nS1' }), 'x')).toBe('unsafe');
		expect(await moderateQuery(fakeAi(new Error('boom')), 'x')).toBe('unknown');
	});
});

describe('moderateOrg', () => {
	it('checks the generated org as the assistant turn after the query', async () => {
		const ai = fakeAi({ response: 'safe' });
		const org = FALLBACK_ORGS.agency;
		expect(await moderateOrg(ai, 'An agency', org)).toBe('safe');
		const msgs = ai.calls[0].input.messages as Array<{ role: string; content: string }>;
		expect(msgs[0]).toEqual({ role: 'user', content: 'An agency' });
		expect(msgs[1].role).toBe('assistant');
		expect(msgs[1].content).toBe(orgToText(org));
	});

	it('renders every role into the text the guard sees', () => {
		const text = orgToText(FALLBACK_ORGS.newsroom);
		for (const r of FALLBACK_ORGS.newsroom.roles) expect(text).toContain(r.standsInFor);
		expect(text).toContain('USD 241 per day');
	});
});
