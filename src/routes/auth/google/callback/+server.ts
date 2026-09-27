import {
	exchangeCodeForUser,
	SESSION_COOKIE,
	sessionCookieOptions,
	signSession,
	verifyState,
	STATE_COOKIE
} from '$lib/server/auth';
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** OAuth callback: validates state, resolves the Google identity, sets the session. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const stateCookie = cookies.get(STATE_COOKIE);
	cookies.delete(STATE_COOKIE, { path: '/auth' });

	const returnTo = verifyState(stateCookie, url.searchParams.get('state'));
	if (!returnTo) {
		error(400, 'Sign-in could not be verified (state mismatch). Please try again.');
	}

	const oauthError = url.searchParams.get('error');
	if (oauthError) {
		error(400, `Google sign-in was not completed: ${oauthError}`);
	}

	const code = url.searchParams.get('code');
	if (!code) {
		error(400, 'Google sign-in failed: no authorization code was returned.');
	}

	const user = await exchangeCodeForUser(url.origin, code);
	cookies.set(SESSION_COOKIE, await signSession(user), {
		...sessionCookieOptions,
		secure: url.protocol === 'https:'
	});
	redirect(303, returnTo);
};
