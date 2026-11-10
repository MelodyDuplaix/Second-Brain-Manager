import { CalendarRole } from '../models/googleCalendar';
import { TaskPriority } from '../models/task';
import { MatrixQuadrant } from '../adapters/matrixAdapter';

/* ==========================================================================
   Filtres du calendrier : ce qui est affiché, préréglages intégrés et personnels
   ========================================================================== */

export interface CalendarFilter {
	showTasks: boolean;
	showEvents: boolean;
	showEntries: boolean;
	showDone: boolean;
	/** Rôles d'agendas Google masqués (ex. tous les agendas secondaires) */
	hiddenRoles: CalendarRole[];
	/** Agendas Google masqués un par un */
	hiddenCalendars: string[];
	/** Catégories de tâches gardées (quadrants ou priorités) ; vide : toutes */
	taskGroups: string[];
}

export interface CalendarFilterPreset {
	id: string;
	name: string;
	filter: CalendarFilter;
	icon?: string;
	builtin?: boolean;
}

export const DEFAULT_CALENDAR_FILTER: CalendarFilter = {
	showTasks: true,
	showEvents: true,
	showEntries: true,
	showDone: true,
	hiddenRoles: [],
	hiddenCalendars: [],
	taskGroups: []
};

const all = (patch: Partial<CalendarFilter>): CalendarFilter => ({ ...DEFAULT_CALENDAR_FILTER, ...patch });

export const BUILTIN_FILTER_PRESETS: CalendarFilterPreset[] = [
	{ id: 'builtin:all', name: 'Tout', icon: 'layers', builtin: true, filter: all({}) },
	{ id: 'builtin:mine', name: 'Mon agenda', icon: 'user', builtin: true, filter: all({ hiddenRoles: ['secondary', 'other_person'] }) },
	{ id: 'builtin:tasks', name: 'Tâches', icon: 'list-checks', builtin: true, filter: all({ showEvents: false, showEntries: false }) },
	{ id: 'builtin:events', name: 'Rendez-vous', icon: 'calendar', builtin: true, filter: all({ showTasks: false }) },
	{ id: 'builtin:todo', name: 'À faire', icon: 'circle', builtin: true, filter: all({ showDone: false, showEvents: false }) }
];

/** Préréglages qui n'ont de sens qu'avec Google Agenda connecté */
export const GOOGLE_ONLY_PRESETS = new Set(['builtin:mine', 'builtin:events']);

const copyPreset = (p: CalendarFilterPreset): CalendarFilterPreset => ({
	...p,
	filter: { ...p.filter, hiddenRoles: [...p.filter.hiddenRoles], hiddenCalendars: [...p.filter.hiddenCalendars], taskGroups: [...p.filter.taskGroups] }
});

/**
 * Liste modifiable des préréglages : les préréglages par défaut y sont copiés une seule fois
 * (première utilisation), devant ceux de l'utilisateur. Ils se renomment, se modifient et se suppriment ensuite librement.
 */
export function seedFilterPresets(stored: CalendarFilterPreset[] | undefined): CalendarFilterPreset[] {
	const list = (stored || []).map(p => ({ ...p, filter: normalizeFilter(p.filter) }));
	const ids = new Set(list.map(p => p.id));
	return [...BUILTIN_FILTER_PRESETS.filter(p => !ids.has(p.id)).map(copyPreset), ...list];
}

/** Rétablit un préréglage par défaut (nom, icône, filtres) ; absent de la liste, il y est remis à sa place d'origine. */
export function restoreDefaultPreset(list: CalendarFilterPreset[], id: string): CalendarFilterPreset[] {
	const original = BUILTIN_FILTER_PRESETS.find(p => p.id === id);
	if (!original) return list;
	if (list.some(p => p.id === id)) return list.map(p => p.id === id ? copyPreset(original) : p);
	// Réinsertion avant le premier préréglage par défaut qui le suit dans l'ordre d'origine
	const order = BUILTIN_FILTER_PRESETS.map(p => p.id);
	const after = order.slice(order.indexOf(id) + 1);
	const idx = list.findIndex(p => after.includes(p.id));
	const next = [...list];
	next.splice(idx === -1 ? next.filter(p => p.builtin).length : idx, 0, copyPreset(original));
	return next;
}

/** Rétablit tous les préréglages par défaut, en gardant ceux de l'utilisateur. */
export function restoreAllDefaultPresets(list: CalendarFilterPreset[]): CalendarFilterPreset[] {
	return BUILTIN_FILTER_PRESETS.reduce((acc, p) => restoreDefaultPreset(acc, p.id), list);
}

/** Le préréglage par défaut a-t-il été modifié (nom ou filtres) ? */
export function isPresetModified(preset: CalendarFilterPreset): boolean {
	const original = BUILTIN_FILTER_PRESETS.find(p => p.id === preset.id);
	return Boolean(original && (original.name !== preset.name || !sameFilter(original.filter, preset.filter)));
}

export const ROLE_LABELS: Record<Exclude<CalendarRole, 'ignore'>, string> = {
	primary: 'Principal',
	secondary: 'Secondaires',
	other_person: 'Autres personnes'
};

const ROLE_HIDDEN_LABELS: Record<Exclude<CalendarRole, 'ignore'>, string> = {
	primary: 'Sans agenda principal',
	secondary: 'Sans secondaires',
	other_person: 'Sans autres personnes'
};

const ROLES: CalendarRole[] = ['primary', 'secondary', 'other_person'];

const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Filtre complet et valide à partir de données enregistrées (anciennes versions comprises). */
export function normalizeFilter(raw: unknown): CalendarFilter {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const bool = (key: keyof CalendarFilter) => typeof r[key] === 'boolean' ? r[key] as boolean : DEFAULT_CALENDAR_FILTER[key] as boolean;
	return {
		showTasks: bool('showTasks'),
		showEvents: bool('showEvents'),
		showEntries: bool('showEntries'),
		showDone: bool('showDone'),
		hiddenRoles: strings(r.hiddenRoles).filter((x): x is CalendarRole => (ROLES as string[]).includes(x)),
		hiddenCalendars: strings(r.hiddenCalendars),
		taskGroups: strings(r.taskGroups)
	};
}

const sorted = (list: string[]) => [...new Set(list)].sort().join('\u0000');

export function sameFilter(a: CalendarFilter, b: CalendarFilter): boolean {
	return a.showTasks === b.showTasks
		&& a.showEvents === b.showEvents
		&& a.showEntries === b.showEntries
		&& a.showDone === b.showDone
		&& sorted(a.hiddenRoles) === sorted(b.hiddenRoles)
		&& sorted(a.hiddenCalendars) === sorted(b.hiddenCalendars)
		&& sorted(a.taskGroups) === sorted(b.taskGroups);
}

/* ----- Catégories de tâches : quadrants, ou priorités si les quadrants sont désactivés ----- */

export interface TaskGroupOption {
	key: string;
	label: string;
	/** Variable CSS de la couleur de la catégorie */
	color: string;
}

const PRIORITY_ORDER: Array<[Exclude<TaskPriority, 'normal'>, string]> = [
	['highest', '🔺 Maximale'], ['high', '⏫ Haute'], ['medium', '🔼 Moyenne'], ['low', '🔽 Basse'], ['lowest', '⏬ Minimale']
];

export function taskGroupOptions(matrixEnabled: boolean): TaskGroupOption[] {
	if (matrixEnabled) {
		return [
			{ key: 'q1', label: 'Q1', color: 'var(--tcal-q1)' },
			{ key: 'q2', label: 'Q2', color: 'var(--tcal-q2)' },
			{ key: 'q3', label: 'Q3', color: 'var(--tcal-q3)' },
			{ key: 'q4', label: 'Q4', color: 'var(--tcal-q4)' },
			{ key: 'none', label: 'Sans quadrant', color: 'var(--tcal-task)' }
		];
	}
	return [
		...PRIORITY_ORDER.map(([p, label]) => ({ key: `prio:${p}`, label, color: `var(--tcal-prio-${p})` })),
		{ key: 'none', label: 'Sans priorité', color: 'var(--tcal-task)' }
	];
}

export function taskGroupKey(priority: TaskPriority | undefined, quad: MatrixQuadrant, matrixEnabled: boolean): string {
	if (matrixEnabled) return quad || 'none';
	return priority && priority !== 'normal' ? `prio:${priority}` : 'none';
}

/** Catégories retenues pour le mode actuel (null : aucun filtre sur les catégories). */
export function activeTaskGroups(filter: CalendarFilter, matrixEnabled: boolean): Set<string> | null {
	const valid = new Set(taskGroupOptions(matrixEnabled).map(o => o.key));
	const kept = filter.taskGroups.filter(k => valid.has(k));
	return kept.length ? new Set(kept) : null;
}

export function isCalendarVisible(filter: CalendarFilter, calendarId: string, role: CalendarRole | undefined): boolean {
	if (filter.hiddenCalendars.includes(calendarId)) return false;
	return !(role && filter.hiddenRoles.includes(role));
}

/** Coche ou décoche un agenda, même si tout son rôle était masqué (les autres agendas du rôle restent masqués). */
export function toggleCalendarInFilter(filter: CalendarFilter, calendarId: string, legend: Array<{ id: string; role: CalendarRole }>): CalendarFilter {
	const role = legend.find(l => l.id === calendarId)?.role;
	const hidden = new Set(filter.hiddenCalendars);
	let hiddenRoles = filter.hiddenRoles;
	if (role && hiddenRoles.includes(role)) {
		hiddenRoles = hiddenRoles.filter(r => r !== role);
		legend.filter(l => l.role === role && l.id !== calendarId).forEach(l => hidden.add(l.id));
		hidden.delete(calendarId);
	} else if (hidden.has(calendarId)) {
		hidden.delete(calendarId);
	} else {
		hidden.add(calendarId);
	}
	return { ...filter, hiddenRoles, hiddenCalendars: [...hidden], showEvents: true };
}

/** N'affiche que cet agenda. */
export function soloCalendar(filter: CalendarFilter, calendarId: string, legend: Array<{ id: string }>): CalendarFilter {
	return { ...filter, showEvents: true, hiddenRoles: [], hiddenCalendars: legend.map(l => l.id).filter(id => id !== calendarId) };
}

export function toggleRoleInFilter(filter: CalendarFilter, role: CalendarRole, legend: Array<{ id: string; role: CalendarRole }>): CalendarFilter {
	const roleIds = new Set(legend.filter(l => l.role === role).map(l => l.id));
	const visible = !filter.hiddenRoles.includes(role) && [...roleIds].some(id => !filter.hiddenCalendars.includes(id));
	return {
		...filter,
		showEvents: true,
		hiddenRoles: visible ? [...filter.hiddenRoles, role] : filter.hiddenRoles.filter(r => r !== role),
		// Réafficher un rôle réaffiche tous ses agendas
		hiddenCalendars: visible ? filter.hiddenCalendars : filter.hiddenCalendars.filter(id => !roleIds.has(id))
	};
}

/* ----- Résumé des filtres actifs (pastilles retirables) ----- */

export interface FilterChip {
	id: string;
	/** Libellé court (une pastille doit tenir dans la barre latérale) */
	label: string;
	icon: string;
	/** Détail complet, affiché en infobulle */
	detail?: string;
}

export function describeFilter(
	filter: CalendarFilter,
	ctx: { matrixEnabled: boolean; googleReady: boolean; entriesAvailable: boolean; legend: Array<{ id: string; name: string; role: CalendarRole }> }
): FilterChip[] {
	const chips: FilterChip[] = [];
	if (!filter.showTasks) chips.push({ id: 'tasks', label: 'Sans tâches', icon: 'list-checks' });
	if (!filter.showDone) chips.push({ id: 'done', label: 'Terminées masquées', icon: 'check-circle-2' });
	if (filter.showTasks) {
		const groups = activeTaskGroups(filter, ctx.matrixEnabled);
		if (groups) {
			const labels = taskGroupOptions(ctx.matrixEnabled).filter(o => groups.has(o.key)).map(o => o.label);
			const kind = ctx.matrixEnabled ? 'quadrants' : 'priorités';
			chips.push({
				id: 'groups',
				label: labels.length <= 2 ? labels.join(', ') : `${labels.length} ${kind}`,
				detail: labels.join(', '),
				icon: ctx.matrixEnabled ? 'grid-2x2' : 'flag'
			});
		}
	}
	if (ctx.entriesAvailable && !filter.showEntries) chips.push({ id: 'entries', label: 'Sans entrées', icon: 'clock' });
	if (ctx.googleReady) {
		if (!filter.showEvents) {
			chips.push({ id: 'events', label: 'Sans événements', icon: 'calendar-off' });
		} else {
			const present = new Set(ctx.legend.map(l => l.role));
			for (const role of filter.hiddenRoles) {
				if (role === 'ignore' || !present.has(role)) continue;
				chips.push({ id: `role:${role}`, label: ROLE_HIDDEN_LABELS[role], icon: 'eye-off' });
			}
			const hiddenOne = ctx.legend.filter(l => filter.hiddenCalendars.includes(l.id) && !filter.hiddenRoles.includes(l.role));
			if (hiddenOne.length === 1) chips.push({ id: 'calendars', label: `${hiddenOne[0].name} masqué`, icon: 'eye-off' });
			else if (hiddenOne.length > 1) chips.push({ id: 'calendars', label: `${hiddenOne.length} agendas masqués`, icon: 'eye-off' });
		}
	}
	return chips;
}

/** Retire la partie du filtre correspondant à une pastille. */
export function clearFilterChip(filter: CalendarFilter, chipId: string, legend: Array<{ id: string; role: CalendarRole }>): CalendarFilter {
	switch (chipId) {
		case 'tasks': return { ...filter, showTasks: true };
		case 'done': return { ...filter, showDone: true };
		case 'groups': return { ...filter, taskGroups: [] };
		case 'entries': return { ...filter, showEntries: true };
		case 'events': return { ...filter, showEvents: true };
		case 'calendars': {
			const roles = new Set(filter.hiddenRoles);
			const visibleRoleIds = new Set(legend.filter(l => !roles.has(l.role)).map(l => l.id));
			return { ...filter, hiddenCalendars: filter.hiddenCalendars.filter(id => !visibleRoleIds.has(id)) };
		}
	}
	if (chipId.startsWith('role:')) {
		const role = chipId.slice(5) as CalendarRole;
		const roleIds = new Set(legend.filter(l => l.role === role).map(l => l.id));
		return { ...filter, hiddenRoles: filter.hiddenRoles.filter(r => r !== role), hiddenCalendars: filter.hiddenCalendars.filter(id => !roleIds.has(id)) };
	}
	return filter;
}

export function newPresetId(): string {
	return `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
