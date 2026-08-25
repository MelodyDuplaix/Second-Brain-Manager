import { describe, it, expect } from 'vitest';
import { RecoveryService, RecoveryVaultData } from '../../src/services/recoveryService';
import { ObsidianTask } from '../../src/models/task';
import { DEFAULT_SETTINGS } from '../../src/main';
import { TFile, App } from 'obsidian';

describe('RecoveryService', () => {
	const mockTasks: ObsidianTask[] = [
		{
			title: 'Envoyer le mail de relance',
			completed: false,
			status: 'todo',
			lineNumber: 4,
			filePath: '01 - Projets/Acme.md',
			rawLine: '- [ ] Envoyer le mail de relance #difficulte/facile #energie/2',
			indentLevel: 0,
			energy: 2,
			difficulty: 'facile',
			domainTags: ['#difficulte/facile', '#energie/2']
		},
		{
			title: 'Finaliser le rapport annuel stratégique',
			completed: false,
			status: 'todo',
			lineNumber: 10,
			filePath: '01 - Projets/Strategie.md',
			rawLine: '- [ ] Finaliser le rapport annuel stratégique 📅 2026-08-20 #tm/q1',
			indentLevel: 0,
			dueDate: '2026-08-20',
			matrixTag: '#tm/q1',
			domainTags: ['#tm/q1']
		},
		{
			title: 'Nettoyer le bureau',
			completed: false,
			status: 'todo',
			lineNumber: 15,
			filePath: '02 - Domaines/Maison.md',
			rawLine: '- [ ] Nettoyer le bureau 📅 2026-08-10',
			indentLevel: 0,
			dueDate: '2026-08-10',
			domainTags: []
		}
	];

	describe('calculateInactivity', () => {
		it('should handle undefined timestamp gracefully', () => {
			const res = RecoveryService.calculateInactivity(undefined);
			expect(res.inactivityText).toBe('Reprise de session');
			expect(res.inactivityDays).toBe(0);
		});

		it('should format hours correctly', () => {
			const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
			const res = RecoveryService.calculateInactivity(fourHoursAgo);
			expect(res.inactivityText).toContain('4 heures de pause');
		});

		it('should format days correctly', () => {
			const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
			const res = RecoveryService.calculateInactivity(threeDaysAgo);
			expect(res.inactivityText).toContain('3 jour(s) de pause');
			expect(res.inactivityDays).toBe(3);
		});

		it('should format weeks correctly', () => {
			const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
			const res = RecoveryService.calculateInactivity(twoWeeksAgo);
			expect(res.inactivityText).toContain('2 semaine(s) de pause');
			expect(res.inactivityDays).toBe(14);
		});
	});

	describe('buildRecoveryMessages', () => {
		it('should generate a structured, soft-landing recovery prompt', () => {
			const data: RecoveryVaultData = {
				dateStr: '2026-08-25',
				formattedDate: 'Mardi 25 Août 2026',
				inactivityText: 'Reprise après 3 jour(s) de pause',
				inactivityDays: 3,
				quickWinTasks: [mockTasks[0]],
				oneThingTask: mockTasks[1],
				overdueTasks: [mockTasks[1], mockTasks[2]],
				staleTasks: [mockTasks[2]],
				inboxNotes: ['Note vocale rapide', 'Idée projet'],
				projects: ['Acme', 'Strategie'],
				energy: 6
			};

			const messages = RecoveryService.buildRecoveryMessages(data);

			expect(messages).toHaveLength(2);
			expect(messages[0].role).toBe('system');
			expect(messages[0].content).toContain('Second Brain Manager');
			expect(messages[0].content).toContain('Quick Win');
			expect(messages[0].content).toContain('The One Thing');

			expect(messages[1].role).toBe('user');
			expect(messages[1].content).toContain('Reprise après 3 jour(s) de pause');
			expect(messages[1].content).toContain('Envoyer le mail de relance');
			expect(messages[1].content).toContain('Finaliser le rapport annuel stratégique');
			expect(messages[1].content).toContain('[[Note vocale rapide]]');
		});
	});

	describe('postponeOverdueTasks', () => {
		it('should postpone all overdue tasks in files to today', async () => {
			const files: Record<string, string> = {
				'01 - Projets/Strategie.md': '# Stratégie\n- [ ] Finaliser le rapport annuel stratégique 📅 2026-08-20 #tm/q1\n',
				'02 - Domaines/Maison.md': '# Maison\n- [ ] Nettoyer le bureau 📅 2026-08-10\n'
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

			const tasksToPostpone: ObsidianTask[] = [
				{
					title: 'Finaliser le rapport annuel stratégique',
					completed: false,
					status: 'todo',
					lineNumber: 2,
					filePath: '01 - Projets/Strategie.md',
					rawLine: '- [ ] Finaliser le rapport annuel stratégique 📅 2026-08-20 #tm/q1',
					indentLevel: 0,
					dueDate: '2026-08-20'
				},
				{
					title: 'Nettoyer le bureau',
					completed: false,
					status: 'todo',
					lineNumber: 2,
					filePath: '02 - Domaines/Maison.md',
					rawLine: '- [ ] Nettoyer le bureau 📅 2026-08-10',
					indentLevel: 0,
					dueDate: '2026-08-10'
				}
			];

			const count = await RecoveryService.postponeOverdueTasks(mockApp, tasksToPostpone, '2026-08-25');

			expect(count).toBe(2);
			expect(files['01 - Projets/Strategie.md']).toContain('📅 2026-08-25');
			expect(files['02 - Domaines/Maison.md']).toContain('📅 2026-08-25');
		});
	});

	describe('saveRecoveryToDailyNote', () => {
		it('should save recovery markdown to daily note section', async () => {
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
					getFileByPath: (p: string) => (files[p] !== undefined ? createMockTFile(p) : null),
					getAbstractFileByPath: () => null,
					createFolder: () => Promise.resolve(),
					create: (p: string, c: string) => { files[p] = c; return Promise.resolve(createMockTFile(p)); },
					process: async (f: TFile, cb: (content: string) => string) => {
						files[f.path] = cb(files[f.path] || '');
						return files[f.path];
					}
				}
			} as unknown as App;

			await RecoveryService.saveRecoveryToDailyNote(mockApp, mockPlugin as any, '> [!NOTE] Bon retour !');

			const today = new Date().toISOString().split('T')[0];
			const expectedPath = `04 - Journal/${today}.md`;
			expect(files[expectedPath]).toBeDefined();
			expect(files[expectedPath]).toContain('## ☕ Reprise en Douceur & Focus');
			expect(files[expectedPath]).toContain('> [!NOTE] Bon retour !');
		});
	});
});
