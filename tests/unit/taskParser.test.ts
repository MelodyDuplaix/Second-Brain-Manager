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

	it('should parse custom status characters', () => {
		const line = '- [/] Tâche en cours avec statut custom';
		const task = TaskParser.parseLine(line, 'test.md', 1, DEFAULT_SYNTAX_CONFIG);

		expect(task).not.toBeNull();
		expect(task?.statusChar).toBe('/');
		expect(task?.status).toBe('in-progress');
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
});
