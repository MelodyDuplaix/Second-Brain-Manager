import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import {
	CalendarDate,
	bucketTasksByDate,
	locateTaskLine,
	TaskWriter,
	dayEnergyLoad
} from '../../src/services/taskCalendarService';
import { TaskParser } from '../../src/parsers/taskParser';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';

describe('CalendarDate', () => {
	it('builds a 42-day month grid starting on Monday', () => {
		const grid = CalendarDate.monthGrid('2026-11-08');
		expect(grid).toHaveLength(42);
		expect(grid[0]).toBe('2026-10-26'); // lundi
		expect(CalendarDate.weekdayIndex(grid[0])).toBe(0);
		expect(grid).toContain('2026-11-30');
	});

	it('computes week boundaries and ISO week numbers', () => {
		expect(CalendarDate.startOfWeek('2026-11-08')).toBe('2026-11-02'); // dimanche → lundi précédent
		expect(CalendarDate.weekDays('2026-11-04')[6]).toBe('2026-11-08');
		expect(CalendarDate.isoWeekNumber('2026-01-01')).toBe(1);
		expect(CalendarDate.isoWeekNumber('2026-11-09')).toBe(46);
	});

	it('adds days and months across boundaries', () => {
		expect(CalendarDate.addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(CalendarDate.addDays('2026-03-29', 1)).toBe('2026-03-30'); // passage à l'heure d'été
		expect(CalendarDate.addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(CalendarDate.diffDays('2026-11-08', '2026-11-15')).toBe(7);
	});

	it('normalizes common date formats', () => {
		expect(CalendarDate.normalize('2026-8-7')).toBe('2026-08-07');
		expect(CalendarDate.normalize('07-08-2026')).toBe('2026-08-07');
		expect(CalendarDate.normalize('[[nope]]')).toBeNull();
		expect(CalendarDate.normalize(undefined)).toBeNull();
	});

	it('labels relative days', () => {
		expect(CalendarDate.relativeLabel('2026-11-08', '2026-11-08')).toBe('Aujourd\'hui');
		expect(CalendarDate.relativeLabel('2026-11-09', '2026-11-08')).toBe('Demain');
		expect(CalendarDate.relativeLabel('2026-11-07', '2026-11-08')).toBe('Hier');
	});
});

describe('bucketTasksByDate', () => {
	const content = [
		'- [x] Fait 📅 2026-11-10',
		'- [ ] Basse ⏬ 📅 2026-11-10 #energie/2',
		'- [ ] Haute ⏫ 📅 2026-11-10 #energie/5',
		'- [ ] Prévue ⏳ 2026-11-12',
		'- [ ] Sans date'
	].join('\n');
	const tasks = TaskParser.parseAllTasks(content, 'note.md', DEFAULT_SYNTAX_CONFIG);

	it('groups by due date and sorts open, then by priority', () => {
		const buckets = bucketTasksByDate(tasks, 'due');
		expect([...buckets.keys()]).toEqual(['2026-11-10']);
		expect(buckets.get('2026-11-10')!.map(t => t.title)).toEqual(['Haute', 'Basse', 'Fait']);
	});

	it('uses scheduled date (falling back to due) when asked', () => {
		const buckets = bucketTasksByDate(tasks, 'scheduled');
		expect(buckets.get('2026-11-12')!.map(t => t.title)).toEqual(['Prévue']);
		expect(buckets.get('2026-11-10')).toHaveLength(3);
	});

	it('sums the energy load of open tasks only', () => {
		const day = bucketTasksByDate(tasks, 'due').get('2026-11-10');
		expect(dayEnergyLoad(day)).toBe(7);
	});
});

describe('locateTaskLine', () => {
	const task = { lineNumber: 2, rawText: '- [ ] Appeler Claire 📅 2026-11-10', title: 'Appeler Claire' };

	it('returns the original line when untouched', () => {
		expect(locateTaskLine(['# Titre', task.rawText], task)).toBe(1);
	});

	it('follows the task when lines were inserted above', () => {
		expect(locateTaskLine(['# Titre', 'nouvelle ligne', 'autre', task.rawText], task)).toBe(3);
	});

	it('falls back to the title when the line was edited elsewhere', () => {
		expect(locateTaskLine(['# Titre', '- [ ] Appeler Claire 📅 2026-11-20 #q1'], task)).toBe(1);
	});

	it('returns -1 when the task disappeared', () => {
		expect(locateTaskLine(['# Titre', 'texte'], task)).toBe(-1);
	});
});

describe('TaskWriter', () => {
	function fakeApp(initial: string, tasksApi?: unknown) {
		const file = new TFile();
		file.path = 'note.md';
		let content = initial;
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === 'note.md' ? file : null),
				process: async (_f: TFile, fn: (c: string) => string) => {
					content = fn(content);
					return content;
				}
			},
			plugins: { plugins: tasksApi ? { 'obsidian-tasks-plugin': { apiV1: tasksApi } } : {} }
		};
		return { app: app as never, read: () => content };
	}

	const parse = (text: string) => TaskParser.parseAllTasks(text, 'note.md', DEFAULT_SYNTAX_CONFIG);

	it('moves a due date and preserves CRLF line endings', async () => {
		const text = '# Jour\r\n- [ ] Écrire 📅 2026-11-10 ^abc\r\n';
		const { app, read } = fakeApp(text);
		const writer = new TaskWriter(app, () => DEFAULT_SYNTAX_CONFIG);
		const ok = await writer.setDueDate(parse(text)[0], '2026-11-12');
		expect(ok).toBe(true);
		expect(read()).toBe('# Jour\r\n- [ ] Écrire 📅 2026-11-12 ^abc\r\n');
	});

	it('completes with the Tasks API when available (recurring tasks)', async () => {
		const text = '- [ ] Loyer 🔁 every month 📅 2026-11-01';
		const tasksApi = {
			executeToggleTaskDoneCommand: (line: string) =>
				`- [ ] Loyer 🔁 every month 📅 2026-12-01\n${line.replace('[ ]', '[x]')} ✅ 2026-11-08`
		};
		const { app, read } = fakeApp(text, tasksApi);
		const writer = new TaskWriter(app, () => DEFAULT_SYNTAX_CONFIG);
		await writer.setCompleted(parse(text)[0], true);
		expect(read().split('\n')).toEqual([
			'- [ ] Loyer 🔁 every month 📅 2026-12-01',
			'- [x] Loyer 🔁 every month 📅 2026-11-01 ✅ 2026-11-08'
		]);
	});

	it('falls back to the internal mutator without the Tasks plugin', async () => {
		const text = '- [x] Fait 📅 2026-11-01 ✅ 2026-11-01';
		const { app, read } = fakeApp(text);
		const writer = new TaskWriter(app, () => DEFAULT_SYNTAX_CONFIG);
		await writer.setCompleted(parse(text)[0], false);
		expect(read()).toBe('- [ ] Fait 📅 2026-11-01');
	});

	it('deletes a task together with its indented subtasks', async () => {
		const text = ['- [ ] Parent 📅 2026-11-10', '  - [ ] Enfant', '- [ ] Voisin'].join('\n');
		const { app, read } = fakeApp(text);
		const writer = new TaskWriter(app, () => DEFAULT_SYNTAX_CONFIG);
		const ok = await writer.deleteTask(parse(text)[0]);
		expect(ok).toBe(true);
		expect(read()).toBe('- [ ] Voisin');
	});

	it('reports failure when the task cannot be found', async () => {
		const { app } = fakeApp('rien ici');
		const writer = new TaskWriter(app, () => DEFAULT_SYNTAX_CONFIG);
		const ghost = parse('- [ ] Fantôme 📅 2026-11-10')[0];
		expect(await writer.setDueDate(ghost, '2026-11-11')).toBe(false);
	});
});
