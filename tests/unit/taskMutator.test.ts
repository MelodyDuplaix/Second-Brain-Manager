import { describe, it, expect } from 'vitest';
import { TaskMutator } from '../../src/mutators/taskMutator';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';

describe('TaskMutator', () => {
	it('should mark task as completed with completion date before blockId', () => {
		const line = '- [ ] Acheter du pain 📅 2026-08-07 ^task-pain';
		const updated = TaskMutator.setCompleted(line, true, '2026-08-07', DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [x] Acheter du pain 📅 2026-08-07 ✅ 2026-08-07 ^task-pain');
	});

	it('should uncheck completed task and strip completion date', () => {
		const line = '- [x] Acheter du pain 📅 2026-08-07 ✅ 2026-08-07 ^task-pain';
		const updated = TaskMutator.setCompleted(line, false, undefined, DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [ ] Acheter du pain 📅 2026-08-07 ^task-pain');
	});

	it('should update due date with wikilinks when configured', () => {
		const config = {
			...DEFAULT_SYNTAX_CONFIG,
			useWikilinks: true
		};

		const line = '- [ ] Réparer le vélo 📅 2026-08-01';
		const updated = TaskMutator.setDueDate(line, '2026-08-15', config);

		expect(updated).toBe('- [ ] Réparer le vélo 📅 [[2026-08-15]]');
	});

	it('should update start date properly', () => {
		const line = '- [ ] Commencer le projet';
		const updated = TaskMutator.setStartDate(line, '2026-08-10', DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [ ] Commencer le projet 🛫 2026-08-10');
	});

	it('should update priority in emoji mode', () => {
		const line = '- [ ] Rapport trimestriel 🔼';
		const updated = TaskMutator.setPriority(line, 'highest', DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [ ] Rapport trimestriel 🔺');
	});

	it('should update priority in tag mode', () => {
		const config = {
			...DEFAULT_SYNTAX_CONFIG,
			priorityMode: 'tag' as const,
			priorityTagPrefix: 'priorite'
		};

		const line = '- [ ] Rapport trimestriel #priorite/moyenne';
		const updated = TaskMutator.setPriority(line, 'high', config);

		expect(updated).toBe('- [ ] Rapport trimestriel #priorite/high');
	});

	it('should update controlled tags preserving blockId anchor', () => {
		const line = '- [ ] Ecrire un chapitre #energie/2 ^chapitre-1';
		const updated = TaskMutator.setControlledTag(line, 'energie', 8, DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [ ] Ecrire un chapitre #energie/8 ^chapitre-1');
	});

	it('should set status to in_progress [/]', () => {
		const line = '- [ ] Réparer le bug de collision 📅 2026-08-07';
		const updated = TaskMutator.setStatus(line, 'in_progress', DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [/] Réparer le bug de collision 📅 2026-08-07');
	});

	it('should revert status from in_progress [/] back to todo [ ]', () => {
		const line = '- [/] Réparer le bug de collision 📅 2026-08-07';
		const updated = TaskMutator.setStatus(line, 'todo', DEFAULT_SYNTAX_CONFIG);

		expect(updated).toBe('- [ ] Réparer le bug de collision 📅 2026-08-07');
	});

	it('should format subtask lines with appropriate indentation', () => {
		const subtask = TaskMutator.createSubtaskLine(0, 'Sous-étape 1');
		expect(subtask).toBe('  - [ ] Sous-étape 1');

		const nestedSubtask = TaskMutator.createSubtaskLine(1, 'Sous-étape 1.1');
		expect(nestedSubtask).toBe('    - [ ] Sous-étape 1.1');
	});

	it('should clean duplicate checkboxes, list bullets, and numbers with cleanTaskPrefix', () => {
		expect(TaskMutator.cleanTaskPrefix('- [ ] - [ ] Isoler le script')).toBe('Isoler le script');
		expect(TaskMutator.cleanTaskPrefix('[ ] [ ] Lister les mécaniques')).toBe('Lister les mécaniques');
		expect(TaskMutator.cleanTaskPrefix('  - [ ] - [ ] Isoler le script')).toBe('Isoler le script');
		expect(TaskMutator.cleanTaskPrefix('1. - [ ] Créer une première version')).toBe('Créer une première version');
		expect(TaskMutator.cleanTaskPrefix('1. [ ] Dessiner un croquis')).toBe('Dessiner un croquis');
		expect(TaskMutator.cleanTaskPrefix('* [x] Implémenter le niveau')).toBe('Implémenter le niveau');
		expect(TaskMutator.cleanTaskPrefix('- [/] Tester et ajuster')).toBe('Tester et ajuster');
		expect(TaskMutator.cleanTaskPrefix('- Simple tâche')).toBe('Simple tâche');
		expect(TaskMutator.cleanTaskPrefix('\t- [ ] [ ] Sous-tâche imbriquée')).toBe('Sous-tâche imbriquée');
		expect(TaskMutator.cleanTaskPrefix('Tâche déjà propre')).toBe('Tâche déjà propre');
	});

	it('should create subtask lines without doubling checkboxes even when subtaskTitle has checkboxes', () => {
		const subtask1 = TaskMutator.createSubtaskLine(0, '- [ ] - [ ] Isoler le script');
		expect(subtask1).toBe('  - [ ] Isoler le script');

		const subtask2 = TaskMutator.createSubtaskLine('    ', '[ ] [ ] Dessiner un croquis');
		expect(subtask2).toBe('    - [ ] Dessiner un croquis');

		const subtask3 = TaskMutator.createSubtaskLine('\t\t', '1. - [ ] Implémenter le niveau');
		expect(subtask3).toBe('\t\t- [ ] Implémenter le niveau');
	});

	it('should strictly convert to emoji format when config taskFormat is emoji', () => {
		const line = '- [ ] Préparer la réunion [scheduled:: 2026-08-20] [due:: 2026-08-22]';
		const updated = TaskMutator.setDueDate(line, '2026-08-25', DEFAULT_SYNTAX_CONFIG);
		expect(updated).toBe('- [ ] Préparer la réunion [scheduled:: 2026-08-20] 📅 2026-08-25');
	});

	it('should update due date using Dataview style when taskFormat is dataview', () => {
		const dvConfig = { ...DEFAULT_SYNTAX_CONFIG, taskFormat: 'dataview' as const };
		const line = '- [ ] Préparer la réunion 📅 2026-08-20';
		const updated = TaskMutator.setDueDate(line, '2026-08-25', dvConfig);
		expect(updated).toBe('- [ ] Préparer la réunion [due:: 2026-08-25]');
	});

	it('should mark Dataview task as completed using [completion:: YYYY-MM-DD] when taskFormat is dataview', () => {
		const dvConfig = { ...DEFAULT_SYNTAX_CONFIG, taskFormat: 'dataview' as const };
		const line = '- [ ] Préparer la réunion [scheduled:: 2026-08-20] [due:: 2026-08-22]';
		const updated = TaskMutator.setCompleted(line, true, '2026-08-26', dvConfig);
		expect(updated).toBe('- [x] Préparer la réunion [scheduled:: 2026-08-20] [due:: 2026-08-22] [completion:: 2026-08-26]');
	});

	it('should format task line strictly according to tag format configuration', () => {
		const tagConfig = { ...DEFAULT_SYNTAX_CONFIG, taskFormat: 'tag' as const, priorityMode: 'tag' as const };
		const line = TaskMutator.formatTaskLine({
			title: 'Tâche en format tags',
			dueDate: '2026-08-30',
			scheduledDate: '2026-08-29',
			priority: 'high',
			energy: 4,
			pieces: 5,
			matrixQuadrant: 'q1',
			domainTags: ['important'],
			linkedNotes: ['Projet Alpha']
		}, tagConfig);

		expect(line).toBe('- [ ] Tâche en format tags #due/2026-08-30 #scheduled/2026-08-29 #priorite/high #energie/4 #pieces/5 #tm/q1 #important [[Projet Alpha]]');
	});

	it('should format task line strictly according to dataview configuration', () => {
		const dvConfig = { ...DEFAULT_SYNTAX_CONFIG, taskFormat: 'dataview' as const };
		const line = TaskMutator.formatTaskLine({
			title: 'Tâche en format dataview',
			dueDate: '2026-08-30',
			scheduledDate: '2026-08-29',
			priority: 'high',
			energy: 4,
			pieces: 5,
			matrixQuadrant: 'q1',
			linkedNotes: ['Projet Alpha']
		}, dvConfig);

		expect(line).toBe('- [ ] Tâche en format dataview [due:: 2026-08-30] [scheduled:: 2026-08-29] [priority:: high] [energy:: 4] [pieces:: 5] [matrix:: q1] [[Projet Alpha]]');
	});

	it('should format task line strictly according to emoji configuration', () => {
		const line = TaskMutator.formatTaskLine({
			title: 'Tâche en format standard emoji',
			dueDate: '2026-08-30',
			scheduledDate: '2026-08-29',
			startDate: '2026-08-28',
			priority: 'high',
			energy: 3,
			matrixQuadrant: 'q2',
			linkedNotes: ['Projet Beta']
		}, DEFAULT_SYNTAX_CONFIG);

		expect(line).toBe('- [ ] Tâche en format standard emoji 📅 2026-08-30 ⏳ 2026-08-29 🛫 2026-08-28 ⏫ #energie/3 #tm/q2 [[Projet Beta]]');
	});
});
