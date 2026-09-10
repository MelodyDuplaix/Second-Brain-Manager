import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarTaskSyncService } from '../../src/services/calendarTaskSyncService';
import { DEFAULT_SETTINGS, SecondBrainSettings } from '../../src/main';
import { GoogleCalendarEvent } from '../../src/models/googleCalendar';
import { GoogleCalendarService } from '../../src/services/googleCalendarService';
import { ToolRegistry } from '../../src/services/toolRegistry';
import { VaultContextService } from '../../src/services/vaultContextService';
import { TFile, App } from 'obsidian';

describe('CalendarTaskSyncService', () => {
	const mockEventTimed: GoogleCalendarEvent = {
		id: 'ev-1',
		summary: 'Point équipe MFRB',
		start: { dateTime: '2026-09-10T10:00:00+02:00' },
		end: { dateTime: '2026-09-10T11:00:00+02:00' },
		allDay: false,
		calendarId: 'primary',
		calendarName: 'Mon Agenda Principal'
	};

	const mockEventWithLocation: GoogleCalendarEvent = {
		id: 'ev-2',
		summary: 'Déjeuner client',
		location: 'Bistro Paris 11',
		start: { dateTime: '2026-09-10T12:30:00+02:00' },
		end: { dateTime: '2026-09-10T14:00:00+02:00' },
		allDay: false,
		calendarId: 'primary'
	};

	const mockEventAllDay: GoogleCalendarEvent = {
		id: 'ev-3',
		summary: 'Séminaire annuel',
		start: { date: '2026-09-10' },
		end: { date: '2026-09-10' },
		allDay: true,
		calendarId: 'primary'
	};

	it('should format timed event titles with time range and location', () => {
		const titleTimed = CalendarTaskSyncService.formatEventToTaskTitle(mockEventTimed);
		expect(titleTimed).toContain('Point équipe MFRB');
		expect(titleTimed).toMatch(/\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/);

		const titleLoc = CalendarTaskSyncService.formatEventToTaskTitle(mockEventWithLocation);
		expect(titleLoc).toContain('Déjeuner client');
		expect(titleLoc).toContain('📍 Bistro Paris 11');

		const titleAllDay = CalendarTaskSyncService.formatEventToTaskTitle(mockEventAllDay);
		expect(titleAllDay).toBe('Séminaire annuel');
	});

	it('should format task lines according to taskFormat settings (dataview vs tasks)', () => {
		const dvSettings: SecondBrainSettings = {
			...DEFAULT_SETTINGS,
			taskFormat: 'dataview',
			googleRefreshToken: 'fake-token'
		};
		const lineDv = CalendarTaskSyncService.formatEventTaskLine(mockEventTimed, '2026-09-10', dvSettings, '#rdv');
		expect(lineDv).toContain('- [ ]');
		expect(lineDv).toContain('Point équipe MFRB');
		expect(lineDv).toContain('#rdv');
		expect(lineDv).toContain('[scheduled:: 2026-09-10]');

		const tasksSettings: SecondBrainSettings = {
			...DEFAULT_SETTINGS,
			taskFormat: 'tasks',
			scheduledDateSignifier: '⏳',
			googleRefreshToken: 'fake-token'
		};
		const lineTasks = CalendarTaskSyncService.formatEventTaskLine(mockEventTimed, '2026-09-10', tasksSettings, '#rdv');
		expect(lineTasks).toContain('- [ ]');
		expect(lineTasks).toContain('Point équipe MFRB');
		expect(lineTasks).toContain('#rdv');
		expect(lineTasks).toContain('⏳ 2026-09-10');
	});

	it('should accurately detect if an event is already present in note content', () => {
		const contentExisting = `# Journal du 10-09-2026

## Taches à faire
- [ ] 10:00 - 11:00 Point équipe MFRB #rdv [scheduled:: 2026-09-10]
- [ ] Prendre médicament allergie [scheduled:: 2026-09-10]
`;
		expect(CalendarTaskSyncService.isEventAlreadyInNote(contentExisting, mockEventTimed)).toBe(true);
		expect(CalendarTaskSyncService.isEventAlreadyInNote(contentExisting, mockEventWithLocation)).toBe(false);
	});

	it('should detect existing event even if already checked or slightly reformulated', () => {
		const contentChecked = `# Journal

## Taches faites
- [x] Point équipe MFRB [scheduled:: 2026-09-10] [completion:: 2026-09-10]
`;
		expect(CalendarTaskSyncService.isEventAlreadyInNote(contentChecked, mockEventTimed)).toBe(true);
	});

	describe('syncCalendarEventsToDailyNote & proposals', () => {
		let filesStore: Record<string, string>;
		let mockApp: App;

		beforeEach(() => {
			filesStore = {
				'Note quotidienne/10-09-2026.md': `# Journal du 10-09-2026

## Taches à faire
- [ ] Prendre médicament allergie [scheduled:: 2026-09-10]

## Taches prévu aujourd'hui
\`\`\`tasks
not done
scheduled today
\`\`\`
`
			};

			const createMockFile = (path: string): TFile => {
				const f = new TFile();
				f.path = path;
				f.basename = path.split('/').pop()?.replace('.md', '') || '';
				return f;
			};

			mockApp = {
				vault: {
					getMarkdownFiles: () => Object.keys(filesStore).map(createMockFile),
					getFileByPath: (p: string) => (filesStore[p] !== undefined ? createMockFile(p) : null),
					getAbstractFileByPath: (p: string) => (filesStore[p] !== undefined ? createMockFile(p) : null),
					read: async (f: TFile) => filesStore[f.path] || '',
					cachedRead: async (f: TFile) => filesStore[f.path] || '',
					modify: async (f: TFile, content: string) => {
						filesStore[f.path] = content;
					},
					create: async (p: string, content: string) => {
						filesStore[p] = content;
						return createMockFile(p);
					},
					process: async (f: TFile, fn: (c: string) => string) => {
						filesStore[f.path] = fn(filesStore[f.path] || '');
						return filesStore[f.path];
					}
				},
				workspace: {
					openLinkText: vi.fn()
				}
			} as unknown as App;
		});

		it('should return an error if googleRefreshToken is not configured', async () => {
			const settingsWithoutToken: SecondBrainSettings = {
				...DEFAULT_SETTINGS,
				googleRefreshToken: ''
			};

			const res = await CalendarTaskSyncService.syncCalendarEventsToDailyNote(mockApp, settingsWithoutToken, {
				targetDate: '2026-09-10'
			});

			expect(res.success).toBe(false);
			expect(res.error).toContain('Google Calendar');
		});

		it('should import calendar events into daily note under Taches à faire and prevent duplicates on re-run', async () => {
			const settings: SecondBrainSettings = {
				...DEFAULT_SETTINGS,
				googleRefreshToken: 'token-abc',
				dailyNotesFolder: 'Note quotidienne',
				dailyNoteTemplatePath: ''
			};

			// Mock GoogleCalendarService.getEvents
			vi.spyOn(GoogleCalendarService, 'getEvents').mockResolvedValue([
				mockEventTimed,
				mockEventWithLocation
			]);
			vi.spyOn(GoogleCalendarService, 'isEventOnDate').mockReturnValue(true);

			// Première exécution : importation des 2 événements
			const res1 = await CalendarTaskSyncService.syncCalendarEventsToDailyNote(mockApp, settings, {
				targetDate: '2026-09-10'
			});

			expect(res1.success).toBe(true);
			expect(res1.eventsFound).toBe(2);
			expect(res1.tasksCreated).toBe(2);
			expect(res1.tasksAlreadyExisting).toBe(0);

			const updatedContent = filesStore['Note quotidienne/10-09-2026.md'];
			expect(updatedContent).toContain('Point équipe MFRB');
			expect(updatedContent).toContain('Déjeuner client');
			expect(updatedContent).toContain('#rdv');

			// Deuxième exécution : idempotence et anti-doublon
			const res2 = await CalendarTaskSyncService.syncCalendarEventsToDailyNote(mockApp, settings, {
				targetDate: '2026-09-10'
			});

			expect(res2.success).toBe(true);
			expect(res2.tasksCreated).toBe(0);
			expect(res2.tasksAlreadyExisting).toBe(2);
		});

		it('should generate proposals for calendar events when requested', async () => {
			const settings: SecondBrainSettings = {
				...DEFAULT_SETTINGS,
				googleRefreshToken: 'token-abc',
				dailyNotesFolder: 'Note quotidienne'
			};

			vi.spyOn(GoogleCalendarService, 'getEvents').mockResolvedValue([mockEventTimed]);
			vi.spyOn(GoogleCalendarService, 'isEventOnDate').mockReturnValue(true);

			const propRes = await CalendarTaskSyncService.generateProposalsForCalendarEvents(mockApp, settings, {
				targetDate: '2026-09-10'
			});

			expect(propRes.eventsFound).toBe(1);
			expect(propRes.proposals.length).toBe(1);
			expect(propRes.proposals[0].type).toBe('create_task');
			expect(propRes.proposals[0].taskTitle).toContain('Point équipe MFRB');
			expect(propRes.proposals[0].scheduledDate).toBe('2026-09-10');
			expect(propRes.proposals[0].domainTags).toContain('#rdv');
		});

		it('should allow toolRegistry to execute import_calendar_events_as_tasks tool seamlessly', async () => {
			const settings: SecondBrainSettings = {
				...DEFAULT_SETTINGS,
				googleRefreshToken: 'token-abc',
				dailyNotesFolder: 'Note quotidienne'
			};

			vi.spyOn(GoogleCalendarService, 'getEvents').mockResolvedValue([mockEventTimed]);
			vi.spyOn(GoogleCalendarService, 'isEventOnDate').mockReturnValue(true);

			const vaultContext = new VaultContextService(mockApp, settings);
			const registry = new ToolRegistry(vaultContext, settings);

			const toolRes = await registry.executeTool({
				name: 'import_calendar_events_as_tasks',
				arguments: {
					date: '2026-09-10'
				}
			});

			expect(toolRes.output).toContain('Succès');
			expect(toolRes.output).toContain('Point équipe MFRB');
			expect(filesStore['Note quotidienne/10-09-2026.md']).toContain('Point équipe MFRB');
		});
	});
});
