import { describe, it, expect } from 'vitest';
import { MorningBriefingService, BriefingVaultData } from '../../src/services/morningBriefingService';
import { ObsidianTask } from '../../src/models/task';

describe('MorningBriefingService', () => {
	const mockTasks: ObsidianTask[] = [
		{
			title: 'Finir la maquette client',
			completed: false,
			status: 'todo',
			lineNumber: 5,
			filePath: '01 - Projets/Acme Project.md',
			rawLine: '- [ ] Finir la maquette client 📅 2026-08-20 #tm/q1 #energie/6',
			indentLevel: 0,
			dueDate: '2026-08-20',
			energy: 6,
			matrixTag: '#tm/q1',
			tags: ['#tm/q1', '#energie/6']
		},
		{
			title: 'Sortir les poubelles',
			completed: false,
			status: 'todo',
			lineNumber: 12,
			filePath: '02 - Domaines/Maison.md',
			rawLine: '- [ ] Sortir les poubelles 📅 2026-08-24 #tm/q3 #energie/2',
			indentLevel: 0,
			dueDate: '2026-08-24',
			energy: 2,
			matrixTag: '#tm/q3',
			tags: ['#tm/q3', '#energie/2']
		},
		{
			title: 'Idée en vrac',
			completed: false,
			status: 'todo',
			lineNumber: 2,
			filePath: '00 - Inbox/Idées vrac.md',
			rawLine: '- [ ] Idée en vrac #energie/1',
			indentLevel: 0,
			energy: 1,
			tags: ['#energie/1']
		}
	];

	it('should build prompt messages with formatted tasks, wikilinks and energy context', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-24',
			formattedDate: 'Lundi 24 Août 2026',
			energy: 3,
			modeText: 'Mode Économie',
			overdueTasks: [mockTasks[0]],
			todayTasks: [mockTasks[1]],
			priorityTasks: [mockTasks[0]],
			inboxTasks: [mockTasks[2]],
			projects: ['Acme Project', 'Projet Jeu Vidéo'],
			contacts: ['Claire', 'Marc Dupont']
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);

		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('Second Brain Manager');
		expect(messages[0].content).toContain('Mode Économie');
		expect(messages[0].content).toContain('Briefing du Matin');

		expect(messages[1].role).toBe('user');
		expect(messages[1].content).toContain('Lundi 24 Août 2026');
		expect(messages[1].content).toContain('Finir la maquette client');
		expect(messages[1].content).toContain('[[Acme Project]]');
		expect(messages[1].content).toContain('[[Maison]]');
		expect(messages[1].content).toContain('[[Idées vrac]]');
	});

	it('should adapt system prompt instructions for low energy mode (<=3)', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-24',
			formattedDate: 'Lundi 24 Août 2026',
			energy: 2,
			modeText: 'Mode Économie',
			overdueTasks: [],
			todayTasks: [],
			priorityTasks: [],
			inboxTasks: [],
			projects: [],
			contacts: []
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);
		expect(messages[0].content).toContain('Mode Économie');
		expect(messages[0].content).toContain('1 seule tâche essentielle');
	});
});
