import { describe, it, expect } from 'vitest';
import {
	DailyEntryParser,
	DEFAULT_DAILY_ENTRIES_SETTINGS,
	DailyEntriesSettings,
	TimeFormat,
	entryBounds,
	locateEntryLine
} from '../../src/services/dailyEntriesService';

const settings = (over: Partial<DailyEntriesSettings> = {}): DailyEntriesSettings => ({ ...DEFAULT_DAILY_ENTRIES_SETTINGS, ...over });

const NOTE = [
	'---',
	'jour: 2026-11-09',
	'---',
	'# A faire aujourd’hui [➕](obsidian://quickadd?choice=Tache)',
	'```tasks',
	'- 08:00 dans un bloc de code',
	'```',
	'# Recap du jour ',
	'- réveil ',
	'- [x] 11:30 - 12:00 Dentiste (Fondettes) #santé 🔺 ✅ 2026-11-09',
	'- 13:16 [[Projet d\'application éducative]] #programmation',
	'- 18:45 - 19:45 Cours Danse #sport',
	'# Repas',
	'- 12:30 Déjeuner'
].join('\n');

describe('TimeFormat', () => {
	it('lit et écrit le format HH:mm', () => {
		const t = new TimeFormat('HH:mm');
		expect(t.parse('09:05')).toBe(545);
		expect(t.parse('9:05')).toBe(545);
		expect(t.parse('25:00')).toBeNull();
		expect(t.format(545)).toBe('09:05');
	});

	it('gère les littéraux entre crochets et le format 12 h', () => {
		expect(new TimeFormat('H[h]mm').parse('14h30')).toBe(870);
		expect(new TimeFormat('H[h]mm').format(870)).toBe('14h30');
		const t = new TimeFormat('h:mm a');
		expect(t.parse('2:15 pm')).toBe(855);
		expect(t.parse('12:00 am')).toBe(0);
		expect(t.format(855)).toBe('2:15 pm');
	});
});

describe('DailyEntryParser', () => {
	it('lit toute la note hors blocs de code par défaut', () => {
		const entries = new DailyEntryParser(settings()).parse(NOTE, 'j.md', '2026-11-09');
		expect(entries.map(e => e.text)).toEqual([
			'Dentiste (Fondettes) #santé 🔺 ✅ 2026-11-09',
			'Déjeuner',
			'[[Projet d\'application éducative]] #programmation',
			'Cours Danse #sport'
		]);
	});

	it('se limite à la section choisie et lit plages, heures seules et tâches', () => {
		const entries = new DailyEntryParser(settings({ dailyEntriesHeadings: 'Recap du jour' })).parse(NOTE, 'j.md', '2026-11-09');
		expect(entries).toHaveLength(3);
		expect(entries[0]).toMatchObject({ start: 690, end: 720, statusChar: 'x', line: 9 });
		expect(entries[1]).toMatchObject({ start: 796, end: null });
		expect(entries[2]).toMatchObject({ start: 1125, end: 1185, text: 'Cours Danse #sport' });
	});

	it('ignore les tâches si demandé', () => {
		const entries = new DailyEntryParser(settings({ dailyEntriesHeadings: 'Recap du jour', dailyEntriesIncludeTasks: false })).parse(NOTE, 'j.md', '2026-11-09');
		expect(entries).toHaveLength(2);
	});

	it('accepte des formes de ligne personnalisées', () => {
		const p = new DailyEntryParser(settings({ dailyEntriesLineFormats: '{text} @ {start}', dailyEntriesTimeFormat: 'H[h]mm' }));
		expect(p.parseLine('- Sport @ 7h30')).toMatchObject({ start: 450, text: 'Sport' });
		expect(p.parseLine('- 07:30 Sport')).toBeNull();
	});

	it('réécrit les heures sans toucher au reste de la ligne', () => {
		const p = new DailyEntryParser(settings());
		const [entry] = p.parse('- [ ] 10:00 - 11:00 Réunion #travail', 'j.md', '2026-11-09');
		expect(p.rewriteTimes(entry, 600 + 90, 720)).toBe('- [ ] 11:30 - 12:00 Réunion #travail');
		const [point] = p.parse('- 13:16 Note', 'j.md', '2026-11-09');
		expect(p.rewriteTimes(point, 840, null)).toBe('- 14:00 Note');
		expect(p.rewriteTimes(point, 840, 900)).toBe('- 14:00 - 15:00 Note');
	});

	it('insère une entrée triée dans la section', () => {
		const p = new DailyEntryParser(settings({ dailyEntriesHeadings: 'Recap du jour' }));
		const out = p.insert(NOTE, p.formatNewLine(900, 960, 'Appel'), 900).split('\n');
		expect(out[11]).toBe('- 15:00 - 16:00 Appel');
		expect(out[12]).toBe('- 18:45 - 19:45 Cours Danse #sport');
	});

	it('insère à la fin de la section si demandé', () => {
		const p = new DailyEntryParser(settings({ dailyEntriesHeadings: 'Recap du jour', dailyEntriesInsertPosition: 'end' }));
		const out = p.insert(NOTE, p.formatNewLine(420, null, 'Lever'), 420).split('\n');
		expect(out[12]).toBe('- 07:00 Lever');
		expect(out[13]).toBe('# Repas');
	});

	it('crée la section si elle manque', () => {
		const p = new DailyEntryParser(settings({ dailyEntriesHeadings: 'Agenda' }));
		expect(p.insert('# Note\n', '- 09:00 Café', 540)).toBe('# Note\n\n## Agenda\n- 09:00 Café\n');
	});
});

describe('utilitaires', () => {
	it('calcule les bornes affichées', () => {
		expect(entryBounds({ start: 600, end: null }, 30)).toEqual({ start: 600, end: 630, point: true });
		expect(entryBounds({ start: 1320, end: 60 }, 30)).toEqual({ start: 1320, end: 1440, point: false });
	});

	it('retrouve une ligne déplacée', () => {
		expect(locateEntryLine(['a', 'b', '- 10:00 x'], { line: 1, raw: '- 10:00 x' })).toBe(2);
		expect(locateEntryLine(['a'], { line: 0, raw: 'zz' })).toBe(-1);
	});
});
