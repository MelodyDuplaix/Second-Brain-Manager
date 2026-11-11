import { App, Notice, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { getTaskExclusionRules } from './taskExclusionService';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { MatrixFeature } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { ActionProposal, UpdateTaskActionProposal, TaskDiffMetadata } from '../models/actions';
import { VaultContextService } from './vaultContextService';
import { TaskSafetyGuard } from './taskSafetyGuard';
import { DailyNoteFormatter } from './dailyNoteFormatter';
import { GamificationService } from './gamificationService';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from '../models/syntaxConfig';
import { GoogleCalendarEvent } from '../models/googleCalendar';
import { GoogleCalendarService } from './googleCalendarService';
import SecondBrainPlugin from '../main';
import { CalendarDate } from './taskCalendarService';
import {
	UserRhythm,
	actionPolicy,
	buildDelegatedSection,
	computeUserRhythm,
	describeRhythm,
	describeVaultConventions,
	localDateStr,
	refineBriefingProposals,
	sharedStyleGuidelines
} from './briefingContext';
import { JsonUtils } from '../utils/jsonUtils';

export interface RecoveryVaultData {
	dateStr: string;
	formattedDate: string;
	inactivityText: string;
	inactivityDays: number;
	quickWinTasks: ObsidianTask[];
	oneThingTask?: ObsidianTask;
	overdueTasks: ObsidianTask[];
	staleTasks: ObsidianTask[];
	inboxTasks: ObsidianTask[];
	inboxNotes: string[];
	inboxNotePreviews: Array<{ path: string; name: string; preview: string }>;
	folders: string[];
	projects: string[];
	contacts: string[];
	energy: number;
	dailyNoteContent?: string;
	calendarEvents?: GoogleCalendarEvent[];
	calendarEventsText?: string;
	customPromptInstructions?: string;
	rhythm?: UserRhythm | null;
	delegatedTasks?: ObsidianTask[];
	inboxFolder?: string;
	googleConnected?: boolean;
	gamificationEnabled?: boolean;
}

export class RecoveryService {
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

	/**
	 * Collecte et structure toutes les données du coffre pour un redémarrage serein sans friction.
	 */
	public static async collectRecoveryData(app: App, plugin: SecondBrainPlugin): Promise<RecoveryVaultData> {
		const today = new Date();
		const dateStr = localDateStr(today);

		const formattedDate = today.toLocaleDateString('fr-FR', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

		const energy = plugin.settings.energyLevel;

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

		// Lecture de toutes les tâches ouvertes du coffre en parallèle
		const allFiles = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];
		const files = allFiles.filter(f => !filterService.isFolderExcluded(f.path) && !filterService.isFileNameExcluded(f.path));
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					const content = (typeof (app.vault as any).cachedRead === 'function')
						? await (app.vault as any).cachedRead(file)
						: await app.vault.read(file);
					if (filterService.isFileExcluded(file, content)) {
						return [];
					}
					return TaskParser.parseAllTasks(content, file.path, plugin.settings);
				} catch {
					return [];
				}
			})
		);
		const allTasks = getTaskExclusionRules(app, plugin.settings).filter(results.flat());
		const allOpenTasks = allTasks.filter(t => !t.completed && t.status !== 'cancelled' && !filterService.isTaskExcluded(t));

		// Seuil de 7 jours pour identifier les tâches en retard "obsolètes / en souffrance"
		const sevenDaysAgo = CalendarDate.addDays(dateStr, -7);

		const overdueTasks = allOpenTasks.filter(t =>
			(t.dueDate && t.dueDate < dateStr) ||
			(t.scheduledDate && t.scheduledDate < dateStr)
		);
		const staleTasks = overdueTasks.filter(t =>
			(t.dueDate && t.dueDate <= sevenDaysAgo) ||
			(t.scheduledDate && t.scheduledDate <= sevenDaysAgo)
		);

		// Boîte de réception & Notes en vrac
		const inboxFolder = plugin.settings.inboxFolder ? normalizePath(plugin.settings.inboxFolder).toLowerCase() : '00 - inbox';
		const inboxTasks = allOpenTasks.filter(t => {
			const norm = normalizePath(t.filePath).toLowerCase();
			const isRoot = !norm.includes('/');
			return norm.startsWith(inboxFolder) || norm.includes('notes en vrac') || norm.includes('vrac') || isRoot;
		});

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

		const inboxNotes = inboxNotePreviews.map(n => n.name);

		// Identification des Quick Wins (tâches courtes, faciles ou faible énergie, non Q1)
		const quickWinTasks = allOpenTasks
			.filter(t => {
				const isLowEnergy = t.energy !== undefined && t.energy <= 3;
				const isEasy = t.difficulty && t.difficulty.toLowerCase() === 'facile';
				const isQ3orQ4 = matrixAdapter.getQuadrant(t) === 'q3' || matrixAdapter.getQuadrant(t) === 'q4';
				return isLowEnergy || isEasy || isQ3orQ4;
			})
			.slice(0, 3);

		// Identification de la tâche majeure (The One Thing) : priorité Q1
		let oneThingTask = allOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' && (t.dueDate === dateStr || (t.dueDate && t.dueDate < dateStr)));
		if (!oneThingTask) {
			oneThingTask = allOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || matrixAdapter.getQuadrant(t) === 'q2');
		}
		if (!oneThingTask && overdueTasks.length > 0) {
			oneThingTask = overdueTasks[0];
		}

		// Note quotidienne du jour
		let dailyNoteContent: string | undefined;
		const dailyRes = await vaultContext.getOrCreateDailyNote(dateStr, plugin.settings.dailyNoteTemplatePath);
		if (dailyRes.content && dailyRes.file && !filterService.isFileExcluded(dailyRes.file, dailyRes.content)) {
			dailyNoteContent = dailyRes.content;
		}

		// Lecture des événements Google Calendar du jour si configuré
		let calendarEventsText = '';
		let calendarEvents: GoogleCalendarEvent[] = [];
		if (plugin.settings.googleRefreshToken) {
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
				console.warn('[Second Brain Manager] Erreur récupération événements Google Calendar pour la reprise:', calErr);
			}
		}

		return {
			dateStr,
			formattedDate: capitalizedDate,
			inactivityText,
			inactivityDays,
			quickWinTasks,
			oneThingTask,
			overdueTasks,
			staleTasks,
			inboxTasks,
			inboxNotes,
			inboxNotePreviews,
			folders: structure.folders,
			projects: structure.projects,
			contacts: structure.contacts,
			energy,
			dailyNoteContent,
			calendarEvents,
			calendarEventsText,
			customPromptInstructions: plugin.settings.customPromptInstructions,
			rhythm: computeUserRhythm(plugin.pluginData?.completionEvents, dateStr),
			delegatedTasks: [...overdueTasks, ...staleTasks].filter((t, i, arr) => t.person && arr.indexOf(t) === i),
			inboxFolder: plugin.settings.inboxFolder,
			googleConnected: Boolean(plugin.settings.googleRefreshToken) && plugin.isFeatureEnabled?.('calendar') !== false,
			gamificationEnabled: plugin.isFeatureEnabled?.('gamification') !== false
		};
	}

	/**
	 * Génère un ensemble varié de propositions d'allègement avec métadonnées exhaustives
	 * en respectant les priorités définies par l'utilisateur.
	 */
	public static generateDefaultLighteningProposals(data: RecoveryVaultData, plugin?: SecondBrainPlugin): ActionProposal[] {
		const proposals: ActionProposal[] = [];
		const fourteenDaysAgo = CalendarDate.addDays(data.dateStr, -14);
		const sevenDaysAgo = CalendarDate.addDays(data.dateStr, -7);

		const matrixAdapter = plugin 
			? MatrixAdapterFactory.createAdapter(plugin.settings.matrixProvider, plugin.settings.customMatrixMapping)
			: MatrixAdapterFactory.createAdapter('task-matrix');

		// 1. Triage des tâches en retard
		data.overdueTasks.forEach((task, idx) => {
			const isExplicitlyCritical = TaskSafetyGuard.isExplicitlyCritical(task);
			const effectiveDate = task.dueDate || task.scheduledDate;
			const isVeryStale = effectiveDate && effectiveDate <= fourteenDaysAgo;
			const isMeetingOrCall = /réunion|rdv|rendez-vous|call|point\s/i.test(task.title);
			const currentQ = matrixAdapter.getQuadrant(task);

			if (isExplicitlyCritical) {
				// Tâche explicitement prioritaire (Q1 / Haute priorité) : Report sécurisé à aujourd'hui
				const diff: TaskDiffMetadata = {
					taskTitle: task.title,
					filePath: task.filePath,
					lineNumber: task.lineNumber,
					oldDueDate: task.dueDate,
					newDueDate: data.dateStr,
					oldQuadrant: MatrixFeature.isEnabled() ? currentQ || 'q1' : null,
					newQuadrant: MatrixFeature.isEnabled() ? 'q1' : null,
					oldPriority: task.priority || 'high',
					newPriority: task.priority || 'high',
					oldEnergy: task.energy,
					newEnergy: task.energy,
					reason: 'Tâche prioritaire : report immédiat à aujourd\'hui sans délestage'
				};

				proposals.push({
					id: `recovery-critical-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					taskTitle: task.title,
					description: `⏩ Reporter à aujourd'hui (${MatrixFeature.isEnabled() ? 'Priorité Q1' : 'prioritaire'}) : "${task.title}"`,
					selected: true,
					newDueDate: data.dateStr,
					newMatrixQuadrant: MatrixFeature.isEnabled() ? 'q1' : undefined,
					diff,
					reason: diff.reason
				} as UpdateTaskActionProposal);

			} else if (isVeryStale || isMeetingOrCall) {
				// Annulation des tâches très anciennes (>14j) ou événements passés non critiques
				const diff: TaskDiffMetadata = {
					taskTitle: task.title,
					filePath: task.filePath,
					lineNumber: task.lineNumber,
					oldDueDate: task.dueDate,
					newDueDate: task.dueDate,
					oldQuadrant: currentQ,
					newQuadrant: currentQ,
					oldPriority: task.priority,
					newPriority: task.priority,
					oldEnergy: task.energy,
					newEnergy: task.energy,
					oldStatus: '- [ ]',
					newStatus: 'cancelled',
					reason: isMeetingOrCall ? 'Événement ou rendez-vous passé' : 'Tâche dépassée depuis plus de 14 jours'
				};

				proposals.push({
					id: `recovery-cancel-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					taskTitle: task.title,
					description: `❌ Annuler la tâche obsolète : "${task.title}"`,
					selected: true,
					newStatus: 'cancelled',
					diff,
					reason: diff.reason
				} as UpdateTaskActionProposal);

			} else if (currentQ === 'q1' && effectiveDate && effectiveDate <= sevenDaysAgo) {
				// Rétrogradation de quadrant (Q1 -> Q2) pour soulager la reprise
				const targetQ = 'q2';
				const diff: TaskDiffMetadata = {
					taskTitle: task.title,
					filePath: task.filePath,
					lineNumber: task.lineNumber,
					oldDueDate: task.dueDate,
					newDueDate: data.dateStr,
					oldQuadrant: 'q1',
					newQuadrant: targetQ,
					oldPriority: task.priority || 'high',
					newPriority: 'normal',
					oldEnergy: task.energy,
					newEnergy: task.energy,
					reason: 'Rétrogradation de Q1 vers Q2 pour éliminer le faux sentiment d\'urgence et planifier sereinement'
				};

				proposals.push({
					id: `recovery-demote-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					taskTitle: task.title,
					description: `🔽 Rétrograder en Q2 et replanifier : "${task.title}"`,
					selected: true,
					newMatrixQuadrant: targetQ,
					newDueDate: data.dateStr,
					newPriority: 'normal',
					diff,
					reason: diff.reason
				} as UpdateTaskActionProposal);

			} else {
				// Report de date normal à aujourd'hui
				const diff: TaskDiffMetadata = {
					taskTitle: task.title,
					filePath: task.filePath,
					lineNumber: task.lineNumber,
					oldDueDate: task.dueDate,
					newDueDate: data.dateStr,
					oldQuadrant: currentQ,
					newQuadrant: currentQ,
					oldPriority: task.priority,
					newPriority: task.priority,
					oldEnergy: task.energy,
					newEnergy: task.energy,
					reason: 'Replanification pour aujourd\'hui suite à la reprise'
				};

				proposals.push({
					id: `recovery-postpone-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					taskTitle: task.title,
					description: `⏩ Reporter à aujourd'hui : "${task.title}"`,
					selected: true,
					newDueDate: data.dateStr,
					diff,
					reason: diff.reason
				} as UpdateTaskActionProposal);
			}
		});

		// 2. Triage des notes en vrac
		if (data.inboxNotePreviews && data.inboxNotePreviews.length > 0) {
			data.inboxNotePreviews.forEach((note, idx) => {
				const isLoose = note.path.toLowerCase().includes('vrac') || note.path.toLowerCase().includes('inbox') || !note.path.includes('/');
				if (isLoose) {
					let destFolder = '01 - Projets';
					if (data.folders && data.folders.length > 0) {
						const matching = data.folders.find(f =>
							f.toLowerCase().includes(note.name.toLowerCase()) ||
							note.name.toLowerCase().includes(f.toLowerCase().split('/').pop() || '')
						);
						if (matching) destFolder = matching;
					}

					proposals.push({
						id: `recovery-move-note-${idx}-${Date.now()}`,
						type: 'move_note',
						targetPath: note.path,
						destinationFolder: destFolder,
						description: `📁 Ranger la note [[${note.name}]] vers "${destFolder}"`,
						selected: true
					});
				}
			});
		}

		return proposals;
	}

	/**
	 * Extrait les propositions d'actions JSON retournées par l'IA et applique la sanitarisation.
	 */
	public static extractProposalsFromResponse(
		responseText: string,
		defaultProposals: ActionProposal[],
		vaultTasks: ObsidianTask[] = [],
		todayStr?: string
	): { cleanText: string; proposals: ActionProposal[] } {
		const blocks = JsonUtils.extractJsonBlocks(responseText);

		if (blocks.length === 0) {
			return {
				cleanText: responseText.trim(),
				proposals: defaultProposals
			};
		}

		let cleanText = responseText;
		const validatedProposals: ActionProposal[] = [];

		for (const block of blocks) {
			const parsed = JsonUtils.safeParseJson(block.jsonText);
			if (Array.isArray(parsed) && parsed.length > 0) {
				const proposalsFromBlock = parsed
					.filter(p => p && typeof p === 'object' && p.type)
					.map((p, index) => {
						const rawTarget = p.targetPath || (p.folder ? `${p.folder}/${p.fileName || 'Note'}` : p.fileName) || p.description || 'Note';
						const targetPath = String(rawTarget).replace(/[\r\n]+/g, ' ').trim();
						const lineNum = Number(p.lineNumber || 1);

						// Recherche de la tâche originale dans le coffre pour enrichir les informations
						const matchedTask = vaultTasks.find(vt => vt.filePath === targetPath && vt.lineNumber === lineNum)
							|| vaultTasks.find(vt => vt.filePath === targetPath);

						const taskTitle = p.taskTitle || matchedTask?.title || p.description || 'Tâche';
						const oldDueDate = p.oldDueDate || matchedTask?.dueDate;
						const oldQuadrant = p.oldQuadrant || matchedTask?.matrixTag?.replace('#tm/', '');
						const oldPriority = p.oldPriority || matchedTask?.priority;
						const oldEnergy = p.oldEnergy || matchedTask?.energy;
						const reason = p.reason || p.description;

						const diff: TaskDiffMetadata = {
							taskTitle,
							filePath: targetPath,
							lineNumber: lineNum,
							oldDueDate,
							newDueDate: p.newDueDate,
							oldQuadrant,
							newQuadrant: p.newMatrixQuadrant,
							oldPriority,
							newPriority: p.newPriority,
							oldEnergy,
							newEnergy: p.newEnergy,
							newStatus: p.newStatus,
							reason
						};

						const prop: ActionProposal = {
							...p,
							id: p.id || `recovery-ai-${index}-${Date.now()}`,
							type: p.type,
							targetPath,
							lineNumber: lineNum,
							taskTitle,
							description: p.description || `Action sur ${taskTitle}`,
							selected: p.selected !== false,
							diff,
							reason
						} as ActionProposal;

						return TaskSafetyGuard.sanitizeProposal(prop, matchedTask, todayStr);
					});

				if (proposalsFromBlock.length > 0) {
					validatedProposals.push(...proposalsFromBlock);
					cleanText = cleanText.replace(block.fullMatchText, '');
				}
			}
		}

		cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

		const refined = refineBriefingProposals(validatedProposals, { existingTaskTitles: vaultTasks.map(t => t.title) });

		return {
			cleanText: cleanText || responseText.trim(),
			proposals: refined.length > 0 ? refined : defaultProposals
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour un réembarquement doux et un allègement complet.
	 */
	public static buildRecoveryMessages(data: RecoveryVaultData, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ChatMessage[] {
		const formatTaskDetailed = (t: ObsidianTask): string => {
			return TaskMutator.formatTaskForPrompt(t, config);
		};

		const taskSyntaxDesc = TaskMutator.getTaskSyntaxPromptDescription(config);

		const oneThingText = data.oneThingTask
			? formatTaskDetailed(data.oneThingTask)
			: 'Aucune tache majeure detectee.';

		const quickWinsText = data.quickWinTasks.length > 0
			? data.quickWinTasks.map(formatTaskDetailed).join('\n')
			: 'Aucune tache rapide identifiee.';

		const overdueText = data.overdueTasks.length > 0
			? data.overdueTasks.slice(0, 35).map(formatTaskDetailed).join('\n')
			: 'Aucune urgence en retard.';

		const staleText = data.staleTasks.length > 0
			? data.staleTasks.slice(0, 35).map(formatTaskDetailed).join('\n')
			: 'Aucune tache ancienne en souffrance.';

		const looseNotesText = (data.inboxNotePreviews && data.inboxNotePreviews.length > 0)
			? data.inboxNotePreviews.map(n => `- [[${n.name}]] (Chemin: "${n.path}")${n.preview ? ` : "${n.preview}"` : ''}`).join('\n')
			: (data.inboxNotes.length > 0 ? data.inboxNotes.map(n => `- [[${n}]]`).join('\n') : 'Inbox vide.');

		const foldersText = (data.folders && data.folders.length > 0)
			? data.folders.slice(0, 25).join(', ')
			: 'Racine';

		let calendarSectionText = '';
		if (data.calendarEventsText && data.calendarEventsText.trim() && !data.calendarEventsText.startsWith('Aucun')) {
			calendarSectionText = `\nAGENDA & CRÉNEAUX DU JOUR (Google Calendar - PRIORITÉ ABSOLUE) :\n${data.calendarEventsText}\nATTENTION : Ces rendez-vous sont des contraintes fermes prioritaires sur toutes les tâches. Tu dois impérativement articuler le plan de reprise et les tâches dans les temps libres restants entre ces créneaux.\n`;
		}

		let customInstructionsSection = '';
		if (data.customPromptInstructions && data.customPromptInstructions.trim()) {
			customInstructionsSection = `\nINSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L'UTILISATEUR (À RESPECTER SCRUPULEUSEMENT) :\n${data.customPromptInstructions.trim()}\n`;
		}

		const hasCalendar = Boolean(calendarSectionText);
		const agendaRules = hasCalendar
			? `\nPRISE EN COMPTE DES AGENDAS :
1. Les rendez-vous de l'agenda principal et des agendas secondaires sont des contraintes fermes : place le plan de reprise dans les créneaux libres.
2. Les agendas d'autres personnes (proches, collègues) sont informatifs : mentionne-les sobrement si c'est utile, sans les compter comme des contraintes ni signaler de conflit.\n`
			: '';
		const delegated = buildDelegatedSection(data.delegatedTasks || [], data.contacts || [], formatTaskDetailed);

		const systemPrompt = `Tu es "Second Brain Manager", le copilote d'organisation personnelle de l'utilisateur, à l'aise avec la méthode GTD et la remise en ordre d'un coffre.

CE QUE TU SAIS DE L'UTILISATEUR :
- Énergie déclarée : ${data.energy}/10.
${describeRhythm(data.rhythm ?? null, data.energy)}${customInstructionsSection}

SON COFFRE :
${describeVaultConventions({
	inboxFolder: data.inboxFolder,
	projects: data.projects,
	contacts: data.contacts,
	googleConnected: data.googleConnected ?? hasCalendar,
	gamificationEnabled: data.gamificationEnabled !== false
})}
${agendaRules}
${sharedStyleGuidelines()}

TON OBJECTIF :
Accueillir l'utilisateur (${data.inactivityText}) simplement et sans culpabiliser, puis lui proposer un plan de tri et d'organisation réaliste pour reprendre la main sur ses tâches et ses notes. Mieux vaut quelques décisions nettes qu'un inventaire.${delegated.directive}

DISCERNEMENT SÉMANTIQUE ET SÉCURITÉ :
- Fais preuve d'un discernement contextuel approfondi :
  - Identifie les obligations à conséquences réelles (ex: paiements obligatoires, engagements contractuels, démarches administratives, santé). Pour ces tâches, propose un report prioritaire à aujourd'hui (${data.dateStr}).
  - Annule les tâches ou rendez-vous périmés depuis longtemps sans conséquences actuelles (\`newStatus: "cancelled"\`).
  - Range et renomme les notes en vrac vers les dossiers de projets ou de domaines correspondants avec des noms clairs (\`type: "move_note"\` ou \`type: "rename_note"\`).

LEVIERS DISPONIBLES (n'utilise que ceux qui s'appliquent vraiment) :
1. Annulation / Obsolescence (passer en \`newStatus: "cancelled"\` les tâches obsolètes ou périmées).
2. Report de date (replanifier à aujourd'hui ou à une date réaliste).
3. Rangement & Renommage de notes en vrac (\`type: "move_note"\`, \`type: "rename_note"\`).
${MatrixFeature.isEnabled() ? '4. Rétrogradation de quadrant (passer de Q1 à Q2 pour ajuster la priorité).' : '4. Baisse de priorité (newPriority) pour les tâches qui ne sont plus pressantes. Les quadrants sont désactivés : n\'utilise jamais newMatrixQuadrant.'}
5. Délestage d'échéances (mettre \`newDueDate: null\` sur les tâches de fond sans date butoir ferme).

STRUCTURE DE TA RÉPONSE (omets toute partie sans contenu utile) :
1. Accueil & Synthèse de Reprise (Salutation courtoise et résumé net du volume à réorganiser).
2. Contraintes de l'Agenda (seulement s'il y a des rendez-vous aujourd'hui).
3. Action Prioritaire (The One Thing - La tâche clé du jour au format \`- [ ] ... [[Note]]\`, calée hors des rendez-vous).
4. Actions Rapides (Quick Wins - 1 ou 2 micro-tâches simples de 5 min si pertinent pour amorcer l'élan).
5. Plan de Tri & Organisation Détaillé (Justification claire des annulations, reports, rangements et renommages).
6. Format des tâches :
${taskSyntaxDesc}
7. Conseil de Démarrage (Une recommandation motivante et pratique).

${actionPolicy({
	dailyTargetPath: 'la note quotidienne du jour',
	allowed: ['update_task', 'move_note', 'rename_note'],
	example: `\`\`\`json:actions
[
  { "type": "update_task", "targetPath": "<chemin fourni>", "lineNumber": 12, "taskTitle": "<intitulé exact>", "newDueDate": "${data.dateStr}", "reason": "Échéance réelle : à traiter aujourd'hui" },
  { "type": "update_task", "targetPath": "<chemin fourni>", "lineNumber": 5, "taskTitle": "<intitulé exact>", "newStatus": "cancelled", "reason": "Réunion passée, plus d'objet" },
  { "type": "move_note", "targetPath": "<chemin de la note en vrac>", "destinationFolder": "<dossier existant>", "newFileName": "<nom clair>.md", "description": "Ranger la note dans son projet" }
]
\`\`\``
})}
Pendant une reprise, on trie l'existant : ne propose pas de nouvelles tâches.`;

		const userPrompt = `Voici la situation actuelle de mon coffre pour ma reprise (${data.inactivityText}, Date du jour : ${data.dateStr}, Energie : ${data.energy}/10) :

Dossiers disponibles : ${foldersText}
${calendarSectionText}
TACHE MAJEURE DETECTEE (THE ONE THING) :
${oneThingText}

QUICK WINS DISPONIBLES :
${quickWinsText}

TACHES EN RETARD ET ANCIENNES (${data.overdueTasks.length} au total) :
${overdueText}

TACHES EN SOUFFRANCE (> 7 jours de retard, ${data.staleTasks.length} au total) :
${staleText}

NOTES EN VRAC ET BOITE DE RECEPTION :
${looseNotesText}
${delegated.section}
Prépare-moi un plan de reprise réaliste : quelques décisions nettes pour alléger tâches et notes, avec les modifications utiles dans un bloc json:actions pour que je puisse les appliquer d'un clic.`;

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		];
	}

	/**
	 * Exécute la génération de reprise en streaming avec gestion des clés d'API et du modèle.
	 */
	public static async generateRecovery(
		app: App,
		plugin: SecondBrainPlugin,
		signal: AbortSignal,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<{ text: string; data: RecoveryVaultData; allTasks: ObsidianTask[]; proposals: ActionProposal[] }> {
		const data = await this.collectRecoveryData(app, plugin);
		const messages = this.buildRecoveryMessages(data, plugin.settings);

		// Lecture de toutes les tâches pour enrichissement
		const files = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					const content = (typeof (app.vault as any).cachedRead === 'function')
						? await (app.vault as any).cachedRead(file)
						: await app.vault.read(file);
					return TaskParser.parseAllTasks(content, file.path, plugin.settings);
				} catch {
					return [];
				}
			})
		);
		const vaultTasks: ObsidianTask[] = getTaskExclusionRules(app, plugin.settings).filter(results.flat());

		const defaultProposals = this.generateDefaultLighteningProposals(data, plugin);

		const apiKey = await plugin.getSecretApiKey(plugin.settings.llmProvider);
		const config: LLMConfig = {
			provider: plugin.settings.llmProvider,
			endpoint: plugin.settings.llmEndpoint,
			model: plugin.settings.llmModel,
			productId: plugin.settings.infomaniakProductId,
			apiKey,
			signal
		};

		let rawGeneratedText = '';
		await LLMService.generateStreamingResponse(
			messages,
			config,
			(chunk, full) => {
				rawGeneratedText = full;
				onChunk(chunk, full);
			}
		);

		const { cleanText, proposals } = this.extractProposalsFromResponse(rawGeneratedText, defaultProposals, vaultTasks, data.dateStr);

		const allTasks = [
			...(data.oneThingTask ? [data.oneThingTask] : []),
			...data.quickWinTasks,
			...data.overdueTasks,
			...data.staleTasks
		];

		return {
			text: cleanText,
			data,
			allTasks,
			proposals
		};
	}

	/**
	 * Reporte en masse une liste de tâches en retard à une date cible (par défaut aujourd'hui).
	 */
	public static async postponeOverdueTasks(
		app: App,
		plugin: SecondBrainPlugin,
		tasks: ObsidianTask[],
		targetDateStr?: string
	): Promise<number> {
		const today = localDateStr();
		const targetDate = targetDateStr || today;
		let modifiedCount = 0;

		const tasksByFile: Map<string, ObsidianTask[]> = new Map();
		for (const t of tasks) {
			const list = tasksByFile.get(t.filePath) || [];
			list.push(t);
			tasksByFile.set(t.filePath, list);
		}

		for (const [filePath, fileTasks] of tasksByFile.entries()) {
			const file = app.vault.getFileByPath(filePath) || app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) continue;

			await app.vault.process(file, (data) => {
				const lines = data.split('\n');
				for (const task of fileTasks) {
					const lineIdx = task.lineNumber - 1;
					if (lineIdx >= 0 && lineIdx < lines.length) {
						lines[lineIdx] = TaskMutator.setDueDate(lines[lineIdx], targetDate);
						modifiedCount++;
					}
				}
				return lines.join('\n');
			});
		}

		return modifiedCount;
	}

	/**
	 * Enregistre le plan de reprise dans la note quotidienne du jour sans dupliquer les tâches (formaté via DailyNoteFormatter).
	 */
	public static async saveRecoveryToDailyNote(
		app: App,
		plugin: SecondBrainPlugin,
		recoveryMarkdown: string,
		dateStr?: string
	): Promise<string> {
		const today = dateStr || localDateStr();
		const dailyFolder = normalizePath(plugin.settings.dailyNotesFolder);
		const dailyPath = normalizePath(`${dailyFolder}/${today}.md`);

		const file = app.vault.getFileByPath(dailyPath) || app.vault.getAbstractFileByPath(dailyPath);

		// Formatage anti-doublons de tâches
		const formattedMarkdown = DailyNoteFormatter.formatForDailyNote(recoveryMarkdown);

		const sectionTitle = '## ☕ Reprise en Douceur & Focus';
		const sectionContent = `${sectionTitle}\n\n${formattedMarkdown}\n`;

		if (file instanceof TFile) {
			await app.vault.process(file, (content) => {
				if (content.includes(sectionTitle)) {
					const regex = new RegExp(`${sectionTitle}[\\s\\S]*?(?=\\n## |$)`, 'g');
					return content.replace(regex, sectionContent.trim());
				} else {
					return content.trim() + '\n\n' + sectionContent;
				}
			});
		} else {
			const folder = (typeof app.vault.getFolderByPath === 'function' ? app.vault.getFolderByPath(dailyFolder) : null) || app.vault.getAbstractFileByPath(dailyFolder);
			if (!folder) {
				await app.vault.createFolder(dailyFolder);
			}
			const initialContent = `# ${today}\n\n${sectionContent}`;
			await app.vault.create(dailyPath, initialContent);
		}

		// Trophées de régularité : seulement quand la gamification est active
		if (plugin?.pluginData && typeof plugin.savePluginData === 'function' && plugin.isFeatureEnabled?.('gamification') !== false) {
			const newlyUnlocked = GamificationService.recordWorkflowEvent(plugin.pluginData, 'recovery');
			await plugin.savePluginData();
			if (newlyUnlocked && newlyUnlocked.length > 0) {
				for (const b of newlyUnlocked) {
					new Notice(`🏆 NOUVEAU BADGE DÉBLOQUÉ : ${b.name} !\n${b.description}`, 7000);
				}
			}
		}

		return dailyPath;
	}
}
