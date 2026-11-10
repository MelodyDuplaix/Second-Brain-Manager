import { describe, it, expect } from 'vitest';
import {
	DEFAULT_CALENDAR_FILTER,
	clearFilterChip,
	copyFilter,
	describeFilter,
	extractTags,
	hasDescriptionFilter,
	matchesDescriptionFilter,
	normalizeFilter,
	normalizeTag,
	normalizeTagList,
	parseTagInput,
	sameFilter,
	seedFilterPresets
} from '../../src/services/calendarFilters';
import { CalendarRole } from '../../src/models/googleCalendar';

const legend: Array<{ id: string; name: string; role: CalendarRole }> = [
	{ id: 'me', name: 'Moi', role: 'primary' }
];
const ctx = { matrixEnabled: true, googleReady: true, entriesAvailable: true, legend };
const filter = (patch: Partial<typeof DEFAULT_CALENDAR_FILTER>) => ({ ...DEFAULT_CALENDAR_FILTER, ...patch });

describe('Filtres de description : texte et tags', () => {
	it('nettoie les tags saisis (dièse, casse, doublons, séparateurs)', () => {
		expect(normalizeTag('  #Santé ')).toBe('santé');
		expect(normalizeTagList(['#Projet', 'projet', '', '#autre'])).toEqual(['projet', 'autre']);
		expect(parseTagInput('#sport, #Santé   projet;projet')).toEqual(['sport', 'santé', 'projet']);
	});

	it('garde les éléments dont la description contient le texte', () => {
		const f = filter({ searchText: 'dentiste' });
		expect(matchesDescriptionFilter(f, { texts: ['Rendez-vous dentiste'] })).toBe(true);
		expect(matchesDescriptionFilter(f, { texts: ['Courses'] })).toBe(false);
		// La recherche ignore la casse et accepte plusieurs champs (titre, lieu, note…)
		expect(matchesDescriptionFilter(f, { texts: ['Rendez-vous', undefined, 'Cabinet DENTISTE'] })).toBe(true);
	});

	it('trouve aussi le texte écrit dans un tag', () => {
		const f = filter({ searchText: 'santé' });
		expect(matchesDescriptionFilter(f, { texts: ['Rendez-vous'], tags: ['#santé'] })).toBe(true);
	});

	it('ne garde que les éléments portant un des tags demandés', () => {
		const f = filter({ tags: ['sport', 'santé'] });
		expect(matchesDescriptionFilter(f, { texts: ['Footing'], tags: ['#sport'] })).toBe(true);
		expect(matchesDescriptionFilter(f, { texts: ['Dentiste'], tags: ['#santé'] })).toBe(true);
		expect(matchesDescriptionFilter(f, { texts: ['Réunion'], tags: ['#travail'] })).toBe(false);
		expect(matchesDescriptionFilter(f, { texts: ['Sans tag'] })).toBe(false);
	});

	it('un tag parent garde ses sous-tags', () => {
		const f = filter({ tags: ['projet'] });
		expect(matchesDescriptionFilter(f, { texts: ['Tâche'], tags: ['#projet/sbm'] })).toBe(true);
		expect(matchesDescriptionFilter(f, { texts: ['Tâche'], tags: ['#projets'] })).toBe(false);
	});

	it('masque les éléments portant un tag exclu, même s’ils passent les autres filtres', () => {
		const f = filter({ tags: ['projet'], excludedTags: ['perso'] });
		expect(matchesDescriptionFilter(f, { texts: ['A'], tags: ['#projet'] })).toBe(true);
		expect(matchesDescriptionFilter(f, { texts: ['B'], tags: ['#projet', '#perso'] })).toBe(false);
		expect(matchesDescriptionFilter(f, { texts: ['C'], tags: ['#perso/sous'] , })).toBe(false);
	});

	it('combine texte et tags (les deux doivent passer)', () => {
		const f = filter({ searchText: 'cours', tags: ['sport'] });
		expect(matchesDescriptionFilter(f, { texts: ['Cours de danse'], tags: ['#sport'] })).toBe(true);
		expect(matchesDescriptionFilter(f, { texts: ['Cours de danse'], tags: ['#loisir'] })).toBe(false);
		expect(matchesDescriptionFilter(f, { texts: ['Footing'], tags: ['#sport'] })).toBe(false);
	});

	it('sans filtre de description, tout passe', () => {
		expect(hasDescriptionFilter(DEFAULT_CALENDAR_FILTER)).toBe(false);
		expect(matchesDescriptionFilter(DEFAULT_CALENDAR_FILTER, { texts: ['n’importe quoi'] })).toBe(true);
		expect(hasDescriptionFilter(filter({ searchText: 'x' }))).toBe(true);
		expect(hasDescriptionFilter(filter({ tags: ['x'] }))).toBe(true);
		expect(hasDescriptionFilter(filter({ excludedTags: ['x'] }))).toBe(true);
	});

	it('relève les tags écrits dans un texte libre', () => {
		expect(extractTags('Dentiste #santé puis #projet/sbm')).toEqual(['santé', 'projet/sbm']);
		expect(extractTags('Rien ici', undefined)).toEqual([]);
		// Un tag répété n’est compté qu’une fois
		expect(extractTags('#sport #Sport')).toEqual(['sport']);
	});
});

describe('Filtres de description : enregistrement dans un préréglage', () => {
	it('survit à la normalisation des données enregistrées', () => {
		const stored = { searchText: '  dentiste ', tags: ['#Santé', 'santé'], excludedTags: ['#perso'] };
		const f = normalizeFilter(stored);
		expect(f.searchText).toBe('dentiste');
		expect(f.tags).toEqual(['santé']);
		expect(f.excludedTags).toEqual(['perso']);
	});

	it('tolère un préréglage enregistré avant cette fonctionnalité', () => {
		const f = normalizeFilter({ showTasks: false });
		expect(f.searchText).toBe('');
		expect(f.tags).toEqual([]);
		expect(f.excludedTags).toEqual([]);
	});

	it('distingue deux préréglages qui ne diffèrent que par la description', () => {
		expect(sameFilter(filter({ searchText: 'a' }), filter({ searchText: 'b' }))).toBe(false);
		expect(sameFilter(filter({ tags: ['sport'] }), filter({ tags: [] }))).toBe(false);
		expect(sameFilter(filter({ excludedTags: ['perso'] }), filter({}))).toBe(false);
		// Même filtre à la casse et aux espaces près
		expect(sameFilter(filter({ searchText: ' Dentiste ' }), filter({ searchText: 'dentiste' }))).toBe(true);
		expect(sameFilter(filter({ tags: ['sport', 'santé'] }), filter({ tags: ['santé', 'sport'] }))).toBe(true);
	});

	it('copie un préréglage sans partager ses tableaux de tags', () => {
		const original = filter({ tags: ['sport'], excludedTags: ['perso'] });
		const copy = copyFilter(original);
		copy.tags.push('autre');
		copy.excludedTags.push('autre');
		expect(original.tags).toEqual(['sport']);
		expect(original.excludedTags).toEqual(['perso']);
	});

	it('garde les filtres de description des préréglages enregistrés', () => {
		const list = seedFilterPresets([
			{ id: 'custom:1', name: 'Santé', filter: filter({ searchText: 'rdv', tags: ['#Santé'] }) }
		]);
		const mine = list.find(p => p.id === 'custom:1');
		expect(mine?.filter.searchText).toBe('rdv');
		expect(mine?.filter.tags).toEqual(['santé']);
	});

	it('résume les filtres de description en pastilles retirables', () => {
		const f = filter({ searchText: 'dentiste', tags: ['santé'], excludedTags: ['perso'] });
		const chips = describeFilter(f, ctx);
		expect(chips.map(c => c.id)).toEqual(expect.arrayContaining(['text', 'tags', 'tags-excluded']));

		expect(clearFilterChip(f, 'text', legend).searchText).toBe('');
		expect(clearFilterChip(f, 'tags', legend).tags).toEqual([]);
		expect(clearFilterChip(f, 'tags-excluded', legend).excludedTags).toEqual([]);
		// Retirer une pastille ne touche pas les autres filtres
		expect(clearFilterChip(f, 'text', legend).tags).toEqual(['santé']);
	});

	it('raccourcit un texte long dans la pastille mais le garde en infobulle', () => {
		const long = 'rendez-vous chez le dentiste de quartier';
		const chip = describeFilter(filter({ searchText: long }), ctx).find(c => c.id === 'text');
		expect(chip?.label.length).toBeLessThan(long.length);
		expect(chip?.detail).toContain(long);
	});
});
