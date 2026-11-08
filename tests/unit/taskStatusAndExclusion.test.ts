import { describe, it, expect, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskParser } from '../../src/parsers/taskParser';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';
import { TaskStatusRegistry } from '../../src/models/taskStatusRegistry';
import { TaskWriter } from '../../src/services/taskCalendarService';
import { TaskExclusionRules } from '../../src/services/taskExclusionService';

const parse = (line: string) => TaskParser.parseLine(line, 'Notes/a.md', 1, DEFAULT_SYNTAX_CONFIG);

/** Extrait des réglages réels du plugin Tasks (coffre Base_de_connaissance). */
const TASKS_DATA = {
	globalFilter: '',
	removeGlobalFilter: false,
	setDoneDate: true,
	statusSettings: {
		coreStatuses: [
			{ symbol: ' ', name: 'Todo', nextStatusSymbol: 'x', type: 'TODO' },
			{ symbol: 'x', name: 'Done', nextStatusSymbol: ' ', type: 'DONE' }
		],
		customStatuses: [
			{ symbol: '/', name: 'In Progress', nextStatusSymbol: 'x', type: 'IN_PROGRESS' },
			{ symbol: '-', name: 'Cancelled', nextStatusSymbol: ' ', type: 'CANCELLED' },
			{ symbol: '2', name: 'progress', nextStatusSymbol: '3', type: 'IN_PROGRESS' },
			{ symbol: 'a', name: 'en attente', nextStatusSymbol: 'x', type: 'IN_PROGRESS' },
			{ symbol: 'm', name: 'medic', nextStatusSymbol: 'y', type: 'TODO' },
			{ symbol: 'y', name: 'done', nextStatusSymbol: 'm', type: 'DONE' },
			{ symbol: 'b', name: 'bookmark', nextStatusSymbol: 'b', type: 'NON_TASK' },
			{ symbol: '', name: 'invalide', nextStatusSymbol: 'x', type: 'TODO' }
		]
	}
};

afterEach(() => TaskStatusRegistry.reset());

describe('tags accentués', () => {
	it('keeps the whole tag, accents included', () => {
		const t = parse('- [ ] Nettoyer boku+toilettes #context/home #ménage 📅 2026-11-11')!;
		expect(t.domainTags).toEqual(['#context/home', '#ménage']);
		const s = parse('- [ ] Préparer le plan #santé #difficulte/très-dure')!;
		expect(s.domainTags).toEqual(['#santé']);
		expect(s.difficulty).toBe('très-dure');
	});
});

describe('statuts du plugin Tasks', () => {
	it('reads core and custom statuses, ignoring invalid symbols', () => {
		const conf = TaskStatusRegistry.parseTasksPluginData(TASKS_DATA)!;
		expect(conf.statuses.map(s => s.symbol)).toEqual([' ', 'x', '/', '-', '2', 'a', 'm', 'y', 'b']);
	});

	it('recognizes custom symbols and their types', () => {
		expect(parse('- [2] Lire le livre')).toBeNull(); // inconnu tant que Tasks n'est pas chargé
		TaskStatusRegistry.configure(TaskStatusRegistry.parseTasksPluginData(TASKS_DATA)!);
		const progress = parse('- [2] Lire le livre')!;
		expect(progress.status).toBe('in-progress');
		expect(progress.statusName).toBe('progress');
		expect(progress.completed).toBe(false);
		expect(parse('- [y] Médicament pris')!.completed).toBe(true);
		expect(parse('- [b] Un signet')).toBeNull();
	});

	it('follows the next status on click, with done dates like Tasks', () => {
		TaskStatusRegistry.configure(TaskStatusRegistry.parseTasksPluginData(TASKS_DATA)!);
		expect(TaskStatusRegistry.nextSymbol('2')).toBe('3');
		const toDone = TaskWriter.applyStatus('- [m] Médicament 📅 2026-11-08', 'm', 'y', DEFAULT_SYNTAX_CONFIG);
		expect(toDone).toMatch(/^- \[y\] Médicament 📅 2026-11-08 ✅ \d{4}-\d{2}-\d{2}$/);
		const back = TaskWriter.applyStatus(toDone, 'y', 'm', DEFAULT_SYNTAX_CONFIG);
		expect(back).toBe('- [m] Médicament 📅 2026-11-08');
	});

	it('toggles locally to the next status when the Tasks API is unavailable', async () => {
		TaskStatusRegistry.configure(TaskStatusRegistry.parseTasksPluginData(TASKS_DATA)!);
		const file = new TFile();
		file.path = 'Notes/a.md';
		let content = '- [2] Lire le livre';
		const app = {
			vault: {
				getAbstractFileByPath: () => file,
				process: async (_f: TFile, fn: (c: string) => string) => { content = fn(content); return content; }
			},
			plugins: { plugins: {} }
		};
		const writer = new TaskWriter(app as never, () => DEFAULT_SYNTAX_CONFIG);
		const next = await writer.toggle(parse('- [2] Lire le livre')!);
		expect(next).toBe('3');
		expect(content).toBe('- [3] Lire le livre');
	});

	it('honours the Tasks global filter', () => {
		TaskStatusRegistry.configure({ ...TaskStatusRegistry.parseTasksPluginData(TASKS_DATA)!, globalFilter: '#task', removeGlobalFilter: true });
		expect(parse('- [ ] Simple case à cocher')).toBeNull();
		expect(parse('- [ ] #task Appeler Claire')!.title).toBe('Appeler Claire');
	});
});

describe('exclusion de tâches', () => {
	const lines = [
		'- [ ] Parent #archive',
		'\t- [ ] Enfant sans tag',
		'- [ ] Brouillon de post',
		'- [ ] Projet client #projet/client',
		'- [-] Abandonnée',
		'- [ ] Garder celle-ci #ménage'
	].join('\n');
	const tasks = (path = 'Notes/a.md') => TaskParser.parseAllTasks(lines, path, DEFAULT_SYNTAX_CONFIG);
	const titles = (list: { title: string }[]) => list.map(t => t.title.replace(/\s#\S+/gu, '').trim());

	it('does nothing without rules', () => {
		expect(new TaskExclusionRules({}).filter(tasks())).toHaveLength(6);
	});

	it('excludes by tag (with sub-tags and children), word, status and path', () => {
		const rules = new TaskExclusionRules({
			taskExcludeTags: '#archive, projet',
			taskExcludeWords: 'brouillon',
			taskExcludeStatuses: '-'
		});
		expect(titles(rules.filter(tasks()))).toEqual(['Garder celle-ci']);
		const byPath = new TaskExclusionRules({ taskExcludePaths: 'Archives, *Modèle*' });
		expect(byPath.filter(tasks('Archives/2024/x.md'))).toHaveLength(0);
		expect(byPath.filter(tasks('Notes/Modèle tâche.md'))).toHaveLength(0);
		expect(byPath.filter(tasks('Notes/a.md'))).toHaveLength(6);
	});

	it('supports regular expressions and accented tags', () => {
		const rules = new TaskExclusionRules({ taskExcludeWords: '/^projet/', taskExcludeTags: '#ménage' });
		expect(titles(rules.filter(tasks()))).toEqual(['Parent', 'Enfant sans tag', 'Brouillon de post', 'Abandonnée']);
	});

	it('uses the note tags when a resolver is given', () => {
		const rules = new TaskExclusionRules({ taskExcludeTags: 'perso' }, path => (path === 'Journal/x.md' ? ['#perso'] : []));
		expect(rules.filter(tasks('Journal/x.md'))).toHaveLength(0);
		expect(rules.reasonFor(tasks('Notes/a.md')[0])).toBeNull();
	});
});
