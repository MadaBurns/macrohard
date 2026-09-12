import { describe, expect, it } from 'vitest';
import { BLOCKED_CATEGORIES, parseGuard } from '../src/staff';

describe('parseGuard category filter', () => {
	it('blocks the categories that matter here', () => {
		for (const c of BLOCKED_CATEGORIES) expect(parseGuard({ response: `\n\nunsafe\n${c}` })).toBe('unsafe');
	});

	it('lets S7 (privacy) through — it fires on any long digit run', () => {
		expect(parseGuard({ response: '\n\nunsafe\nS7' })).toBe('safe');
	});

	it('ignores the other non-relevant categories', () => {
		for (const c of ['S2', 'S6', 'S8', 'S13', 'S14']) expect(parseGuard({ response: `unsafe\n${c}` })).toBe('safe');
	});

	it('blocks when any listed category is blocked, in either separator style', () => {
		expect(parseGuard({ response: 'unsafe\nS7,S10' })).toBe('unsafe');
		expect(parseGuard({ response: 'unsafe\nS7 S1' })).toBe('unsafe');
		expect(parseGuard({ response: 'unsafe\nS7,S8' })).toBe('safe');
	});

	it('treats a bare "unsafe" with no category as unsafe', () => {
		expect(parseGuard({ response: 'unsafe' })).toBe('unsafe');
		expect(parseGuard({ response: 'unsafe\n' })).toBe('unsafe');
	});

	it('still reads safe and unknown', () => {
		expect(parseGuard({ response: '\n\nsafe' })).toBe('safe');
		expect(parseGuard({ response: 'hmm' })).toBe('unknown');
		expect(parseGuard(undefined)).toBe('unknown');
	});
});
