/**
 * Team metadata shared by client and server.
 *
 * The dynamic half of the wiki lives in Apps Script / Google Drive, organized
 * into one folder per team. POST requests address a team by `team` (aliases
 * accepted) plus a path relative to that team's folder — see DOCS.md.
 */

export type TeamId = 'kunai' | 'atl' | 'hunga' | 'sling';

export interface Team {
	/** Stable id used in URLs, query strings and permission checks. */
	id: TeamId;
	/** Canonical Drive folder name (also the `team` value sent to Apps Script). */
	folder: string;
	/** Human label shown in the UI. */
	label: string;
	/** Env var holding the comma-separated list of editors for this team. */
	envKey: string;
	/** Accent color used for the team's name in text. */
	color: string;
	/** Short blurb for the Logs landing page. */
	blurb: string;
}

export const TEAMS: readonly Team[] = [
	{
		id: 'kunai',
		folder: 'KUNAI',
		label: 'Kunai',
		envKey: 'KUNAI_EDITORS',
		color: '#eab308',
		blurb: 'Build logs, match notes and design docs.'
	},
	{
		id: 'atl',
		folder: 'ATLATL',
		label: 'Atlatl',
		envKey: 'ATL_EDITORS',
		color: '#ec4899',
		blurb: 'Build logs, match notes and design docs.'
	},
	{
		id: 'hunga',
		folder: 'HUNGA MUNGA',
		label: 'Hunga Munga',
		envKey: 'HUNGA_EDITORS',
		color: '#22c55e',
		blurb: 'Build logs, match notes and design docs.'
	},
	{
		id: 'sling',
		folder: 'SLINGSHOT',
		label: 'Slingshot',
		envKey: 'SLING_EDITORS',
		color: '#a855f7',
		blurb: 'Build logs, match notes and design docs.'
	}
] as const;

/** Extra accepted spellings per team (matched case/space/punctuation-insensitively). */
const ALIASES: Record<TeamId, string[]> = {
	kunai: ['kunai'],
	atl: ['atlatl', 'atl'],
	hunga: ['hungamunga', 'hunga'],
	sling: ['slingshot', 'sling']
};

/** Env var holding the comma-separated list of accounts allowed to edit any team. */
export const ADMINS_ENV_KEY = 'ADMINS';

function normalize(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, '');
}

/** Looks up a team by URL/`team` value or display name. */
export function findTeam(value: string | null | undefined): Team | undefined {
	if (!value) return undefined;
	const key = normalize(value);
	return TEAMS.find(
		(team) => team.id === key || normalize(team.folder) === key || ALIASES[team.id].includes(key)
	);
}

/** Whether `path` (or its first segment) belongs to a known team. */
export function teamForPath(path: string | null | undefined): Team | undefined {
	if (!path) return undefined;
	const [first] = path.split('/');
	return findTeam(first);
}

/** Normalizes a request path: no leading/trailing slashes, no empty segments. */
export function cleanPath(path: string | null | undefined): string {
	return (path ?? '')
		.replace(/\\/g, '/')
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join('/');
}
