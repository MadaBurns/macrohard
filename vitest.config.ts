import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Hermetic: anything that would leave the sandbox is either mocked (fetchMock)
// or reached through an injected fake. No remote bindings are configured.
export default defineWorkersConfig({
	test: {
		include: ['test/**/*.spec.ts'],
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
