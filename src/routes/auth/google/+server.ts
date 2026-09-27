import { buildAuthUrl, currentReturnTo, stateCookieOptions, STATE_COOKIE } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Starts the Google sign-in flow. The `state` value (CSRF protection) and the
 * page to return to after signing in are kept in a short-lived cookie.
 */
export const GET: RequestHandler = ({ url, request, cookies }) => {
	const returnTo = currentReturnTo(url, request);
	const { authUrl, state } = buildAuthUrl(url.origin);

	cookies.set(STATE_COOKIE, JSON.stringify({ s: state, r: returnTo }), {
		...stateCookieOptions,
		secure: url.protocol === 'https:'
	});
	redirect(302, authUrl);
};
