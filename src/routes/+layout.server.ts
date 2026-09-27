import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user,
	canEdit: locals.canEdit,
	editableTeams: locals.editableTeams
});
