/**
 * Google sign-in + editor permissions (stateless, no dependencies).
 *
 * Flow:
 *   1. `/auth/google` redirects to Google's consent screen, storing a random
 *      `state` value (plus the page to return to) in a short-lived cookie.
 *   2. `/auth/google/callback` validates `state`, exchanges the code for
 *      tokens server-side, and fetches the verified email from Google's
 *      userinfo endpoint.
 *   3. The session is an HMAC-SHA256-signed cookie (`Web Crypto`), so no
 *      server-side session store is needed. It is re-verified on every
 *      request in `hooks.server.ts`.
 *   4. Editor permission = the session email appears in `ADMINS` (all teams)
 *      or in the per-team list (`KUNAI_EDITORS`, `ATL_EDITORS`,
 *      `HUNGA_EDITORS`, `SLING_EDITORS`) — exact, case-insensitive match.
 *      The check runs on every request, so list changes apply without
 *      forcing a re-login. A path is editable when its first segment names
 *      a team the account can edit.
 *
 * Required private env (see .env.example): GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, AUTH_SECRET, ADMINS and the per-team lists.
 */

import { env } from '$env/dynamic/private';
import { ADMINS_ENV_KEY, TEAMS, teamForPath, type Team, type TeamId } from '$lib/teams';
import { error, redirect } from '@sveltejs/kit';

export interface SessionUser {
	/** Google account subject (stable unique id). */
	sub: string;
	email: string;
	name: string;
	picture: string | null;
}

interface SessionPayload extends SessionUser {
	/** Unix millis (UTC) after which the session is invalid. */
	exp: number;
}

export const SESSION_COOKIE = 'wiki_session';
export const STATE_COOKIE = 'wiki_oauth_state';

/** Session lifetime. */
const SESSION_MAX_AGE = 14 * 24 * 60 * 60; // seconds
/** How long the sign-in redirect round-trip may take. */
const STATE_MAX_AGE = 10 * 60; // seconds

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Env access
// ---------------------------------------------------------------------------

function oauthConfig(): { clientId: string; clientSecret: string } {
	const clientId = env.GOOGLE_CLIENT_ID;
	const clientSecret = env.GOOGLE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		error(
			500,
			'Google sign-in is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.'
		);
	}
	return { clientId, clientSecret };
}

function authSecret(): string {
	const secret = env.AUTH_SECRET;
	if (!secret) {
		error(500, 'Google sign-in is not configured: set AUTH_SECRET in .env.');
	}
	return secret;
}

/** Splits a comma-separated env var into lowercased, non-empty addresses. */
function emailList(key: string): string[] {
	return (env[key] ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0);
}

/**
 * Whether `email` appears in the comma-separated list stored under `key`.
 * Exact, case-insensitive match. Fails closed: no list, no match.
 */
export function isListedEmail(email: string | null | undefined, key: string): boolean {
	if (!email) return false;
	return emailList(key).includes(email.trim().toLowerCase());
}

/** Whether the account is an admin (can edit every team). */
export function isAdmin(email: string | null | undefined): boolean {
	return isListedEmail(email, ADMINS_ENV_KEY);
}

/** Whether the account may edit the given team (admins always may). */
export function canEditTeam(email: string | null | undefined, team: Team | TeamId): boolean {
	if (!email) return false;
	if (isAdmin(email)) return true;
	const id = typeof team === 'string' ? team : team.id;
	const match = TEAMS.find((candidate) => candidate.id === id);
	return match ? isListedEmail(email, match.envKey) : false;
}

/**
 * Whether the account may edit a wiki path. The first segment names the team
 * (`KUNAI/logs/match.md`); paths without a recognised team are not editable.
 */
export function canEditPath(
	email: string | null | undefined,
	path: string | null | undefined
): boolean {
	if (!email) return false;
	if (isAdmin(email)) return true;
	const team = teamForPath(path);
	return team ? canEditTeam(email, team) : false;
}

/** Every team the account may edit, in display order. */
export function editableTeams(email: string | null | undefined): Team[] {
	if (!email) return [];
	return TEAMS.filter((team) => canEditTeam(email, team));
}

/**
 * Whether a signed-in account may edit anything. Exact, case-insensitive match
 * against `ADMINS` or any per-team list. Fails closed: no lists, no editors.
 */
export function isEditor(email: string | null | undefined): boolean {
	return editableTeams(email).length > 0;
}

// ---------------------------------------------------------------------------
// Authorization request (step 1)
// ---------------------------------------------------------------------------

/**
 * Builds the Google consent-screen URL and the random `state` value that ties
 * the callback back to this browser. `returnTo` must already be sanitized
 * with {@link safeReturnTo}.
 */ export function buildAuthUrl(origin: string): {
	authUrl: string;
	state: string;
} {
	const { clientId } = oauthConfig();
	authSecret(); // fail fast if sessions cannot be created
	const state = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: `${origin}/auth/google/callback`,
		response_type: 'code',
		scope: 'openid email profile',
		state,
		prompt: 'select_account'
	});
	return { authUrl: `${AUTH_ENDPOINT}?${params.toString()}`, state };
}

/** Only allow same-site absolute paths, to prevent open redirects. */
export function safeReturnTo(value: string | null | undefined): string {
	if (value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
		return value;
	}
	return '/';
}

/**
 * Where to send the browser back to after signing in. An explicit
 * `?returnTo=` wins; otherwise the page that linked to the sign-in flow is
 * used (same-origin only — prevents open redirects).
 */
export function currentReturnTo(url: URL, request: Request): string {
	const explicit = url.searchParams.get('returnTo');
	if (explicit) return safeReturnTo(explicit);

	const referer = request.headers.get('referer');
	if (referer) {
		try {
			const from = new URL(referer);
			if (from.origin === url.origin) return safeReturnTo(from.pathname + from.search);
		} catch {
			// Malformed referer — fall through to the home page.
		}
	}
	return '/';
}

/** Re-checks the `state` cookie against the query parameter (CSRF protection). */
export function verifyState(
	rawCookie: string | undefined,
	queryState: string | null
): string | null {
	if (!rawCookie || !queryState) return null;
	try {
		const parsed = JSON.parse(rawCookie) as { s?: unknown; r?: unknown };
		if (typeof parsed.s !== 'string' || typeof parsed.r !== 'string') {
			return null;
		}
		return parsed.s === queryState ? (parsed.r as string) : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Code exchange + userinfo (step 2)
// ---------------------------------------------------------------------------

/** Exchanges the authorization code and returns the verified Google identity. */
export async function exchangeCodeForUser(origin: string, code: string): Promise<SessionUser> {
	const { clientId, clientSecret } = oauthConfig();
	const redirectUri = `${origin}/auth/google/callback`;

	const tokenResponse = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code'
		})
	});
	if (!tokenResponse.ok) {
		error(500, `Google sign-in failed during token exchange (HTTP ${tokenResponse.status}).`);
	}
	const tokens = (await tokenResponse.json()) as { access_token?: string };
	if (!tokens.access_token) {
		error(500, 'Google sign-in failed: no access token was returned.');
	}

	const userinfoResponse = await fetch(USERINFO_ENDPOINT, {
		headers: { Authorization: `Bearer ${tokens.access_token}` }
	});
	if (!userinfoResponse.ok) {
		error(
			500,
			`Google sign-in failed while fetching the account (HTTP ${userinfoResponse.status}).`
		);
	}
	const profile = (await userinfoResponse.json()) as {
		sub?: unknown;
		email?: unknown;
		email_verified?: unknown;
		name?: unknown;
		picture?: unknown;
	};
	if (
		typeof profile.sub !== 'string' ||
		typeof profile.email !== 'string' ||
		profile.email_verified !== true
	) {
		error(403, 'Google did not return a verified email address for this account.');
	}
	return {
		sub: profile.sub,
		email: profile.email,
		name: typeof profile.name === 'string' && profile.name ? profile.name : profile.email,
		picture: typeof profile.picture === 'string' ? profile.picture : null
	};
}

// ---------------------------------------------------------------------------
// Session cookie (step 3) — HMAC-SHA256 via Web Crypto
// ---------------------------------------------------------------------------

let cachedSecret: string | null = null;
let cachedKey: Promise<CryptoKey> | null = null;

function hmacKey(secret: string): Promise<CryptoKey> {
	if (cachedSecret !== secret || !cachedKey) {
		cachedSecret = secret;
		cachedKey = crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign', 'verify']
		);
	}
	return cachedKey;
}

/** Signs the session cookie value: `v1.<base64url payload>.<base64url signature>`. */
export async function signSession(user: SessionUser): Promise<string> {
	const payload: SessionPayload = { ...user, exp: Date.now() + SESSION_MAX_AGE * 1000 };
	const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
	const signedData = encoder.encode(`v1.${body}`);
	const signature = await crypto.subtle.sign('HMAC', await hmacKey(authSecret()), signedData);
	return `v1.${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verifies and decodes a session cookie value. Returns null for anything
 * invalid, expired, or unsigned — never throws (runs on every request).
 */
export async function readSession(value: string | undefined): Promise<SessionUser | null> {
	const secret = env.AUTH_SECRET;
	if (!value || !secret) return null;

	const parts = value.split('.');
	if (parts.length !== 3 || parts[0] !== 'v1') return null;
	const [, body, signature] = parts;

	try {
		const valid = await crypto.subtle.verify(
			'HMAC',
			await hmacKey(secret),
			fromBase64Url(signature),
			encoder.encode(`v1.${body}`)
		);
		if (!valid) return null;

		const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as Partial<SessionPayload>;
		if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
		if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;

		return {
			sub: payload.sub,
			email: payload.email,
			name: typeof payload.name === 'string' ? payload.name : payload.email,
			picture: typeof payload.picture === 'string' ? payload.picture : null
		};
	} catch {
		return null;
	}
}

/** Cookie options shared by set/delete so the browser matches them up. */
export const sessionCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	maxAge: SESSION_MAX_AGE
};

export const stateCookieOptions = {
	path: '/auth',
	httpOnly: true,
	sameSite: 'lax' as const,
	maxAge: STATE_MAX_AGE
};

// ---------------------------------------------------------------------------
// Guards for protected loads/handlers
// ---------------------------------------------------------------------------

/** Redirects anonymous visitors to Google sign-in, remembering where they were. */
export function requireUser(user: SessionUser | null, returnTo: string): SessionUser {
	if (!user) {
		redirect(303, `/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
	}
	return user;
}

/** Like {@link requireUser}, plus the editor email check (403 otherwise). */
export function requireEditor(user: SessionUser | null, returnTo: string): SessionUser {
	const current = requireUser(user, returnTo);
	if (!isEditor(current.email)) {
		error(403, `The Google account ${current.email} is not authorized to edit this wiki.`);
	}
	return current;
}

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
