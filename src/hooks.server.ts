import { editableTeams, isEditor, readSession, SESSION_COOKIE } from '$lib/server/auth';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const user = await readSession(event.cookies.get(SESSION_COOKIE));
	event.locals.user = user;
	event.locals.canEdit = isEditor(user?.email);
	event.locals.editableTeams = editableTeams(user?.email);
	return resolve(event);
};
