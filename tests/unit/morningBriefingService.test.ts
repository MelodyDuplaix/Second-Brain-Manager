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
			domainTags: ['#tm/q1', '#energie/6']
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
			domainTags: ['#tm/q3', '#energie/2']
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
			domainTags: ['#energie/1']
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
					domainTags: ['#energie/5']
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
				domainTags: []
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

	it('should extract and sanitize json:actions proposals from LLM response', () => {
		const rawResponse = `Voici votre briefing.
### Tri & Délestage
- Report de la tâche de ménage.

\`\`\`json:actions
[
  {
    "type": "update_task",
    "targetPath": "01 - Projets/Acme.md",
    "lineNumber": 2,
    "taskTitle": "Maquette client",
    "newDueDate": "2026-08-28",
    "reason": "Replanifier à vendredi"
  }
]
\`\`\``;

		const vaultTasks: ObsidianTask[] = [
			{
				title: 'Maquette client',
				completed: false,
				status: 'todo',
				lineNumber: 2,
				filePath: '01 - Projets/Acme.md',
				rawLine: '- [ ] Maquette client',
				indentLevel: 0,
				domainTags: []
			}
		];

		const { cleanText, proposals } = MorningBriefingService.extractProposalsFromResponse(rawResponse, vaultTasks, '2026-08-24');

		expect(cleanText).not.toContain('```json:actions');
		expect(cleanText).toContain('Voici votre briefing.');
		expect(proposals).toHaveLength(1);
		expect(proposals[0].type).toBe('update_task');
		expect((proposals[0] as any).newDueDate).toBe('2026-08-28');
	});

	it('should trigger recovery mode prompt with wide triage when isRecoveryMode is true', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-26',
			formattedDate: 'Mercredi 26 Août 2026',
			energy: 4,
			modeText: 'Mode Équilibré',
			inactivityText: 'Reprise après 5 jour(s) de pause',
			inactivityDays: 5,
			isRecoveryMode: true,
			isCluttered: true,
			quickWinTasks: [mockTasks[0]],
			oneThingTask: mockTasks[1],
			overdueTasks: [mockTasks[0], mockTasks[1]],
			staleTasks: [mockTasks[0]],
			todayTasks: [],
			priorityTasks: [mockTasks[1]],
			inboxTasks: [mockTasks[2]],
			projectTasks: [],
			looseNotes: ['Liste appel vrac.md'],
			inboxNotePreviews: [{ path: 'Notes en vrac/Liste.md', name: 'Liste', preview: 'Antoine' }],
			folders: ['01 - Projets', '02 - Domaines'],
			projects: ['Acme Project'],
			contacts: ['Marc Dupont']
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);

		expect(messages).toHaveLength(2);
		expect(messages[0].content).toContain('Mode Reprise & Décongestion Large');
		expect(messages[0].content).toContain('TRI LARGE et EXHAUSTIF');
		expect(messages[1].content).toContain('THE ONE THING');
		expect(messages[1].content).toContain('QUICK WINS DISPONIBLES');
		expect(messages[1].content).toContain('Reprise après 5 jour(s) de pause');
	});

	it('should calculate inactivity correctly', () => {
		expect(MorningBriefingService.calculateInactivity(undefined).inactivityText).toBe('Reprise de session');
		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
		expect(MorningBriefingService.calculateInactivity(threeDaysAgo).inactivityDays).toBe(3);
	});

	it('should include Google Calendar events as top priority in briefing messages', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-28',
			formattedDate: 'Vendredi 28 Août 2026',
			energy: 8,
			modeText: 'Mode Plein Potentiel',
			overdueTasks: [],
			todayTasks: [mockTasks[0]],
			priorityTasks: [mockTasks[0]],
			inboxTasks: [],
			projectTasks: [],
			projects: ['Acme Project'],
			contacts: [],
			calendarEventsText: '- ⭐ [RENDEZ-VOUS FIXE PRIORITAIRE] 09:00 - 10:00 : **Réunion Lancement** (Lieu : Meet)'
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);
		expect(messages[0].content).toContain('PRISE EN COMPTE DES AGENDAS');
		expect(messages[0].content).toContain('Rendez-vous & Contraintes Fixes de l\'Agenda');
		expect(messages[1].content).toContain('AGENDA & CRÉNEAUX DU JOUR (Google Calendar - PRIORITÉ ABSOLUE)');
		expect(messages[1].content).toContain('Réunion Lancement');
	});

	it('should inject custom user prompt instructions when provided', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-28',
			formattedDate: 'Vendredi 28 Août 2026',
			energy: 7,
			modeText: 'Mode Équilibré',
			overdueTasks: [],
			todayTasks: [],
			priorityTasks: [],
			inboxTasks: [],
			projectTasks: [],
			projects: [],
			contacts: [],
			customPromptInstructions: 'Consigne personnalisée : toujours réserver 15 min de pause à 11h.'
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);
		expect(messages[0].content).toContain('INSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L\'UTILISATEUR');
		expect(messages[0].content).toContain('toujours réserver 15 min de pause à 11h.');
	});

	it('should include priority folders, files, tags and properties in briefing messages', () => {
		const data: BriefingVaultData = {
			dateStr: '2026-08-28',
			formattedDate: 'Vendredi 28 Août 2026',
			energy: 7,
			modeText: 'Mode Équilibré',
			priorityFolders: ['01 - Projets/Rapport'],
			priorityFiles: ['01 - Projets/CahierDesCharges.md'],
			priorityTags: ['urgent', 'focus'],
			priorityProperties: ['priorite: haute'],
			userPrioritizedTasks: [mockTasks[0]],
			overdueTasks: [],
			todayTasks: [],
			priorityTasks: [mockTasks[0]],
			inboxTasks: [],
			projectTasks: [],
			projects: ['Rapport'],
			contacts: []
		};

		const messages = MorningBriefingService.buildBriefingMessages(data);
		expect(messages[0].content).toContain('Dossiers/Fichiers/Tags/Tâches prioritaires');
		expect(messages[1].content).toContain('FOCUS & PRIORITÉS DU JOUR DÉFINIES PAR L\'UTILISATEUR');
		expect(messages[1].content).toContain('01 - Projets/Rapport');
		expect(messages[1].content).toContain('01 - Projets/CahierDesCharges.md');
		expect(messages[1].content).toContain('#urgent, #focus');
		expect(messages[1].content).toContain('priorite: haute');
		expect(messages[1].content).toContain('Finir la maquette client');
	});

	it('should suggest paused tasks ONLY when canSuggestPausedTasks is true (< 3 actionable tasks)', () => {
		const pausedTask: ObsidianTask = {
			title: 'Refonte du site web',
			completed: false,
			status: 'paused',
			isPaused: true,
			lineNumber: 10,
			filePath: '01 - Projets/Web.md',
			rawLine: '- [ ] Refonte du site web #pause',
			indentLevel: 0
		};

		const dataWithOpportunity: BriefingVaultData = {
			dateStr: '2026-08-29',
			formattedDate: 'Samedi 29 Août 2026',
			energy: 8,
			modeText: 'Mode Plein Potentiel',
			overdueTasks: [],
			todayTasks: [mockTasks[1]], // Only 1 task
			priorityTasks: [],
			inboxTasks: [],
			projectTasks: [],
			pausedTasks: [pausedTask],
			canSuggestPausedTasks: true,
			projects: [],
			contacts: []
		};

		const messages = MorningBriefingService.buildBriefingMessages(dataWithOpportunity);
		expect(messages[0].content).toContain('Opportunité - Tâches en Pause');
		expect(messages[0].content).toContain('moins de 3 tâches en retard');
		expect(messages[1].content).toContain('TACHES EN PAUSE DISPONIBLES (1 au total)');
		expect(messages[1].content).toContain('Refonte du site web');
	});

	it('should NOT suggest paused tasks when canSuggestPausedTasks is false (>= 3 tasks)', () => {
		const pausedTask: ObsidianTask = {
			title: 'Refonte du site web',
			completed: false,
			status: 'paused',
			isPaused: true,
			lineNumber: 10,
			filePath: '01 - Projets/Web.md',
			rawLine: '- [ ] Refonte du site web #pause',
			indentLevel: 0
		};

		const busyData: BriefingVaultData = {
			dateStr: '2026-08-29',
			formattedDate: 'Samedi 29 Août 2026',
			energy: 5,
			modeText: 'Mode Équilibré',
			overdueTasks: [mockTasks[0]],
			todayTasks: [mockTasks[1]],
			priorityTasks: [mockTasks[0]],
			inboxTasks: [mockTasks[2]],
			projectTasks: [],
			pausedTasks: [pausedTask],
			canSuggestPausedTasks: false,
			projects: [],
			contacts: []
		};

		const messages = MorningBriefingService.buildBriefingMessages(busyData);
		expect(messages[0].content).not.toContain('Opportunité - Tâches en Pause');
		expect(messages[1].content).not.toContain('TACHES EN PAUSE DISPONIBLES');
		expect(messages[1].content).not.toContain('Refonte du site web');
	});

	it('should include adhoc priority and priority tags in briefing messages', () => {
		const dataWithAdhoc: BriefingVaultData = {
			dateStr: '2026-08-29',
			formattedDate: 'Samedi 29 Août 2026',
			energy: 7,
			modeText: 'Mode Équilibré',
			overdueTasks: [],
			todayTasks: [mockTasks[0]],
			priorityTasks: [mockTasks[0]],
			inboxTasks: [],
			projectTasks: [],
			projects: ['Acme'],
			contacts: [],
			priorityTags: ['client-vip', 'urgence'],
			adhocPriority: 'Préparer la réunion avec le PDG à 14h'
		};

		const messages = MorningBriefingService.buildBriefingMessages(dataWithAdhoc);
		expect(messages[0].content).toContain('Priorité Spécifique Directe de l\'Utilisateur');
		expect(messages[0].content).toContain('Préparer la réunion avec le PDG à 14h');
		expect(messages[1].content).toContain('OBJECTIF & PRIORITÉ DU JOUR FIXÉE DIRECTEMENT PAR L\'UTILISATEUR (PRIORITÉ ABSOLUE)');
		expect(messages[1].content).toContain('Préparer la réunion avec le PDG à 14h');
		expect(messages[1].content).toContain('Tags prioritaires sélectionnés / configurés : #client-vip, #urgence');
	});
});
