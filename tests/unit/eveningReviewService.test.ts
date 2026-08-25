import { describe, it, expect } from 'vitest';
import { EveningReviewService, EveningVaultData } from '../../src/services/eveningReviewService';
import { ObsidianTask } from '../../src/models/task';
import { DEFAULT_SETTINGS } from '../../src/main';
import { TFile, App } from 'obsidian';

describe('EveningReviewService', () => {
	const mockTasks: ObsidianTask[] = [
		{
			title: 'Finir la maquette client',
			completed: true,
			status: 'done',
			lineNumber: 5,
			filePath: '01 - Projets/Acme Project.md',
			rawLine: '- [x] Finir la maquette client 📅 2026-08-24 ✅ 2026-08-24 #pieces/5',
			indentLevel: 0,
			dueDate: '2026-08-24',
			completedDate: '2026-08-24',
			pieces: 5,
			domainTags: ['#pieces/5']
		},
		{
			title: 'Rédiger le rapport financier',
			completed: false,
			status: 'todo',
			lineNumber: 12,
			filePath: '01 - Projets/Finance.md',
			rawLine: '- [ ] Rédiger le rapport financier 📅 2026-08-24 #energie/5',
			indentLevel: 0,
			dueDate: '2026-08-24',
			energy: 5,
			domainTags: ['#energie/5']
		},
		{
			title: 'Payer la facture d\'électricité',
			completed: false,
			status: 'todo',
			lineNumber: 8,
			filePath: '02 - Domaines/Maison.md',
			rawLine: '- [ ] Payer la facture d\'électricité 📅 2026-08-20',
			indentLevel: 0,
			dueDate: '2026-08-20',
			domainTags: []
		}
	];

	it('should build positive and structured evening prompt messages', () => {
		const data: EveningVaultData = {
			dateStr: '2026-08-24',
			formattedDate: 'Lundi 24 Août 2026',
			completedTodayTasks: [mockTasks[0]],
			coinsEarnedToday: 5,
			unfinishedTodayTasks: [mockTasks[1]],
			overdueTasks: [mockTasks[2]],
			inboxNotes: ['Note réunion express'],
			projects: ['Acme Project', 'Finance'],
			contacts: ['Claire']
		};

		const messages = EveningReviewService.buildEveningMessages(data);

		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('Revue du Soir');
		expect(messages[0].content).toContain('Bienveillant');

		expect(messages[1].role).toBe('user');
		expect(messages[1].content).toContain('Lundi 24 Août 2026');
		expect(messages[1].content).toContain('Finir la maquette client');
		expect(messages[1].content).toContain('+5 pieces');
		expect(messages[1].content).toContain('[[Note réunion express]]');
	});

	it('should save evening review to daily note section cleanly', async () => {
		const files: Record<string, string> = {};
		const mockPlugin = {
			settings: {
				...DEFAULT_SETTINGS,
				dailyNotesFolder: '04 - Journal'
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

		const targetPath = await EveningReviewService.saveReviewToDailyNote(
			mockApp,
			mockPlugin as any,
			'### 🌙 Bilan\nTrès bonne journée de travail !',
			'2026-08-24'
		);

		expect(targetPath).toBe('04 - Journal/2026-08-24.md');
		expect(files['04 - Journal/2026-08-24.md']).toContain('## 🌙 Revue du Soir & Bilan');
		expect(files['04 - Journal/2026-08-24.md']).toContain('Très bonne journée de travail !');
	});

	it('should defer unfinished tasks to tomorrow in vault files', async () => {
		const files: Record<string, string> = {
			'01 - Projets/Finance.md': '# Finance\n- [ ] Rédiger le rapport financier 📅 2026-08-24'
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

		const tasksToDefer: ObsidianTask[] = [
			{
				title: 'Rédiger le rapport financier',
				completed: false,
				status: 'todo',
				lineNumber: 2,
				filePath: '01 - Projets/Finance.md',
				rawLine: '- [ ] Rédiger le rapport financier 📅 2026-08-24',
				indentLevel: 0,
				dueDate: '2026-08-24',
				domainTags: []
			}
		];

		const count = await EveningReviewService.deferUnfinishedTasksToTomorrow(
			mockApp,
			mockPlugin as any,
			tasksToDefer
		);

		expect(count).toBe(1);
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];
		expect(files['01 - Projets/Finance.md']).toContain(`📅 ${tomorrowStr}`);
	});
});
