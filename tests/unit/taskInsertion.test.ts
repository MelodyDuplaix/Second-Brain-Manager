import { describe, it, expect } from 'vitest';
import { ActionExecutor } from '../../src/services/actionExecutor';

// Structure réelle d'une note quotidienne : propriétés, sections en titres de niveau 1, requêtes Tasks
const daily = [
	'---',
	'jour: 2026-11-10',
	'tags:',
	'  - daily',
	'avant: "[[09-11-2026 lu]]"',
	'---',
	'',
	'# A faire aujourd’hui [➕](obsidian://quickadd?choice=Quick%20Tache)',
	'```tasks ',
	'preset dailyTasks',
	'```',
	'![[Events du jour.base|no-header]]',
	'# Recap du jour ',
	'- réveil ',
	'',
	'# Liste des tâches effectuées aujourd\'hui',
	'```tasks',
	'preset DoneOnDay',
	'```',
	'# Notes du jour'
].join('\n');

const task = '- [ ] 10:00 - 11:00 Dentiste ⏳ 2026-11-10 #rdv';

describe('insertion des tâches créées par l’IA', () => {
	it('never writes a task inside the note properties', () => {
		const out = ActionExecutor.insertTaskIntoNoteContent(daily, task).split('\n');
		const fmEnd = out.indexOf('---', 1);
		expect(out.indexOf(task)).toBeGreaterThan(fmEnd);
	});

	it('uses a level-1 « A faire » section, at the end of the section', () => {
		const out = ActionExecutor.insertTaskIntoNoteContent(daily, task).split('\n');
		const next = out.findIndex(l => l.startsWith('# Recap du jour'));
		expect(out[next - 1]).toBe(task);
		expect(out[next - 2]).toBe('![[Events du jour.base|no-header]]');
	});

	it('keeps several new tasks together, in order, at the end of the section', () => {
		const first = '- [ ] 19:15 - 20:45 Cours de danse #rdv';
		const second = '- [ ] Définir architecture backend #travail';
		let content = ActionExecutor.insertTaskIntoNoteContent(daily, first, 'Recap du jour');
		content = ActionExecutor.insertTaskIntoNoteContent(content, second, 'Recap du jour');
		const out = content.split('\n');
		const heading = out.findIndex(l => l.startsWith('# Recap du jour'));
		expect(out.slice(heading + 1, heading + 5)).toEqual(['- réveil ', first, second, '']);
	});

	it('prefers the section chosen in the settings', () => {
		const out = ActionExecutor.insertTaskIntoNoteContent(daily, task, 'recap du jour').split('\n');
		const heading = out.findIndex(l => l.startsWith('# Recap du jour'));
		expect(out.indexOf(task)).toBeGreaterThan(heading);
		expect(out.indexOf(task)).toBeLessThan(out.findIndex(l => l.startsWith('# Liste des tâches')));
	});

	it('falls back to the end of the body, not the properties, when no section matches', () => {
		const note = '---\ntitle: x\n---\n\n# Journal\nTexte libre';
		const out = ActionExecutor.insertTaskIntoNoteContent(note, task).split('\n');
		expect(out.indexOf(task)).toBeGreaterThan(2);
		expect(out.slice(0, 3)).toEqual(['---', 'title: x', '---']);
	});
});

describe('insertion des tâches créées depuis le calendrier', () => {
	it('respects the task section instead of appending at the end of the note', () => {
		const line = '- [ ] Appeler le garage 📅 2026-11-12';
		const out = ActionExecutor.insertTaskIntoNoteContent(daily, line, 'Recap du jour', { replaceSimilar: false }).split('\n');
		const heading = out.findIndex(l => l.startsWith('# Recap du jour'));
		expect(out[heading + 2]).toBe(line);
		expect(out[out.length - 1]).toBe('# Notes du jour');
	});

	it('never replaces a similar existing task with an explicit entry', () => {
		const existing = '- [ ] Appeler le garage pour la révision';
		const note = daily.replace('- réveil ', `- réveil \n${existing}`);
		const line = '- [ ] Appeler le garage pour la révision 📅 2026-11-12';
		const out = ActionExecutor.insertTaskIntoNoteContent(note, line, 'Recap du jour', { replaceSimilar: false }).split('\n');
		expect(out).toContain(existing);
		expect(out).toContain(line);
	});
});
