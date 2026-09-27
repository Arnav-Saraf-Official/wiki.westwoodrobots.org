/** Site name shown in browser tab titles. */
export const SITE_NAME = 'WWRobo Wiki';

/** Formats a browser tab title as `Page — WWRobo Wiki`, or the bare site name. */
export function pageTitle(page?: string | null): string {
	const trimmed = page?.trim();
	return trimmed ? `${trimmed} — ${SITE_NAME}` : SITE_NAME;
}
