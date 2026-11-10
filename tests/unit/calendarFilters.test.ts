import { describe, it, expect } from 'vitest';
import {
	BUILTIN_FILTER_PRESETS,
	DEFAULT_CALENDAR_FILTER,
	activeTaskGroups,
	clearFilterChip,
	describeFilter,
	isCalendarVisible,
	normalizeFilter,
	sameFilter,
	soloCalendar,
	taskGroupKey,
	toggleCalendarInFilter,
	toggleRoleInFilter
} from '../../src/services/calendarFilters';
import { CalendarRole } from '../../src/models/googleCalendar';

const legend: Array<{ id: string; name: string; role: CalendarRole }> = [
	{ id: 'me', name: 'Moi', role: 'primary' },
	{ id: 'sport', name: 'Sport', role: 'secondary' },
	{ id: 'work', name: 'Travail', role: 'secondary' },
	{ id: 'claire', name: 'Claire', role: 'other_person' }
];
const ctx = { matrixEnabled: true, googleReady: true, entriesAvailable: true, legend };
const visibleIds = (f: typeof DEFAULT_CALENDAR_FILTER) => legend.filter(l => isCalendarVisible(f, l.id, l.role)).map(l => l.id);

describe('filtres du calendrier', () => {
	it('normalizes stored data and ignores unknown values', () => {
		const f = normalizeFilter({ showTasks: false, hiddenRoles: ['secondary', 'nope', 3], taskGroups: ['q1'] });
		expect(f.showTasks).toBe(false);
		expect(f.showEvents).toBe(true);
		expect(f.hiddenRoles).toEqual(['secondary']);
		expect(f.taskGroups).toEqual(['q1']);
	});

	it('compares filters regardless of list order', () => {
		const a = { ...DEFAULT_CALENDAR_FILTER, hiddenCalendars: ['a', 'b'] };
		const b = { ...DEFAULT_CALENDAR_FILTER, hiddenCalendars: ['b', 'a'] };
		expect(sameFilter(a, b)).toBe(true);
		expect(sameFilter(a, DEFAULT_CALENDAR_FILTER)).toBe(false);
	});

	it('hides every secondary calendar in one click, and shows them back', () => {
		const hidden = toggleRoleInFilter(DEFAULT_CALENDAR_FILTER, 'secondary', legend);
		expect(visibleIds(hidden)).toEqual(['me', 'claire']);
		const back = toggleRoleInFilter(hidden, 'secondary', legend);
		expect(visibleIds(back)).toEqual(['me', 'sport', 'work', 'claire']);
	});

	it('shows one calendar of a hidden role without showing the others', () => {
		const hidden = toggleRoleInFilter(DEFAULT_CALENDAR_FILTER, 'secondary', legend);
		const f = toggleCalendarInFilter(hidden, 'sport', legend);
		expect(visibleIds(f)).toEqual(['me', 'sport', 'claire']);
	});

	it('keeps only one calendar with « Seulement »', () => {
		const f = soloCalendar(DEFAULT_CALENDAR_FILTER, 'work', legend);
		expect(visibleIds(f)).toEqual(['work']);
	});

	it('groups tasks by quadrant, or by priority when quadrants are off', () => {
		expect(taskGroupKey('high', 'q2', true)).toBe('q2');
		expect(taskGroupKey('high', null, true)).toBe('none');
		expect(taskGroupKey('high', null, false)).toBe('prio:high');
		expect(taskGroupKey('normal', null, false)).toBe('none');
	});

	it('ignores task categories that do not belong to the current mode', () => {
		const f = { ...DEFAULT_CALENDAR_FILTER, taskGroups: ['q1'] };
		expect(activeTaskGroups(f, true)).toEqual(new Set(['q1']));
		expect(activeTaskGroups(f, false)).toBeNull();
	});

	it('describes active filters as removable chips', () => {
		const f = { ...toggleRoleInFilter(DEFAULT_CALENDAR_FILTER, 'secondary', legend), showDone: false, taskGroups: ['q1', 'q2'] };
		const chips = describeFilter(f, ctx);
		expect(chips.map(c => c.id)).toEqual(['done', 'groups', 'role:secondary']);
		expect(chips.find(c => c.id === 'groups')!.label).toBe('Q1, Q2');
		const cleared = clearFilterChip(f, 'role:secondary', legend);
		expect(visibleIds(cleared)).toEqual(['me', 'sport', 'work', 'claire']);
		expect(describeFilter(DEFAULT_CALENDAR_FILTER, ctx)).toEqual([]);
	});

	it('offers a « Mon agenda » preset that keeps only the main calendar', () => {
		const mine = BUILTIN_FILTER_PRESETS.find(p => p.id === 'builtin:mine')!;
		expect(visibleIds(mine.filter)).toEqual(['me']);
	});
});

describe('préréglages modifiables', () => {
	it('copies the default presets once, in front of the user ones', async () => {
		const { seedFilterPresets } = await import('../../src/services/calendarFilters');
		const mine = { id: 'custom:1', name: 'Perso', filter: { ...DEFAULT_CALENDAR_FILTER, showDone: false } };
		const seeded = seedFilterPresets([mine]);
		expect(seeded.map(p => p.id)).toEqual([...BUILTIN_FILTER_PRESETS.map(p => p.id), 'custom:1']);
		// Une copie : modifier la liste ne touche pas aux préréglages d'origine
		seeded[0].filter.hiddenRoles.push('secondary');
		expect(BUILTIN_FILTER_PRESETS[0].filter.hiddenRoles).toEqual([]);
	});

	it('restores a renamed, edited or deleted default preset', async () => {
		const { seedFilterPresets, restoreDefaultPreset, restoreAllDefaultPresets, isPresetModified } = await import('../../src/services/calendarFilters');
		let list = seedFilterPresets([]);
		list = list.map(p => p.id === 'builtin:mine' ? { ...p, name: 'Mon planning', filter: { ...p.filter, showDone: false } } : p);
		expect(isPresetModified(list.find(p => p.id === 'builtin:mine')!)).toBe(true);
		list = restoreDefaultPreset(list, 'builtin:mine');
		expect(list.find(p => p.id === 'builtin:mine')!.name).toBe('Mon agenda');

		const withoutTasks = list.filter(p => p.id !== 'builtin:tasks');
		const restored = restoreAllDefaultPresets([...withoutTasks, { id: 'custom:x', name: 'X', filter: DEFAULT_CALENDAR_FILTER }]);
		expect(restored.map(p => p.id)).toEqual([...BUILTIN_FILTER_PRESETS.map(p => p.id), 'custom:x']);
	});
});
