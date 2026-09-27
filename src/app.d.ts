// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { SessionUser } from '$lib/server/auth';
import type { Team } from '$lib/teams';

// Prism language/plugin packages ship without type declarations.
declare module 'prismjs/components/*';
declare module 'prism-svelte';

declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		interface Locals {
			/** Signed-in Google account, decoded from the session cookie. */
			user: SessionUser | null;
			/** Whether `user`'s email may edit at least one team (recomputed per request). */
			canEdit: boolean;
			/** Teams `user` is allowed to edit, in display order (empty when signed out). */
			editableTeams: Team[];
		}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
