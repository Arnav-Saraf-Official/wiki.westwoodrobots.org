import { SESSION_COOKIE } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Signs out by clearing the session cookie (POST so links can't trigger it). */
export const POST: RequestHandler = ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, '/');
};
