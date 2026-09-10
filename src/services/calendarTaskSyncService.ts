import { App } from 'obsidian';
import { GoogleCalendarEvent } from '../models/googleCalendar';
import { GoogleCalendarService } from './googleCalendarService';
import { VaultContextService, normalizeCanonicalKey } from './vaultContextService';
import { ActionExecutor } from './actionExecutor';
import { TaskMutator } from '../mutators/taskMutator';
import { SecondBrainSettings } from '../main';
import SecondBrainPlugin from '../main';
import { CreateTaskActionProposal } from '../models/actions';

export interface CalendarSyncOptions {
	targetDate?: string; // YYYY-MM-DD (défaut: aujourd'hui)
	calendarId?: string; // Calendrier spécifique ou 'primary'
	tag?: string; // Tag à ajouter (défaut: '#rdv')
	includeOtherCalendars?: boolean; // Inclure les agendas partagés d'autres personnes (défaut: false)
	openDailyNote?: boolean; // Ouvrir la note quotidienne après la synchronisation (défaut: false)
}

export interface CalendarSyncResult {
	success: boolean;
	date: string;
	dailyNotePath?: string;
	eventsFound: number;
	tasksCreated: number;
	tasksAlreadyExisting: number;
	createdTasks: string[];
	skippedTasks: string[];
	error?: string;
}

export class CalendarTaskSyncService {
	/**
	 * Formate le titre brut de la tâche à partir d'un événement d'agenda.
	 * Ex: "14:00 - 15:00 Réunion de rentrée" ou "Séminaire annuel" si toute la journée.
	 */
	public static formatEventToTaskTitle(ev: GoogleCalendarEvent): string {
		const summary = ev.summary?.trim() || 'Rendez-vous sans titre';

		if (ev.allDay || !ev.start?.dateTime) {
			return summary;
		}

		try {
			const startDate = new Date(ev.start.dateTime);
			const startTime = startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

			let timePrefix = startTime;
			if (ev.end?.dateTime) {
				const endDate = new Date(ev.end.dateTime);
				const endTime = endDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
				if (endTime !== startTime) {
					timePrefix = `${startTime} - ${endTime}`;
				}
			}

			let title = `${timePrefix} ${summary}`;
			if (ev.location && ev.location.trim()) {
				title += ` (📍 ${ev.location.trim()})`;
			}
			return title;
		} catch {
			return summary;
		}
	}

	/**
	 * Génère une ligne de tâche Markdown canonique complète pour l'événement.
	 * Ex (Dataview) : "- [ ] 14:00 - 15:00 Réunion de rentrée #rdv [scheduled:: 2026-09-10]"
	 * Ex (Tasks) :    "- [ ] 14:00 - 15:00 Réunion de rentrée #rdv ⏳ 2026-09-10"
	 */
	public static formatEventTaskLine(
		ev: GoogleCalendarEvent,
		dateStr: string,
		settings: SecondBrainSettings,
		tag: string = '#rdv'
	): string {
		const rawTitle = this.formatEventToTaskTitle(ev);
		const cleanTitle = TaskMutator.cleanTaskPrefix(rawTitle);

		let taskLine = `- [ ] ${cleanTitle}`;

		if (tag && tag.trim()) {
			const cleanTag = tag.trim().startsWith('#') ? tag.trim() : `#${tag.trim()}`;
			if (!taskLine.includes(cleanTag)) {
				taskLine += ` ${cleanTag}`;
			}
		}

		// Ajout de la date planifiée (scheduled)
		taskLine = TaskMutator.setScheduledDate(taskLine, dateStr, settings);

		return taskLine;
	}

	/**
	 * Vérifie si un événement de calendrier est déjà représenté sous forme de tâche dans le contenu de la note.
	 */
	public static isEventAlreadyInNote(content: string, ev: GoogleCalendarEvent): boolean {
		const rawSummary = ev.summary?.trim().toLowerCase();
		if (!rawSummary) return false;

		const canonicalSummary = normalizeCanonicalKey(rawSummary);
		if (!canonicalSummary) return false;

		const lines = content.replace(/\r\n/g, '\n').split('\n');

		for (const line of lines) {
			const trimmed = line.trim();
			// On ne vérifie que les lignes de tâches
			if (/^[-*+]\s+\[[- xX/><~]\]/.test(trimmed)) {
				const coreTitle = ActionExecutor.extractCoreTaskTitle(trimmed).toLowerCase();
				const canonicalCore = normalizeCanonicalKey(coreTitle);

				// 1. Correspondance exacte ou inclusion
				if (canonicalCore === canonicalSummary || canonicalCore.includes(canonicalSummary) || canonicalSummary.includes(canonicalCore)) {
					return true;
				}

				// 2. Si le titre brut contient le summary
				if (coreTitle.includes(rawSummary) || rawSummary.includes(coreTitle)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Récupère et filtre les événements Google Calendar pertinents pour la date donnée.
	 */
	public static async fetchRelevantEvents(
		settings: SecondBrainSettings,
		options: {
			targetDate: string;
			calendarId?: string;
			includeOtherCalendars?: boolean;
		}
	): Promise<GoogleCalendarEvent[]> {
		const { targetDate, calendarId, includeOtherCalendars } = options;

		const startOfDay = new Date(`${targetDate}T00:00:00`);
		const endOfDay = new Date(`${targetDate}T23:59:59.999`);

		const events = await GoogleCalendarService.getEvents(settings, {
			timeMin: startOfDay.toISOString(),
			timeMax: endOfDay.toISOString(),
			calendarIds: calendarId ? [calendarId] : undefined
		});

		const calendarsConfig = settings.calendarsConfig || {};
		const defaultCalId = settings.defaultCalendarId || 'primary';

		return events.filter(ev => {
			// Doit avoir lieu à la date demandée
			if (!GoogleCalendarService.isEventOnDate(ev, targetDate)) {
				return false;
			}

			const calId = ev.calendarId;
			let role = 'primary';
			if (calId && calendarsConfig[calId]) {
				role = calendarsConfig[calId].role;
			} else if (calId && calId !== defaultCalId && !ev.calendarName?.toLowerCase().includes('principal')) {
				role = 'other_person';
			}

			// Exclure les calendriers ignorés
			if (role === 'ignore') return false;

			// Exclure les agendas d'autres personnes sauf si expressément demandé
			if (role === 'other_person' && !includeOtherCalendars) {
				return false;
			}

			return true;
		});
	}

	/**
	 * Synchronise les rendez-vous de l'agenda dans la note quotidienne de la date spécifiée (ou aujourd'hui).
	 */
	public static async syncCalendarEventsToDailyNote(
		app: App,
		pluginOrSettings: SecondBrainPlugin | SecondBrainSettings,
		options: CalendarSyncOptions = {}
	): Promise<CalendarSyncResult> {
		const settings: SecondBrainSettings = (pluginOrSettings as any).settings ? (pluginOrSettings as any).settings : (pluginOrSettings as SecondBrainSettings);
		const targetDate = options.targetDate || new Date().toISOString().split('T')[0];
		const tag = options.tag !== undefined ? options.tag : '#rdv';

		if (!settings.googleRefreshToken) {
			return {
				success: false,
				date: targetDate,
				eventsFound: 0,
				tasksCreated: 0,
				tasksAlreadyExisting: 0,
				createdTasks: [],
				skippedTasks: [],
				error: 'Google Calendar n\'est pas configuré ou connecté. Veuillez renseigner vos identifiants dans les réglages du plugin.'
			};
		}

		let relevantEvents: GoogleCalendarEvent[] = [];
		try {
			relevantEvents = await this.fetchRelevantEvents(settings, {
				targetDate,
				calendarId: options.calendarId,
				includeOtherCalendars: options.includeOtherCalendars
			});
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				date: targetDate,
				eventsFound: 0,
				tasksCreated: 0,
				tasksAlreadyExisting: 0,
				createdTasks: [],
				skippedTasks: [],
				error: `Erreur lors de la récupération des événements Google Calendar : ${errorMsg}`
			};
		}

		if (relevantEvents.length === 0) {
			return {
				success: true,
				date: targetDate,
				eventsFound: 0,
				tasksCreated: 0,
				tasksAlreadyExisting: 0,
				createdTasks: [],
				skippedTasks: []
			};
		}

		const vaultContext = new VaultContextService(app, settings);
		const dailyRes = await vaultContext.getOrCreateDailyNote(targetDate, settings.dailyNoteTemplatePath);
		const dailyFile = dailyRes.file;
		const dailyPath = dailyRes.path;

		let fileContent = await app.vault.read(dailyFile);
		const createdTasks: string[] = [];
		const skippedTasks: string[] = [];
		let tasksCreated = 0;
		let tasksAlreadyExisting = 0;

		for (const ev of relevantEvents) {
			if (this.isEventAlreadyInNote(fileContent, ev)) {
				skippedTasks.push(ev.summary || 'Sans titre');
				tasksAlreadyExisting++;
				continue;
			}

			const taskLine = this.formatEventTaskLine(ev, targetDate, settings, tag);
			fileContent = ActionExecutor.insertTaskIntoNoteContent(fileContent, taskLine);
			createdTasks.push(taskLine);
			tasksCreated++;
		}

		if (tasksCreated > 0) {
			await app.vault.modify(dailyFile, fileContent);
		}

		if (options.openDailyNote) {
			await vaultContext.openDailyNoteInWorkspace(dailyFile);
		}

		return {
			success: true,
			date: targetDate,
			dailyNotePath: dailyPath,
			eventsFound: relevantEvents.length,
			tasksCreated,
			tasksAlreadyExisting,
			createdTasks,
			skippedTasks
		};
	}

	/**
	 * Génère des propositions d'actions CreateTaskActionProposal pour chaque RDV non encore présent dans la note quotidienne.
	 * Utile pour l'agent LLM ou le Briefing du matin.
	 */
	public static async generateProposalsForCalendarEvents(
		app: App,
		pluginOrSettings: SecondBrainPlugin | SecondBrainSettings,
		options: CalendarSyncOptions = {}
	): Promise<{ proposals: CreateTaskActionProposal[]; eventsFound: number; alreadyExisting: number; dailyNotePath: string }> {
		const settings: SecondBrainSettings = (pluginOrSettings as any).settings ? (pluginOrSettings as any).settings : (pluginOrSettings as SecondBrainSettings);
		const targetDate = options.targetDate || new Date().toISOString().split('T')[0];
		const tag = options.tag !== undefined ? options.tag : '#rdv';

		if (!settings.googleRefreshToken) {
			return { proposals: [], eventsFound: 0, alreadyExisting: 0, dailyNotePath: '' };
		}

		let relevantEvents: GoogleCalendarEvent[] = [];
		try {
			relevantEvents = await this.fetchRelevantEvents(settings, {
				targetDate,
				calendarId: options.calendarId,
				includeOtherCalendars: options.includeOtherCalendars
			});
		} catch {
			return { proposals: [], eventsFound: 0, alreadyExisting: 0, dailyNotePath: '' };
		}

		const vaultContext = new VaultContextService(app, settings);
		const dailyRes = await vaultContext.getOrCreateDailyNote(targetDate, settings.dailyNoteTemplatePath);
		const dailyPath = dailyRes.path;

		let fileContent = '';
		try {
			fileContent = await app.vault.read(dailyRes.file);
		} catch {
			fileContent = '';
		}

		const proposals: CreateTaskActionProposal[] = [];
		let alreadyExisting = 0;

		for (const ev of relevantEvents) {
			if (this.isEventAlreadyInNote(fileContent, ev)) {
				alreadyExisting++;
				continue;
			}

			const rawTitle = this.formatEventToTaskTitle(ev);
			const taskTitle = TaskMutator.cleanTaskPrefix(rawTitle);

			const prop: CreateTaskActionProposal = {
				id: `cal-sync-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
				type: 'create_task',
				description: `📅 Importer le RDV « ${taskTitle} » dans la note quotidienne`,
				selected: true,
				targetPath: dailyPath,
				taskTitle,
				scheduledDate: targetDate,
				domainTags: tag ? [tag] : undefined
			};

			proposals.push(prop);
		}

		return {
			proposals,
			eventsFound: relevantEvents.length,
			alreadyExisting,
			dailyNotePath: dailyPath
		};
	}
}
