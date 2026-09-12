import { describe, expect, it } from 'vitest';
import { nextLink } from '../src/receipts';

const withLink = (link: string) => new Response('[]', { headers: { link } });

describe('nextLink', () => {
	it('returns the rel=next URL on the GitHub API host', () => {
		const res = withLink(
			'<https://api.github.com/repos/o/r/commits?page=2>; rel="next", <https://api.github.com/repos/o/r/commits?page=9>; rel="last"',
		);
		expect(nextLink(res)).toBe('https://api.github.com/repos/o/r/commits?page=2');
	});

	it('ignores a next link that points anywhere else', () => {
		expect(nextLink(withLink('<https://evil.example/x>; rel="next"'))).toBeNull();
		expect(nextLink(withLink('<http://api.github.com/x>; rel="next"'))).toBeNull();
	});

	it('returns null when there is no next', () => {
		expect(nextLink(withLink('<https://api.github.com/x?page=1>; rel="prev"'))).toBeNull();
		expect(nextLink(new Response('[]'))).toBeNull();
	});
});
