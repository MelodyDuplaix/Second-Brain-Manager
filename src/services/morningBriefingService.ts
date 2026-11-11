import { App, Notice, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskStatusRegistry } from '../models/taskStatusRegistry';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory, MatrixFeature } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { TaskSafetyGuard } from './taskSafetyGuard';
import { VaultContextService } from './vaultContextService';
import { DailyNoteFormatter } from './dailyNoteFormatter';
import { GamificationService } from './gamificationService';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from '../models/syntaxConfig';
import { GoogleCalendarEvent } from '../models/googleCalendar';
import { GoogleCalendarService } from './googleCalendarService';
import SecondBrainPlugin from '../main';
import { JsonUtils } from '../utils/jsonUtils';
import { DelegationFeature } from '../models/delegation';
import { CalendarDate } from './taskCalendarService';
import {
	EVENING_SECTION_HEADER,
	MORNING_SECTION_HEADER,
	UserRhythm,
	actionPolicy,
	buildDelegatedSection,
	clip,
	computeUserRhythm,
	describeRhythm,
	describeVaultConventions,
	extractDailySection,
	localDateStr,
	refineBriefingProposals,
	sharedStyleGuidelines,
	stripGeneratedSections,
	suggestedTaskCount
} from './briefingContext';

function isOpenBriefingTask(task: ObsidianTask): boolean {
	const status = task.status.toLowerCase();
	const rawStatusChar = /^\s*-\s*\[([^\]])\]/.exec(task.rawText)?.[1];
	const statusChar = rawStatusChar ?? task.statusChar;
	const statusType = rawStatusChar ? TaskStatusRegistry.typeOf(rawStatusChar) : task.statusType;
	return !task.completed
		&& statusType !== 'DONE'
		&& statusType !== 'CANCELLED'
		&& status !== 'done'
		&& status !== 'completed'
		&& status !== 'cancelled'
		&& status !== 'x'
		&& status !== '-'
		&& statusChar !== 'x'
		&& statusChar !== 'X'
		&& statusChar !== '-';
}

export interface BriefingVaultData {
	dateStr: string;
	formattedDate: string;
	currentTime?: string;
	energy: number;
	modeText: string;
	focusProject?: string;
	priorityFolders?: string[];
	priorityFiles?: string[];
	priorityTags?: string[];
	priorityProperties?: string[];
	adhocPriority?: string;
	userPrioritizedTasks?: ObsidianTask[];
	inactivityText?: string;
	inactivityDays?: number;
	isRecoveryMode?: boolean;
	quickWinTasks?: ObsidianTask[];
	oneThingTask?: ObsidianTask;
	overdueTasks: ObsidianTask[];
	staleTasks?: ObsidianTask[];
	todayTasks: ObsidianTask[];
	priorityTasks: ObsidianTask[];
	inboxTasks: ObsidianTask[];
	projectTasks: ObsidianTask[];
	looseNotes?: string[];
	inboxNotePreviews?: Array<{ path: string; name: string; preview: string }>;
	folders?: string[];
	isCluttered?: boolean;
	projects: string[];
	contacts: string[];
	dailyNotePath?: string;
	dailyNoteContent?: string;
	calendarEvents?: GoogleCalendarEvent[];
	calendarEventsText?: string;
	pausedTasks?: ObsidianTask[];
	canSuggestPausedTasks?: boolean;
	customPromptInstructions?: string;
	/** Tâches ouvertes données par d'autres personnes (fonctionnalité optionnelle) */
	delegatedTasks?: ObsidianTask[];
	/** Rythme réel (historique des tâches terminées) */
	rhythm?: UserRhythm | null;
	/** Ce que la revue du soir de la veille avait prévu (continuité soir → matin) */
	previousEveningReview?: string;
	inboxFolder?: string;
	googleConnected?: boolean;
	gamificationEnabled?: boolean;
}

export class MorningBriefingService {
	/**
	 * Calcule la durée d'inactivité écoulée depuis la dernière session active ou événement.
	 */
	public static calculateInactivity(lastActiveTimestamp?: string | number): { inactivityText: string; inactivityDays: number } {
		const now = Date.now();
		if (!lastActiveTimestamp) {
			return { inactivityText: 'Reprise de session', inactivityDays: 0 };
		}

		const lastTime = typeof lastActiveTimestamp === 'string'
			? new Date(lastActiveTimestamp).getTime()
			: lastActiveTimestamp;

		if (isNaN(lastTime)) {
			return { inactivityText: 'Reprise de session', inactivityDays: 0 };
		}

		const diffMs = Math.max(0, now - lastTime);
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffHours / 24);

		if (diffDays >= 30) {
			const months = Math.floor(diffDays / 30);
			return { inactivityText: `Reprise après ${months} mois de pause`, inactivityDays: diffDays };
		} else if (diffDays >= 7) {
			const weeks = Math.floor(diffDays / 7);
			return { inactivityText: `Reprise après ${weeks} semaine(s) de pause`, inactivityDays: diffDays };
		} else if (diffDays >= 2) {
			return { inactivityText: `Reprise après ${diffDays} jours de pause`, inactivityDays: diffDays };
		} else if (diffDays === 1) {
			return { inactivityText: `Reprise de session (hier)`, inactivityDays: 1 };
		} else if (diffHours >= 2) {
			return { inactivityText: `Reprise après ${diffHours} heures de pause`, inactivityDays: 0 };
		}

		return { inactivityText: 'Session active', inactivityDays: 0 };
	}

	/** Libellé du mode selon l'énergie déclarée. */
	public static modeTextFor(energy: number): string {
		return energy <= 3
			? 'Mode Économie (énergie faible : peu de tâches, concentre-toi sur l’essentiel et le délestage)'
			: energy <= 7
				? 'Mode Équilibré (énergie moyenne : une tâche majeure et quelques secondaires)'
				: 'Mode Plein Potentiel (énergie haute : bon jour pour les chantiers exigeants ou créatifs)';
	}

	/**
	 * Récupère et structure l'ensemble des données du coffre nécessaires pour le briefing.
	 */
	public static async collectBriefingData(
		app: App,
		plugin: SecondBrainPlugin,
		focusProjectOrOptions?: string | {
			focusProject?: string;
			priorityFolders?: string[];
			priorityFiles?: string[];
			priorityTags?: string[];
			adhocPriority?: string;
			energy?: number;
		}
	): Promise<BriefingVaultData> {
		const today = new Date();
		// Date locale : après minuit, toISOString() donnerait encore la veille
		const dateStr = localDateStr(today);

		// Formatage de la date en français (ex: "Lundi 24 Août 2026")
		const formattedDate = today.toLocaleDateString('fr-FR', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const currentTime = today.toLocaleTimeString('fr-FR', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
		const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

		let focusProject: string | undefined;
		let priorityFolders: string[] = [];
		let priorityFiles: string[] = [];
		let selectedPriorityTags: string[] = [];
		let adhocPriority: string | undefined;
		let requestedEnergy: number | undefined;

		if (typeof focusProjectOrOptions === 'string') {
			focusProject = focusProjectOrOptions;
		} else if (focusProjectOrOptions) {
			focusProject = focusProjectOrOptions.focusProject;
			priorityFolders = focusProjectOrOptions.priorityFolders || [];
			priorityFiles = focusProjectOrOptions.priorityFiles || [];
			selectedPriorityTags = focusProjectOrOptions.priorityTags || [];
			adhocPriority = focusProjectOrOptions.adhocPriority?.trim() || undefined;
			requestedEnergy = focusProjectOrOptions.energy;
		}

		const energy = requestedEnergy !== undefined ? requestedEnergy : plugin.settings.energyLevel;
		const modeText = this.modeTextFor(energy);

		// Récupération de l'horodatage d'activité le plus récent parmi toutes les sources disponibles
		const candidateTimestamps: number[] = [];
		if (plugin.pluginData?.lastActiveSession) {
			const t = new Date(plugin.pluginData.lastActiveSession).getTime();
			if (!isNaN(t)) candidateTimestamps.push(t);
		}
		if (plugin.pluginData?.completionEvents) {
			Object.values(plugin.pluginData.completionEvents).forEach(e => {
				if (e.completedAt) {
					const t = new Date(e.completedAt).getTime();
					if (!isNaN(t)) candidateTimestamps.push(t);
				}
			});
		}
		if (plugin.pluginData?.streak?.lastCompletedDate) {
			const t = new Date(plugin.pluginData.streak.lastCompletedDate).getTime();
			if (!isNaN(t)) candidateTimestamps.push(t);
		}
		const mostRecentActive = candidateTimestamps.length > 0 ? Math.max(...candidateTimestamps) : undefined;
		const { inactivityText, inactivityDays } = this.calculateInactivity(mostRecentActive);

		const matrixAdapter = MatrixAdapterFactory.createAdapter(
			plugin.settings.matrixProvider,
			plugin.settings.customMatrixMapping
		);

		const vaultContext = new VaultContextService(app, plugin.settings);
		const filterService = vaultContext.getFilterService();
		const structure = vaultContext.getVaultStructure();

		// Lecture de toutes les tâches ouvertes du coffre en parallèle (racines + sous-tâches)
		const allFiles = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];
		const files = allFiles.filter(f => !filterService.isFolderExcluded(f.path) && !filterService.isFileNameExcluded(f.path));
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					const raw = (typeof (app.vault as any).cachedRead === 'function')
						? await (app.vault as any).cachedRead(file)
						: await app.vault.read(file);
					if (filterService.isFileExcluded(file, raw)) {
						return [];
					}
					return TaskParser.parseAllTasks(raw, file.path, plugin.settings);
				} catch (error) {
					console.warn(`[Second Brain Manager] Impossible de lire les tâches de « ${file.path} » pour le briefing :`, error);
					return [];
				}
			})
		);

		const allOpenTasks = results.flat().filter(isOpenBriefingTask);

		// Séparation stricte entre les tâches actives normales et les tâches explicitement en pause (On Hold)
		// Mode « attribuée » : les tâches pour d'autres personnes ne sont pas les miennes
		const activeOpenTasks = allOpenTasks.filter(t => !t.isPaused && t.status !== 'paused' && !(t.forOthers && DelegationFeature.hidesOthers()));
		const pausedTasks = allOpenTasks.filter(t => Boolean(t.isPaused || t.status === 'paused') && !(t.forOthers && DelegationFeature.hidesOthers()));

		// Classification basée exclusivement sur les tâches actives
		const overdueTasks = activeOpenTasks.filter(t =>
			(t.dueDate && t.dueDate < dateStr) ||
			(t.scheduledDate && t.scheduledDate < dateStr)
		);
		const todayTasks = activeOpenTasks.filter(t =>
			t.dueDate === dateStr ||
			t.scheduledDate === dateStr ||
			// Une tâche commencée n'est « du jour » que si son échéance n'est pas déjà passée (elle est alors en retard)
			(t.startDate && t.startDate <= dateStr && (!t.dueDate || t.dueDate >= dateStr))
		);

		// Identification des tâches expressément prioritaires (dossiers/fichiers choisis + tags choisis + tags configurés + propriétés frontmatter)
		const normPriorityFolders = priorityFolders.map(f => normalizePath(f).toLowerCase());
		const normPriorityFiles = priorityFiles.map(f => normalizePath(f).toLowerCase());
		const normPriorityTags = selectedPriorityTags.map(t => t.toLowerCase().replace(/^#/, ''));

		const userPrioritizedTasks = activeOpenTasks.filter(t => {
			const normPath = normalizePath(t.filePath || '').toLowerCase();
			const inPriorityFolder = normPriorityFolders.some(f => normPath === f || normPath.startsWith(f + '/'));
			const inPriorityFile = normPriorityFiles.some(f => normPath === f || normPath.endsWith('/' + f) || normPath.includes(f));
			const hasPriorityTagOrProp = filterService.isTaskPrioritized(t);
			const hasSelectedPriorityTag = normPriorityTags.some(tag => {
				const tagWithHash = '#' + tag;
				return (t.domainTags && t.domainTags.some(dt => dt.toLowerCase() === tagWithHash || dt.toLowerCase().replace(/^#/, '') === tag)) ||
					(t.rawText && t.rawText.toLowerCase().includes(tagWithHash)) ||
					(t.rawLine && t.rawLine.toLowerCase().includes(tagWithHash));
			});
			return inPriorityFolder || inPriorityFile || hasPriorityTagOrProp || hasSelectedPriorityTag;
		});

		// Identification des tâches très anciennes (souffrance / obsolescence)
		const sevenDaysAgo = CalendarDate.addDays(dateStr, -7);
		const staleTasks = overdueTasks.filter(t =>
			(t.dueDate && t.dueDate <= sevenDaysAgo) ||
			(t.scheduledDate && t.scheduledDate <= sevenDaysAgo)
		);

		const inboxFolderSetting = plugin.settings.inboxFolder || '00 - Inbox';
		const inboxFolder = normalizePath(inboxFolderSetting).toLowerCase();
		const inboxTasks = activeOpenTasks.filter(t => {
			const norm = normalizePath(t.filePath).toLowerCase();
			const isRoot = !norm.includes('/');
			return norm.startsWith(inboxFolder) || norm.includes('notes en vrac') || norm.includes('vrac') || isRoot;
		});

		// Ordonnancement des tâches prioritaires : place d'abord les tâches prioritaires définies par l'utilisateur
		const priorityTasksSet = new Set<ObsidianTask>();
		userPrioritizedTasks.forEach(t => priorityTasksSet.add(t));
		activeOpenTasks.filter(t => {
			const q = matrixAdapter.getQuadrant(t);
			return q === 'q1' || q === 'q2' || (t.priority && (t.priority === 'highest' || t.priority === 'high'));
		}).forEach(t => priorityTasksSet.add(t));
		const priorityTasks = Array.from(priorityTasksSet);

		// Identification des Quick Wins (tâches courtes, faciles ou faible énergie, non Q1)
		const quickWinTasks = activeOpenTasks
			.filter(t => {
				const isLowEnergy = t.energy !== undefined && t.energy <= 3;
				const isEasy = t.difficulty && t.difficulty.toLowerCase() === 'facile';
				const isQ3orQ4 = matrixAdapter.getQuadrant(t) === 'q3' || matrixAdapter.getQuadrant(t) === 'q4';
				return isLowEnergy || isEasy || isQ3orQ4;
			})
			.slice(0, 3);

		// Identification de la tâche majeure (The One Thing) : priorité aux tâches prioritaires définies par l'utilisateur
		let oneThingTask = userPrioritizedTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || t.dueDate === dateStr);
		if (!oneThingTask && userPrioritizedTasks.length > 0) {
			oneThingTask = userPrioritizedTasks[0];
		}
		if (!oneThingTask) {
			oneThingTask = activeOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' && (t.dueDate === dateStr || (t.dueDate && t.dueDate < dateStr)));
		}
		if (!oneThingTask) {
			// Sans quadrants : priorité haute, due aujourd'hui ou en retard
			oneThingTask = activeOpenTasks.find(t => (t.priority === 'highest' || t.priority === 'high') && t.dueDate !== undefined && t.dueDate <= dateStr);
		}
		if (!oneThingTask) {
			oneThingTask = activeOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || matrixAdapter.getQuadrant(t) === 'q2');
		}
		if (!oneThingTask && todayTasks.length > 0) {
			oneThingTask = todayTasks[0];
		}
		if (!oneThingTask && overdueTasks.length > 0) {
			oneThingTask = overdueTasks[0];
		}

		// Tâches spécifiques au projet focus si sélectionné
		const projectTasks = (focusProject && focusProject !== 'all')
			? activeOpenTasks.filter(t =>
				(t.filePath && t.filePath.toLowerCase().includes(focusProject.toLowerCase())) ||
				(t.title && t.title.toLowerCase().includes(focusProject.toLowerCase())) ||
				(t.domainTags && Array.isArray(t.domainTags) && t.domainTags.some(tag => tag.toLowerCase().includes(focusProject.toLowerCase())))
			)
			: [];

		// Calcul du volume de tâches actionnables (en retard, du jour ou sans date)
		const actionableTasks = activeOpenTasks.filter(t =>
			(t.dueDate && t.dueDate <= dateStr) ||
			(t.scheduledDate && t.scheduledDate <= dateStr) ||
			(!t.dueDate && !t.scheduledDate)
		);

		// Condition spéciale : le LLM peut suggérer les tâches en pause UNIQUEMENT s'il y a très peu de tâches actives (< 3)
		const canSuggestPausedTasks = actionableTasks.length < 3 && pausedTasks.length > 0;

		const looseNotes = structure.looseNotes || [];

		// Récupération des dossiers et des aperçus des notes en boîte de réception / vrac pour donner du contexte à l'IA
		const inboxFilesToScan = structure.inboxFiles.filter(p => !filterService.isFolderExcluded(p) && !filterService.isFileNameExcluded(p)).slice(0, 30);
		const rawPreviews = await Promise.all(
			inboxFilesToScan.map(async (normPath) => {
				const file = app.vault.getFileByPath(normPath) || app.vault.getAbstractFileByPath(normPath);
				let preview = '';
				if (file instanceof TFile) {
					try {
						const raw = (typeof (app.vault as any).cachedRead === 'function')
							? await (app.vault as any).cachedRead(file)
							: await app.vault.read(file);
						if (filterService.isFileExcluded(file, raw)) {
							return null;
						}
						const nonHeadingLine = raw.split('\n')
							.map(l => l.trim())
							.filter(l => l.length > 0 && !l.startsWith('---') && !l.startsWith('```'))[0] || '';
						preview = nonHeadingLine.slice(0, 120);
					} catch {
						preview = '';
					}
				}
				const name = normPath.split('/').pop()?.replace(/\.md$/, '') || normPath;
				return { path: normPath, name, preview };
			})
		);
		const inboxNotePreviews = rawPreviews.filter((p): p is { path: string; name: string; preview: string } => p !== null);

		// Déclenchement automatique du mode Reprise & Décongestion si encombrement ou pause prolongée (>= 3 jours)
		const isCluttered = overdueTasks.length >= 4 || staleTasks.length >= 2 || inboxTasks.length >= 4 || inboxNotePreviews.length >= 3;
		const isRecoveryMode = isCluttered || inactivityDays >= 3;

		// Lecture ou création automatique de la note quotidienne du jour (avec template et Templater)
		let dailyNoteContent: string | undefined;
		const dailyRes = await vaultContext.getOrCreateDailyNote(dateStr, plugin.settings.dailyNoteTemplatePath);
		if (dailyRes.content) {
			dailyNoteContent = dailyRes.content;
		}

		// Continuité : ce que la revue du soir d'hier avait prévu pour aujourd'hui
		let previousEveningReview: string | undefined;
		try {
			const yesterday = await vaultContext.getDailyNote(CalendarDate.addDays(dateStr, -1));
			previousEveningReview = extractDailySection(yesterday.content, EVENING_SECTION_HEADER);
		} catch {
			previousEveningReview = undefined;
		}

		// Lecture des événements Google Calendar du jour si configuré
		let calendarEventsText = '';
		let calendarEvents: GoogleCalendarEvent[] = [];
		const googleConnected = Boolean(plugin.settings.googleRefreshToken) && plugin.isFeatureEnabled?.('calendar') !== false;
		if (googleConnected) {
			try {
				const startOfToday = new Date(today);
				startOfToday.setHours(0, 0, 0, 0);
				const endOfToday = new Date(today);
				endOfToday.setHours(23, 59, 59, 999);

				calendarEvents = await GoogleCalendarService.getEvents(plugin.settings, {
					timeMin: startOfToday.toISOString(),
					timeMax: endOfToday.toISOString()
				});
				calendarEventsText = GoogleCalendarService.formatEventsForPrompt(
					calendarEvents,
					dateStr,
					plugin.settings
				);
			} catch (calErr) {
				console.warn('[Second Brain Manager] Erreur récupération événements Google Calendar pour le briefing:', calErr);
			}
		}

		return {
			dateStr,
			formattedDate: capitalizedDate,
			currentTime,
			energy,
			modeText,
			focusProject: focusProject && focusProject !== 'all' ? focusProject : undefined,
			inactivityText,
			inactivityDays,
			isRecoveryMode,
			quickWinTasks,
			oneThingTask,
			overdueTasks,
			staleTasks,
			todayTasks,
			priorityTasks,
			inboxTasks,
			projectTasks,
			looseNotes,
			inboxNotePreviews,
			folders: structure.folders,
			priorityFolders: priorityFolders.length > 0 ? priorityFolders : undefined,
			priorityFiles: priorityFiles.length > 0 ? priorityFiles : undefined,
			priorityTags: (selectedPriorityTags.length > 0 || filterService.getPriorityTags().length > 0)
				? Array.from(new Set([...selectedPriorityTags, ...filterService.getPriorityTags()]))
				: undefined,
			priorityProperties: filterService.getPriorityProperties().length > 0 ? filterService.getPriorityProperties().map(p => p.value !== undefined ? `${p.key}: ${p.value}` : p.key) : undefined,
			adhocPriority,
			userPrioritizedTasks,
			isCluttered,
			projects: structure.projects,
			contacts: structure.contacts,
			dailyNotePath: dailyRes.path,
			dailyNoteContent,
			calendarEvents,
			calendarEventsText,
			pausedTasks,
			canSuggestPausedTasks,
			customPromptInstructions: plugin.settings.customPromptInstructions,
			delegatedTasks: activeOpenTasks.filter(t => t.person),
			rhythm: computeUserRhythm(plugin.pluginData?.completionEvents, dateStr),
			previousEveningReview,
			inboxFolder: inboxFolderSetting,
			googleConnected,
			gamificationEnabled: plugin.isFeatureEnabled?.('gamification') !== false
		};
	}

	/**
	 * Construit le prompt système et utilisateur du briefing du matin.
	 * Une seule trame pour la journée normale et la reprise : seules les parties utiles sont demandées,
	 * et chaque tâche n'apparaît qu'une fois dans les données envoyées.
	 */
	public static buildBriefingMessages(data: BriefingVaultData, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ChatMessage[] {
		const formatTaskLine = (t: ObsidianTask): string => TaskMutator.formatTaskForPrompt(t, config);
		const matrixOn = MatrixFeature.isEnabled();
		const recovery = Boolean(data.isRecoveryMode);
		const dailyTargetPath = data.dailyNotePath || `Note quotidienne/${data.dateStr}.md`;
		const hasCalendar = Boolean(data.calendarEventsText && data.calendarEventsText.trim() && !data.calendarEventsText.startsWith('Aucun'));
		const googleConnected = data.googleConnected ?? hasCalendar;
		const capacity = suggestedTaskCount(data.rhythm ?? null, data.energy);

		// Chaque tâche n'est envoyée qu'une fois, dans la rubrique la plus parlante
		const seen = new Set<string>();
		const keyOf = (t: ObsidianTask) => `${t.filePath}:${t.lineNumber}`;
		const take = (list: ObsidianTask[] | undefined, limit: number): ObsidianTask[] => {
			const out: ObsidianTask[] = [];
			for (const t of list || []) {
				if (out.length >= limit) break;
				if (!isOpenBriefingTask(t)) continue;
				const k = keyOf(t);
				if (seen.has(k)) continue;
				seen.add(k);
				out.push(t);
			}
			return out;
		};
		const block = (title: string, tasks: ObsidianTask[]) => tasks.length ? `${title} :\n${tasks.map(formatTaskLine).join('\n')}\n` : '';

		// ----- Données (message utilisateur) -----
		let focusProjectText = '';
		if (data.focusProject) {
			const tasksForProject = take(data.projectTasks, 15);
			focusProjectText = `PROJET FOCUS DU JOUR CHOISI PAR L'UTILISATEUR : "[[${data.focusProject}]]"\n` +
				(tasksForProject.length ? `TACHES LIEES A CE PROJET :\n${tasksForProject.map(formatTaskLine).join('\n')}\n` : `Aucune tâche explicite trouvée pour ce projet.\n`);
		}

		const adhoc = data.adhocPriority?.trim();
		const adhocPrioritySection = adhoc
			? `OBJECTIF OU CONSIGNE DU JOUR FIXÉE DIRECTEMENT PAR L'UTILISATEUR :\n"${adhoc}"\n`
			: '';

		let prioritiesSection = '';
		const hasPriorityFolders = Boolean(data.priorityFolders?.length);
		const hasPriorityFiles = Boolean(data.priorityFiles?.length);
		const hasPriorityTags = Boolean(data.priorityTags?.length);
		const hasPriorityProps = Boolean(data.priorityProperties?.length);
		const prioritized = take(data.userPrioritizedTasks, 8);
		const hasPriorityContext = hasPriorityFolders || hasPriorityFiles || hasPriorityTags || hasPriorityProps || prioritized.length > 0;
		if (hasPriorityContext) {
			const lines: string[] = [];
			if (hasPriorityFolders) lines.push(`- Dossiers sélectionnés par l'utilisateur : ${data.priorityFolders!.join(', ')}`);
			if (hasPriorityFiles) lines.push(`- Fichiers sélectionnés par l'utilisateur : ${data.priorityFiles!.join(', ')}`);
			if (hasPriorityTags) lines.push(`- Tags sélectionnés / configurés : ${data.priorityTags!.map(t => '#' + t.replace(/^#/, '')).join(', ')}`);
			if (hasPriorityProps) lines.push(`- Propriétés frontmatter configurées : ${data.priorityProperties!.join(', ')}`);
			if (prioritized.length) lines.push(`- Tâches correspondantes :\n${prioritized.map(t => '  ' + formatTaskLine(t)).join('\n')}`);
			prioritiesSection = `FOCUS ET SÉLECTIONS DU JOUR DÉFINIS PAR L'UTILISATEUR :\n${lines.join('\n')}\n`;
		}

		const calendarSectionText = hasCalendar
			? `AGENDA & CRÉNEAUX DU JOUR (Google Calendar) :\n${data.calendarEventsText}\n`
			: '';

		const previousEvening = data.previousEveningReview
			? `CE QUE LA REVUE D'HIER SOIR AVAIT PRÉVU (pour assurer la continuité) :\n${clip(data.previousEveningReview, 1200)}\n`
			: '';

		const oneThing = data.oneThingTask ? take([data.oneThingTask], 1) : [];
		const today = take(data.todayTasks, 20);
		const priority = take(data.priorityTasks, 8);
		// Les quick wins passent avant les retards : une tâche facile garde son signal « facile »
		const quickWins = take(data.quickWinTasks, 3);
		const overdue = take(data.overdueTasks, recovery ? 35 : 15);
		const staleCount = recovery ? (data.staleTasks || []).filter(isOpenBriefingTask).length : 0;
		// Les tâches données par d'autres non encore citées sont regroupées par personne
		const delegated = buildDelegatedSection(take(data.delegatedTasks, 15), data.contacts || [], formatTaskLine);
		const inbox = take(data.inboxTasks, recovery ? 20 : 10);
		const notePreviews = data.inboxNotePreviews || [];
		const looseNotesText = notePreviews.length
			? `NOTES EN VRAC À RANGER (${notePreviews.length}) :\n${notePreviews.map(n => `- [[${n.name}]] (Chemin: "${n.path}")${n.preview ? ` : "${n.preview}"` : ''}`).join('\n')}\n`
			: '';
		const foldersText = notePreviews.length && data.folders?.length
			? `Dossiers existants (pour ranger) : ${data.folders.slice(0, 30).join(', ')}\n`
			: '';

		let pausedSectionText = '';
		let pausedDirectives = '';
		const openPausedTasks = (data.pausedTasks || []).filter(isOpenBriefingTask);
		if (data.canSuggestPausedTasks && openPausedTasks.length > 0) {
			const pausedList = openPausedTasks.slice(0, 10).map(formatTaskLine).join('\n');
			pausedSectionText = `TACHES EN PAUSE DISPONIBLES (${openPausedTasks.length} au total) :\n${pausedList}\n`;
			pausedDirectives = `\n- **Opportunité - Tâches en Pause** : l'utilisateur a très peu de tâches actives (moins de 3 tâches en retard, du jour ou sans date). Mentionne simplement qu'il a ${openPausedTasks.length} tâche(s) en pause et propose d'en reprendre 1 ou 2 si c'est pertinent (cite des exemples concrets).`;
		}

		const dailyNoteBody = stripGeneratedSections(data.dailyNoteContent);
		const dailyNoteSnippet = dailyNoteBody
			? `NOTE QUOTIDIENNE DU JOUR (${dailyTargetPath}), déjà écrite par l'utilisateur :\n${clip(dailyNoteBody, 1500)}\n`
			: '';

		const taskSections = [
			oneThing.length ? `TACHE MAJEURE DETECTEE (THE ONE THING) :\n${formatTaskLine(oneThing[0])}\n` : '',
			block(`TACHES PLANIFIEES POUR AUJOURD'HUI (${today.length})`, today),
			block('AUTRES TACHES OUVERTES À CONSIDÉRER', priority),
			block(`TACHES EN RETARD (${overdue.length}${staleCount ? `, dont ${staleCount} en souffrance depuis plus de 7 jours` : ''})`, overdue),
			block('QUICK WINS DISPONIBLES', quickWins),
			delegated.section.trim() ? `${delegated.section.trim()}\n` : '',
			block(`TACHES EN BOITE DE RECEPTION / EN VRAC (${inbox.length})`, inbox),
			looseNotesText,
			foldersText,
			pausedSectionText
		].filter(Boolean).map(s => s.trim()).join('\n\n');

		const emptyDay = !taskSections.trim() && !hasCalendar;
		const context = [focusProjectText, adhocPrioritySection, prioritiesSection, calendarSectionText, previousEvening].filter(Boolean).map(s => s.trim()).join('\n\n');

		const intro = recovery
			? `Voici la situation de mon coffre ce ${data.formattedDate} (${data.inactivityText || 'reprise'}).`
			: `Voici l'état de mon coffre ce ${data.formattedDate}.`;
		const ask = recovery
			? 'Prépare mon briefing avec un plan de tri réaliste pour repartir sur de bonnes bases.'
			: emptyDay
				? 'Rien n’est prévu : prépare un briefing court et propose comment utiliser la journée, sans inventer de tâches.'
				: 'Prépare mon briefing du matin.';
		const timeContext = data.currentTime ? `HEURE LOCALE AU MOMENT DE LA GÉNÉRATION : ${data.currentTime}\n` : '';
		const userMessage = [intro, timeContext, context, taskSections, dailyNoteSnippet, ask].filter(s => s && s.trim()).map(s => s.trim()).join('\n\n');

		// ----- Consignes (message système) -----
		let directives = '';
		if (data.focusProject) {
			directives += `\n- **Projet Focus Majeur** : l'utilisateur veut centrer sa journée sur "[[${data.focusProject}]]". Fais-en le cœur du Cap du Jour et privilégie ses tâches.`;
		}
		if (adhoc) {
			directives += `\n- **Consigne spécifique de l'utilisateur** : "${adhoc}". Fais-en le fil conducteur de la journée.`;
		}
		if (hasPriorityContext) {
			directives += `\n- **Éléments de focus sélectionnés** : tiens compte des dossiers, fichiers, tags et tâches indiqués pour choisir un plan adapté.`;
		}
		if (data.previousEveningReview) {
			directives += `\n- **Continuité** : la revue d'hier soir avait prévu des choses pour aujourd'hui. Reprends-les si elles sont toujours d'actualité, sans les recopier.`;
		}
		directives += pausedDirectives + delegated.directive;

		const customInstructionsSection = data.customPromptInstructions?.trim()
			? `\nINSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L'UTILISATEUR (À RESPECTER SCRUPULEUSEMENT, elles priment sur les règles générales) :\n${data.customPromptInstructions.trim()}\n`
			: '';

		const agendaRules = hasCalendar
			? `\nPRISE EN COMPTE DES AGENDAS :
1. Les rendez-vous de l'agenda principal et des agendas secondaires sont des contraintes fermes : organise les tâches dans les créneaux libres qui restent.
2. Les agendas d'autres personnes (proches, collègues) sont informatifs : mentionne-les sobrement si c'est utile, sans les compter comme des contraintes ni signaler de conflit.\n`
			: '';

		const tri = recovery
			? `   - **Plan de Tri & d'Organisation** : un plan de tri et d'organisation réaliste pour alléger la reprise — annuler l'obsolète (réunions passées, tâches périmées), replanifier ce qui compte vraiment à une date tenable, retirer les échéances artificielles, ranger les notes en vrac. Justifie brièvement chaque choix. Ne supprime pas les obligations à conséquences réelles (paiements, démarches administratives, santé, engagements envers quelqu'un) : replanifie-les.\n`
			: (data.overdueTasks.length || notePreviews.length)
				? `   - **Tri Rapide** (facultatif) : seulement si des retards ou des notes en vrac pèsent vraiment ; propose un allègement ciblé (2 à 5 éléments), pas une revue complète.\n`
				: '';

		const structure = `DÉROULÉ DU BRIEFING (dans cet ordre, en omettant toute partie sans contenu utile) :
   - **Cap du Jour** : salutation brève et l'intention de la journée en une ou deux phrases${recovery ? `, en reconnaissant la reprise (${data.inactivityText || 'reprise'}) sans dramatiser` : ''}.
${hasCalendar ? `   - **Rendez-vous & Contraintes Fixes de l'Agenda** : les créneaux incontournables, en une liste courte.\n` : ''}   - **Plan de Journée** : la tâche principale (The One Thing, et pourquoi elle) puis au plus ${Math.max(0, capacity - 1)} autre(s) tâche(s), dans un ordre réaliste${hasCalendar ? ' et placées dans les créneaux libres' : ''}.
   - **Petites Victoires** (facultatif) : 1 ou 2 actions de quelques minutes, seulement si elles aident à démarrer.
${tri}   - **Points de Vigilance** (facultatif) : uniquement de vrais risques (échéance proche, engagement envers quelqu'un${hasCalendar ? ', conflit d\'agenda' : ''}).
   - **Mot de la Fin** : une phrase pratique adaptée à l'énergie du jour.${directives ? `\n\nCONSIGNES PARTICULIÈRES DU JOUR :${directives}` : ''}`;

		const allowed = ['update_task', ...(notePreviews.length ? ['move_note', 'rename_note'] : []), 'create_task'];

		const systemPrompt = `Tu es "Second Brain Manager", le copilote d'organisation personnelle de l'utilisateur, à l'aise avec la méthode GTD${matrixOn ? ' et la matrice d\'Eisenhower' : ''}.
Tu rédiges son Briefing du Matin : un point personnalisé pour démarrer la journée, fondé uniquement sur les données de son coffre.${recovery ? '\nLe coffre a besoin d\'un peu de remise en ordre (retards, notes en vrac ou pause prolongée) : le briefing inclut un plan de tri.' : ''}

CE QUE TU SAIS DE L'UTILISATEUR :
- Énergie déclarée ce matin : ${data.energy}/10 — ${data.modeText}.
${describeRhythm(data.rhythm ?? null, data.energy)}${customInstructionsSection}

SON COFFRE :
${describeVaultConventions({
	inboxFolder: data.inboxFolder,
	dailyNotePath: dailyTargetPath,
	projects: data.projects,
	contacts: data.contacts,
	googleConnected,
	gamificationEnabled: data.gamificationEnabled !== false
})}
${agendaRules}
${sharedStyleGuidelines()}

RÈGLES DE PRÉSENTATION DU BRIEFING :
- Rédige uniquement un briefing lisible en prose, avec des titres courts si utile. N'évoque pas de « tâches prioritaires », de classement par priorité ni de fonctionnalité de widget de tâches.
- Ne produis aucun widget, tableau, liste de cases à cocher ou ligne de tâche Markdown (- [ ], - [x]). Mentionne les tâches existantes par leur intitulé exact, intégré à une phrase.
- Ne recommande jamais une tâche terminée ou annulée : les tâches fournies sont celles qui restent ouvertes ; si une tâche semble terminée dans un autre contexte, ne la propose pas.
- Le seul bloc de code éventuellement autorisé est le bloc facultatif \`\`\`json:actions décrit plus bas ; il ne fait pas partie du texte du briefing.

${structure}

TÂCHES CITÉES :
Pour une tâche existante, reprends son intitulé exact (sans chemin ni numéro de ligne), intégré à une phrase et sans la transformer en case à cocher.

FORMAT DES ACTIONS :
- Si tu proposes des actions, retourne-les uniquement dans un bloc \`\`\`json:actions contenant directement un tableau JSON d'objets d'action, sans objet enveloppe « actions ».
- N'insère jamais le JSON des actions dans le texte du briefing. Respecte les types et champs autorisés ci-dessous.

${actionPolicy({ dailyTargetPath, allowed })}`;

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userMessage }
		];
	}

	/**
	 * Extrait les propositions d'actions JSON retournées par l'IA et les valide.
	 */
	public static extractProposalsFromResponse(
		responseText: string,
		vaultTasks: ObsidianTask[] = [],
		todayStr?: string,
		eventTitles: string[] = []
	): { cleanText: string; proposals: ActionProposal[] } {
		const blocks = JsonUtils.extractJsonBlocks(responseText);

		if (blocks.length === 0) {
			return {
				cleanText: responseText.trim(),
				proposals: []
			};
		}

		let cleanText = responseText;
		const validatedProposals: ActionProposal[] = [];

		for (const block of blocks) {
			const parsed = JsonUtils.safeParseJson(block.jsonText);
			const actions = Array.isArray(parsed)
				? parsed
				: parsed && typeof parsed === 'object' && Array.isArray((parsed as { actions?: unknown }).actions)
					? (parsed as { actions: unknown[] }).actions
					: [];
			if (actions.length > 0) {
				const proposalsFromBlock = actions
					.filter(p => p && typeof p === 'object' && p.type)
					.map((p, index) => {
						const rawTarget = p.targetPath || (p.folder ? `${p.folder}/${p.fileName || 'Note'}` : p.fileName) || p.description || 'Note';
						const targetPath = String(rawTarget).replace(/[\r\n]+/g, ' ').trim();
						const lineNum = Number(p.lineNumber || 1);

						const matchedTask = vaultTasks.find(vt => vt.filePath === targetPath && vt.lineNumber === lineNum)
							|| vaultTasks.find(vt => vt.filePath === targetPath);

						const taskTitle = p.taskTitle || matchedTask?.title || p.description || 'Tâche';
						const prop: ActionProposal = {
							...p,
							id: p.id || `briefing-ai-${index}-${Date.now()}`,
							type: p.type,
							targetPath,
							lineNumber: lineNum,
							taskTitle,
							description: p.description || p.reason || taskTitle,
							selected: true
						};

						return TaskSafetyGuard.sanitizeProposal(prop, matchedTask, todayStr);
					});

				if (proposalsFromBlock.length > 0) {
					validatedProposals.push(...proposalsFromBlock);
					cleanText = cleanText.replace(block.fullMatchText, '');
				}
			}
		}

		cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

		// Aucune création forcée : doublons retirés, créations restantes à cocher par l'utilisateur
		const proposals = refineBriefingProposals(validatedProposals, {
			existingTaskTitles: vaultTasks.map(t => t.title),
			eventTitles
		});

		return {
			cleanText: cleanText || responseText.trim(),
			proposals
		};
	}

	/**
	 * Exécute la génération du briefing en streaming.
	 */
	public static async generateBriefing(
		app: App,
		plugin: SecondBrainPlugin,
		signal?: AbortSignal,
		onChunk?: (chunk: string, fullText: string) => void,
		focusProjectOrOptions?: string | {
			focusProject?: string;
			priorityFolders?: string[];
			priorityFiles?: string[];
			priorityTags?: string[];
			adhocPriority?: string;
			energy?: number;
		}
	): Promise<{ text: string; data: BriefingVaultData; allTasks: ObsidianTask[] }> {
		const data = await this.collectBriefingData(app, plugin, focusProjectOrOptions);
		const messages = this.buildBriefingMessages(data, plugin.settings);

		const apiKey = await plugin.getSecretApiKey(plugin.settings.llmProvider);
		const config: LLMConfig = {
			provider: plugin.settings.llmProvider,
			endpoint: plugin.settings.llmEndpoint,
			model: plugin.settings.llmModel,
			productId: plugin.settings.infomaniakProductId,
			apiKey,
			signal: signal || new AbortController().signal
		};

		let generatedText = '';
		await LLMService.generateStreamingResponse(
			messages,
			config,
			(chunk, full) => {
				generatedText = full;
				onChunk?.(chunk, full);
			}
		);

		// Tâches connues du briefing (sans doublon), pour relier le texte aux vraies tâches
		const seen = new Set<string>();
		const allTasks = [
			...(data.oneThingTask ? [data.oneThingTask] : []),
			...data.todayTasks,
			...data.overdueTasks,
			...data.priorityTasks,
			...(data.userPrioritizedTasks || []),
			...(data.quickWinTasks || []),
			...(data.delegatedTasks || []),
			...data.inboxTasks,
			...data.projectTasks,
			...(data.pausedTasks || [])
		].filter(t => {
			const k = `${t.filePath}:${t.lineNumber}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return isOpenBriefingTask(t);
		});

		return {
			text: generatedText,
			data,
			allTasks
		};
	}

	/**
	 * Enregistre ou met à jour la section Briefing du matin dans la Daily Note du jour.
	 */
	public static async saveBriefingToDailyNote(
		app: App,
		plugin: SecondBrainPlugin,
		briefingText: string,
		dateStr: string
	): Promise<string> {
		const vaultContext = new VaultContextService(app, plugin.settings);
		const dailyRes = await vaultContext.getOrCreateDailyNote(dateStr, plugin.settings.dailyNoteTemplatePath);
		const filePath = dailyRes.path;

		const cleanText = DailyNoteFormatter.formatForDailyNote(briefingText);
		const sectionHeader = MORNING_SECTION_HEADER;
		const sectionContent = `${sectionHeader}\n\n*Généré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (Énergie : ${plugin.settings.energyLevel}/10)*\n\n${cleanText}\n`;

		const existingFile = app.vault.getFileByPath(filePath) || app.vault.getAbstractFileByPath(filePath);

		if (existingFile instanceof TFile) {
			await app.vault.process(existingFile, (content) => {
				if (content.includes(sectionHeader)) {
					// Remplacement de la section existante
					const regex = new RegExp(`## 🌅 Briefing & Focus du Jour[\\s\\S]*?(?=\\n## |$)`, 'g');
					return content.replace(regex, sectionContent.trim());
				} else {
					// Ajout en haut ou en fin de document
					return `${content.trim()}\n\n${sectionContent.trim()}\n`;
				}
			});
			return filePath;
		} else {
			const initialContent = `---\ndate: ${dateStr}\ntags: [journal, daily-note]\n---\n\n# Journal du ${dateStr}\n\n${sectionContent}\n## 📝 Notes & Pensées\n\n`;
			await app.vault.create(filePath, initialContent);
		}

		// Trophées de régularité : seulement quand la gamification est active
		if (plugin?.pluginData && typeof plugin.savePluginData === 'function' && plugin.isFeatureEnabled?.('gamification') !== false) {
			const newlyUnlocked = GamificationService.recordWorkflowEvent(plugin.pluginData, 'morning_briefing');
			await plugin.savePluginData();
			if (newlyUnlocked && newlyUnlocked.length > 0) {
				for (const b of newlyUnlocked) {
					new Notice(`🏆 NOUVEAU BADGE DÉBLOQUÉ : ${b.name} !\n${b.description}`, 7000);
				}
			}
		}

		return filePath;
	}

	/**
	 * Planifie pour aujourd'hui (date due ou start) les tâches sélectionnées du briefing dans leurs notes sources.
	 */
	public static async planTasksForToday(
		app: App,
		plugin: SecondBrainPlugin,
		tasks: ObsidianTask[],
		dateStr: string
	): Promise<number> {
		let updatedCount = 0;
		const tasksByFile = new Map<string, ObsidianTask[]>();

		for (const task of tasks) {
			// Les tâches en pause ou déjà terminées ne sont jamais replanifiées d'office
			if (task.completed || task.isPaused || task.status === 'paused' || task.status === 'cancelled') continue;
			if (!task.dueDate || task.dueDate < dateStr) {
				const list = tasksByFile.get(task.filePath) || [];
				list.push(task);
				tasksByFile.set(task.filePath, list);
			}
		}

		for (const [filePath, fileTasks] of tasksByFile.entries()) {
			const normPath = normalizePath(filePath);
			const file = app.vault.getFileByPath(normPath) || app.vault.getAbstractFileByPath(normPath);
			if (!(file instanceof TFile)) continue;

			await app.vault.process(file, (content) => {
				const lines = content.split('\n');
				for (const t of fileTasks) {
					const idx = t.lineNumber - 1;
					if (lines[idx] !== undefined) {
						lines[idx] = TaskMutator.setDueDate(lines[idx], dateStr, plugin.settings);
						updatedCount++;
					}
				}
				return lines.join('\n');
			});
		}

		return updatedCount;
	}
}
