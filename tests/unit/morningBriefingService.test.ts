import { describe, it, expect } from 'vitest';
import { MorningBriefingService, BriefingVaultData } from '../../src/services/morningBriefingService';
import { ObsidianTask } from '../../src/models/task';
import { DEFAULT_SETTINGS } from '../../src/main';
import { TFile, App } from 'obsidian';

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
			projectTasks: [],
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

	it('should integrate focus project directives when a specific project is selected', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-24',
			formattedDate: 'Lundi 24 Août 2026',
			energy: 7,
			modeText: 'Mode Équilibré',
			focusProject: 'Projet Jeu Vidéo',
			overdueTasks: [],
			todayTasks: [],
			priorityTasks: [],
			inboxTasks: [],
			projectTasks: [
				{
					title: 'Coder le moteur physique',
					completed: false,
					status: 'todo',
					lineNumber: 1,
					filePath: '01 - Projets/Projet Jeu Vidéo.md',
					rawLine: '- [ ] Coder le moteur physique #energie/5',
					indentLevel: 0,
					tags: ['#energie/5']
				}
			],
			projects: ['Projet Jeu Vidéo'],
			contacts: []
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);
		expect(messages[0].content).toContain('Projet Focus Majeur');
		expect(messages[0].content).toContain('Projet Jeu Vidéo');
		expect(messages[1].content).toContain('PROJET PRIORITAIRE DU JOUR');
		expect(messages[1].content).toContain('Coder le moteur physique');
	});

	it('should save briefing to daily note using vault API', async () => {
		const files: Record<string, string> = {};
		const mockPlugin = {
			settings: {
				...DEFAULT_SETTINGS,
				dailyNotesFolder: '04 - Journal',
				energyLevel: 6
			}
		};

		const createMockTFile = (path: string): TFile => {
			const f = new TFile();
			f.path = path;
			f.basename = path.split('/').pop()?.replace('.md', '') || '';
			return f;
		};

		const mockApp = {
			vault: {
				getFolderByPath: () => ({ path: '04 - Journal' }),
				createFolder: () => Promise.resolve(),
				getFileByPath: (p: string) => (files[p] !== undefined ? createMockTFile(p) : null),
				getAbstractFileByPath: () => null,
				create: (p: string, c: string) => { files[p] = c; return Promise.resolve(createMockTFile(p)); },
				process: async (f: TFile, cb: (content: string) => string) => {
					files[f.path] = cb(files[f.path] || '');
					return files[f.path];
				}
			}
		} as unknown as App;

		const targetPath = await MorningBriefingService.saveBriefingToDailyNote(
			mockApp,
			mockPlugin as any,
			'### 🌅 Cap du Jour\nFinir le jeu vidéo.',
			'2026-08-24'
		);

		expect(targetPath).toBe('04 - Journal/2026-08-24.md');
		expect(files['04 - Journal/2026-08-24.md']).toContain('## 🌅 Briefing & Focus du Jour');
		expect(files['04 - Journal/2026-08-24.md']).toContain('Finir le jeu vidéo.');
	});

	it('should plan recommended tasks for today in source files', async () => {
		const files: Record<string, string> = {
			'01 - Projets/Acme.md': '# Acme\n- [ ] Maquette client\n- [ ] Contrat'
		};

		const mockPlugin = {
			settings: {
				...DEFAULT_SETTINGS
			}
		};

		const createMockTFile = (path: string): TFile => {
			const f = new TFile();
			f.path = path;
			f.basename = path.split('/').pop()?.replace('.md', '') || '';
			return f;
		};

		const mockApp = {
			vault: {
				getFileByPath: (p: string) => (files[p] !== undefined ? createMockTFile(p) : null),
				getAbstractFileByPath: () => null,
				process: async (f: TFile, cb: (content: string) => string) => {
					files[f.path] = cb(files[f.path] || '');
					return files[f.path];
				}
			}
		} as unknown as App;

		const tasksToPlan: ObsidianTask[] = [
			{
				title: 'Maquette client',
				completed: false,
				status: 'todo',
				lineNumber: 2,
				filePath: '01 - Projets/Acme.md',
				rawLine: '- [ ] Maquette client',
				indentLevel: 0,
				tags: []
			}
		];

		const count = await MorningBriefingService.planTasksForToday(
			mockApp,
			mockPlugin as any,
			tasksToPlan,
			'2026-08-24'
		);

		expect(count).toBe(1);
		expect(files['01 - Projets/Acme.md']).toContain('📅 2026-08-24');
	});
});
