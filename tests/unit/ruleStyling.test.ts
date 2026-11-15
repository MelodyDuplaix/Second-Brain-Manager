import { describe, it, expect } from 'vitest';
import { ObsidianTask } from '../../src/models/task';
import { PriorityRule } from '../../src/services/displayRules';
import { localToday, prioritizeTasks, taskRuleSubject } from '../../src/services/ruleStyling';

const task = (title: string, extra: Partial<ObsidianTask> = {}): ObsidianTask => ({
	rawText: `- [ ] ${title}`,
	cleanText: title,
	title,
	completed: false,
	statusChar: ' ',
	status: 'todo',
	filePath: 'Projets/Acme.md',
	lineNumber: 1,
	indentLevel: 0,
	domainTags: [],
	subtasks: [],
	...extra
});

const rule = (value: string, priority: PriorityRule['priority']): PriorityRule => ({
	id: value, name: value, enabled: true, match: 'all', conditions: [{ field: 'text', value }], priority
});

describe('Règles d’affichage hors du calendrier', () => {
	it('une tâche devient un sujet de règle : texte, tags, note et statut', () => {
		const s = taskRuleSubject(task('Appeler @Melody #perso', { rawText: '- [ ] Appeler @Melody #perso' }));
		expect(s.kind).toBe('task');
		expect(s.text).toContain('@Melody');
		expect(s.tags.map(t => t.replace(/^#/, ''))).toContain('perso');
		expect(s.path).toBe('Projets/Acme.md');
		expect(s.done).toBe(false);
	});

	it('une tâche terminée est vue comme terminée', () => {
		expect(taskRuleSubject(task('Fait', { completed: true, status: 'done', statusChar: 'x' })).done).toBe(true);
	});

	it('réordonne et masque une liste de tâches (tableau de bord, briefing, revue du soir)', () => {
		const list = [task('Courses'), task('Voir @Antoine'), task('Réveil'), task('Facture')];
		const out = prioritizeTasks(list, [rule('@Antoine', 'first'), rule('réveil', 'hidden')]).map(t => t.title);
		expect(out).toEqual(['Voir @Antoine', 'Courses', 'Facture']);
	});

	it('sans règle, la liste est inchangée', () => {
		const list = [task('B'), task('A')];
		expect(prioritizeTasks(list, undefined)).toEqual(list);
	});

	it('la date du jour est locale, au format AAAA-MM-JJ', () => {
		expect(localToday(new Date(2026, 10, 5, 23, 30))).toBe('2026-11-05');
	});
});
