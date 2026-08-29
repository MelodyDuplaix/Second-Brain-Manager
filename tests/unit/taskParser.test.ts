import { describe, it, expect } from 'vitest';
import { TaskParser } from '../../src/parsers/taskParser';
import { DEFAULT_SYNTAX_CONFIG } from '../../src/models/syntaxConfig';

describe('TaskParser', () => {
	it('should parse canonical Obsidian Tasks line correctly', () => {
		const line = '- [ ] Poster le contenu Instagram 📅 2026-08-31 ⏳ 2026-08-07 🔁 every month #communication #difficulte/moyenne #energie/4 #pieces/5 #tm/q2 [[Claire]] ^task-loyer';
		const task = TaskParser.parseLine(line, '01 - Projets/Instagram.md', 10, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.completed).toBe(false);
		expect(task?.statusChar).toBe(' ');
		expect(task?.dueDate).toBe('2026-08-31');
		expect(task?.scheduledDate).toBe('2026-08-07');
		expect(task?.recurrence).toBe('every month');
		expect(task?.energy).toBe(4);
		expect(task?.difficulty).toBe('moyenne');
		expect(task?.pieces).toBe(5);
		expect(task?.matrixTag).toBe('#tm/q2');
		expect(task?.blockId).toBe('task-loyer');
		expect(task?.domainTags).toContain('#communication');
	});

	it('should parse emoji priorities accurately', () => {
		const highestTask = TaskParser.parseLine('- [ ] Tâche urgente 🔺', 'test.md', 1);
		expect(highestTask?.priority).toBe('highest');

		const highTask = TaskParser.parseLine('- [ ] Tâche haute ⏫', 'test.md', 2);
		expect(highTask?.priority).toBe('high');

		const mediumTask = TaskParser.parseLine('- [ ] Tâche moyenne 🔼', 'test.md', 3);
		expect(mediumTask?.priority).toBe('medium');

		const lowTask = TaskParser.parseLine('- [ ] Tâche basse 🔽', 'test.md', 4);
		expect(lowTask?.priority).toBe('low');

		const lowestTask = TaskParser.parseLine('- [ ] Tâche très basse ⏬', 'test.md', 5);
		expect(lowestTask?.priority).toBe('lowest');
	});

	it('should parse custom status characters', () => {
		const inProgress = TaskParser.parseLine('- [/] Tâche en cours', 'test.md', 1, DEFAULT_SYNTAX_CONFIG);
		expect(inProgress?.statusChar).toBe('/');
		expect(inProgress?.status).toBe('in-progress');

		const cancelled = TaskParser.parseLine('- [-] Tâche annulée', 'test.md', 2, DEFAULT_SYNTAX_CONFIG);
		expect(cancelled?.statusChar).toBe('-');
		expect(cancelled?.status).toBe('cancelled');
	});

	it('should parse Wikilink dates and custom priority tags', () => {
		const config = {
			...DEFAULT_SYNTAX_CONFIG,
			priorityTagPrefix: 'priority',
			useWikilinks: true
		};

		const line = '- [ ] Faire la vaisselle 📅 [[2026-08-10]] #priority/high';
		const task = TaskParser.parseLine(line, 'test.md', 1, config);

		expect(task).not.toBeNull();
		expect(task?.dueDate).toBe('2026-08-10');
		expect(task?.priority).toBe('high');
		expect(task?.priorityTag).toBe('#priority/high');
	});

	it('should parse full markdown file and maintain subtask tree hierarchy', () => {
		const markdown = `
# Mes Tâches
- [ ] Tâche Parent 📅 2026-08-30
  - [ ] Sous-tâche 1 #energie/2
  - [x] Sous-tâche 2 terminée
    - [ ] Sous-sous-tâche 2.1
- [ ] Autre Tâche Racine
`;

		const tasks = TaskParser.parseFile(markdown, 'projet.md', DEFAULT_SYNTAX_CONFIG);
		expect(tasks.length).toBe(2);
		expect(tasks[0].title).toBe('Tâche Parent');
		expect(tasks[0].subtasks.length).toBe(2);
		expect(tasks[0].subtasks[0].title).toBe('Sous-tâche 1');
		expect(tasks[0].subtasks[1].completed).toBe(true);
		expect(tasks[0].subtasks[1].subtasks.length).toBe(1);
		expect(tasks[0].subtasks[1].subtasks[0].title).toBe('Sous-sous-tâche 2.1');
		expect(tasks[1].title).toBe('Autre Tâche Racine');
	});

	it('should ignore tasks written inside fenced code blocks', () => {
		const markdown = `
# Documentation
Voici comment écrire une tâche :
\`\`\`markdown
- [ ] Tâche exemple dans un bloc de code 📅 2026-08-10
\`\`\`
- [ ] Vraie tâche active 📅 2026-08-15
`;

		const tasks = TaskParser.parseFile(markdown, 'doc.md', DEFAULT_SYNTAX_CONFIG);
		expect(tasks.length).toBe(1);
		expect(tasks[0].title).toBe('Vraie tâche active');
		expect(tasks[0].dueDate).toBe('2026-08-15');
	});

	it('should parse Dataview inline fields format correctly', () => {
		const line = '- [x] Préparer journée du  [scheduled:: 2025-12-29]  [due:: 2025-12-30]  [completion:: 2026-08-26]';
		const task = TaskParser.parseLine(line, 'Note quotidienne/20-06-2024.md', 17, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.completed).toBe(true);
		expect(task?.title).toBe('Préparer journée du');
		expect(task?.scheduledDate).toBe('2025-12-29');
		expect(task?.dueDate).toBe('2025-12-30');
		expect(task?.completedDate).toBe('2026-08-26');
	});

	it('should parse Dataview format with parentheses and french dates (DD-MM-YYYY)', () => {
		const line = '- [ ] Nettoyer le bureau (scheduled:: 29-12-2025) (due:: 30-12-2025) [priority:: high] [energy:: 4] [pieces:: 3]';
		const task = TaskParser.parseLine(line, 'Notes en vrac/Bureau.md', 1, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.completed).toBe(false);
		expect(task?.title).toBe('Nettoyer le bureau');
		expect(task?.scheduledDate).toBe('2025-12-29');
		expect(task?.dueDate).toBe('2025-12-30');
		expect(task?.priority).toBe('high');
		expect(task?.energy).toBe(4);
		expect(task?.pieces).toBe(3);
	});

	it('should normalize dates in wikilinks with day names and assign to dueDate', () => {
		const line = '- [ ] Passer l\'aspirateur 🔁 every week when done ➕ 2026-08-09 [[17-08-2026 lu]]';
		const task = TaskParser.parseLine(line, 'Tracker menage.md', 15, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.title).toBe('Passer l\'aspirateur');
		expect(task?.dueDate).toBe('2026-08-17');
	});

	it('should infer implicit scheduled date from daily note file name when task has no explicit date', () => {
		const line = '- [ ] Prendre médicament allergie';
		const task = TaskParser.parseLine(line, 'Note quotidienne/28-12-2025.md', 18, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.title).toBe('Prendre médicament allergie');
		expect(task?.scheduledDate).toBe('2025-12-28');
	});

	it('should flatten all tasks including nested subtasks with parseAllTasks', () => {
		const markdown = `
- [ ] Parent
  - [ ] Subtask 1
    - [ ] Nested Subtask 1.1
- [ ] Another Root
`;
		const allTasks = TaskParser.parseAllTasks(markdown, 'test.md', DEFAULT_SYNTAX_CONFIG);
		expect(allTasks.length).toBe(4);
		expect(allTasks.map(t => t.title)).toEqual(['Parent', 'Subtask 1', 'Nested Subtask 1.1', 'Another Root']);
	});

	it('should parse tag-based dates and priorities correctly without polluting domainTags or title', () => {
		const line = '- [x] Rédiger le compte rendu #due/2026-08-30 #scheduled/2026-08-29 #start/2026-08-28 #done/2026-08-31 #priorite/haute #energie/3 #projet #travail';
		const task = TaskParser.parseLine(line, 'CR.md', 1, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.completed).toBe(true);
		expect(task?.title).toBe('Rédiger le compte rendu #projet #travail');
		expect(task?.dueDate).toBe('2026-08-30');
		expect(task?.scheduledDate).toBe('2026-08-29');
		expect(task?.startDate).toBe('2026-08-28');
		expect(task?.completedDate).toBe('2026-08-31');
		expect(task?.priority).toBe('high');
		expect(task?.energy).toBe(3);
		expect(task?.domainTags).toEqual(['#projet', '#travail']);
	});

	it('should parse task as paused when tag #pause is present in tag mode', () => {
		const line = '- [ ] Recontacter le client 📅 2026-08-30 #pause';
		const task = TaskParser.parseLine(line, 'Clients.md', 1, { ...DEFAULT_SYNTAX_CONFIG, pauseMode: 'tag', pauseTag: 'pause' });

		expect(task).not.toBeNull();
		expect(task?.isPaused).toBe(true);
		expect(task?.status).toBe('paused');
		expect(task?.completed).toBe(false);
	});

	it('should parse task as paused when status character is [?] or [p] in status mode', () => {
		const line = '- [?] Mettre à jour l\'infrastructure 📅 2026-09-01';
		const task = TaskParser.parseLine(line, 'Infra.md', 1, { ...DEFAULT_SYNTAX_CONFIG, pauseMode: 'status', pauseStatusSymbol: '?' });

		expect(task).not.toBeNull();
		expect(task?.isPaused).toBe(true);
		expect(task?.status).toBe('paused');
		expect(task?.completed).toBe(false);
	});
});

