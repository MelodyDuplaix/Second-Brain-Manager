import { App, Notice, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { getTaskExclusionRules } from './taskExclusionService';
import { TaskMutator } from '../mutators/taskMutator';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { DailyNoteFormatter } from './dailyNoteFormatter';
import { VaultContextService } from './vaultContextService';
import { GamificationService } from './gamificationService';
import { TaskSyntaxConfig, DEFAULT_SYNTAX_CONFIG } from '../models/syntaxConfig';
import { GoogleCalendarEvent } from '../models/googleCalendar';
import { GoogleCalendarService } from './googleCalendarService';
import SecondBrainPlugin from '../main';
import { CalendarDate } from './taskCalendarService';
import {
	EVENING_SECTION_HEADER,
	MORNING_SECTION_HEADER,
	UserRhythm,
	buildDelegatedSection,
	clip,
	computeUserRhythm,
	describeVaultConventions,
	extractDailySection,
	localDateStr,
	sameIntent,
	sharedStyleGuidelines,
	stripGeneratedSections
} from './briefingContext';

export interface EveningVaultData {
	dateStr: string;
	formattedDate: string;
	completedTodayTasks: ObsidianTask[];
	coinsEarnedToday: number;
	unfinishedTodayTasks: ObsidianTask[];
	overdueTasks: ObsidianTask[];
	inboxNotes: string[];
	projects: string[];
	contacts: string[];
	dailyNoteContent?: string;
	calendarEvents?: GoogleCalendarEvent[];
	calendarEventsText?: string;
	customPromptInstructions?: string;
	/** Ce que le briefing du matin avait prévu (continuité matin → soir) */
	morningBriefing?: string;
	/** Tâches déjà prévues pour demain */
	tomorrowTasks?: ObsidianTask[];
	/** Tâches données par d'autres qui arrivent à échéance (fonctionnalité optionnelle) */
	delegatedTasks?: ObsidianTask[];
	rhythm?: UserRhythm | null;
	folders?: string[];
	inboxFolder?: string;
	googleConnected?: boolean;
	gamificationEnabled?: boolean;
}

export class EveningReviewService {
	/**
	 * Récupère l'ensemble des données du coffre pour dresser le bilan du soir.
	 */
	public static async collectEveningData(app: App, plugin: SecondBrainPlugin): Promise<EveningVaultData> {
		const today = new Date();
		// Date locale : après minuit, toISOString() donnerait encore la veille
		const dateStr = localDateStr(today);
		const tomorrowStr = CalendarDate.addDays(dateStr, 1);

		const formattedDate = today.toLocaleDateString('fr-FR', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

		const vaultContext = new VaultContextService(app, plugin.settings);
		const filterService = vaultContext.getFilterService();
		const structure = vaultContext.getVaultStructure();

		// Lecture de toutes les tâches du coffre
		const allFiles = (typeof app.vault.getMarkdownFiles === 'function') ? app.vault.getMarkdownFiles() : [];
		const files = allFiles.filter(f => !filterService.isFolderExcluded(f.path) && !filterService.isFileNameExcluded(f.path));
		const completedTodayTasks: ObsidianTask[] = [];
		const unfinishedTodayTasks: ObsidianTask[] = [];
		const overdueTasks: ObsidianTask[] = [];
		const tomorrowTasks: ObsidianTask[] = [];
		const delegatedTasks: ObsidianTask[] = [];

		// Complétions enregistrées aujourd'hui (historique du plugin)
		const completionsToday = Object.values(plugin.pluginData?.completionEvents || {})
			.filter(ev => ev?.completedAt && localDateStr(new Date(ev.completedAt)) === dateStr);
		const completedTextsToday = completionsToday.map(ev => ev.taskText || '').filter(Boolean);

		// Note quotidienne du jour (tous formats de nom pris en charge)
		const dailyRes = await vaultContext.getDailyNote(dateStr);
		const dailyFile = dailyRes.exists ? (app.vault.getFileByPath(dailyRes.path) || app.vault.getAbstractFileByPath(dailyRes.path)) : null;
		const dailyAllowed = dailyFile instanceof TFile && !filterService.isFileExcluded(dailyFile);

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

		for (const t of getTaskExclusionRules(app, plugin.settings).filter(results.flat())) {
			if (filterService.isTaskExcluded(t)) {
				continue;
			}
			if (t.completed || t.status === 'done') {
				// Sans date de complétion, une tâche cochée ne compte que si elle est dans la note du jour
				// ou dans l'historique des complétions d'aujourd'hui (sinon : toutes les anciennes tâches cochées)
				const doneToday = t.completedDate
					? t.completedDate === dateStr
					: t.filePath === dailyRes.path || completedTextsToday.some(txt => txt.includes(t.title) || sameIntent(txt, t.title));
				if (doneToday) completedTodayTasks.push(t);
			} else if (t.status !== 'cancelled' && !t.isPaused && t.status !== 'paused') {
				if (t.dueDate === dateStr || t.scheduledDate === dateStr) {
					unfinishedTodayTasks.push(t);
				} else if (t.dueDate && t.dueDate < dateStr) {
					overdueTasks.push(t);
				} else if (t.dueDate === tomorrowStr || t.scheduledDate === tomorrowStr) {
					tomorrowTasks.push(t);
				}
				if (t.person && ((t.dueDate && t.dueDate <= tomorrowStr) || (t.scheduledDate && t.scheduledDate <= tomorrowStr))) {
					delegatedTasks.push(t);
				}
			}
		}

		// Calcul des pièces gagnées aujourd'hui depuis l'historique
		const gamificationEnabled = plugin.isFeatureEnabled?.('gamification') !== false;
		let coinsEarnedToday = completionsToday.reduce((acc, ev) => acc + (Number(ev.coins) || 0), 0);
		if (gamificationEnabled && coinsEarnedToday === 0 && completedTodayTasks.length > 0) {
			coinsEarnedToday = completedTodayTasks.reduce((acc, t) => acc + (t.pieces || plugin.settings.defaultCoinsPerTask || 1), 0);
		}

		// Fichiers présents dans la boîte de réception (Inbox) non exclus
		const inboxFolder = normalizePath(plugin.settings.inboxFolder);
		const inboxNotes = files
			.filter(f => f.path.startsWith(inboxFolder) && f.basename && !filterService.isFileExcluded(f))
			.map(f => f.basename);

		// Note quotidienne du jour et plan du matin (continuité)
		const dailyNoteContent = dailyAllowed ? dailyRes.content : undefined;
		const morningBriefing = extractDailySection(dailyNoteContent, MORNING_SECTION_HEADER);

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
				console.warn('[Second Brain Manager] Erreur récupération événements Google Calendar pour la revue du soir:', calErr);
			}
		}

		return {
			dateStr,
			formattedDate: capitalizedDate,
			completedTodayTasks,
			coinsEarnedToday,
			unfinishedTodayTasks,
			overdueTasks,
			inboxNotes,
			projects: structure.projects,
			contacts: structure.contacts,
			dailyNoteContent,
			calendarEvents,
			calendarEventsText,
			customPromptInstructions: plugin.settings.customPromptInstructions,
			morningBriefing,
			tomorrowTasks,
			delegatedTasks,
			rhythm: computeUserRhythm(plugin.pluginData?.completionEvents, dateStr),
			folders: structure.folders,
			inboxFolder: plugin.settings.inboxFolder,
			googleConnected,
			gamificationEnabled
		};
	}

	/**
	 * Construit le prompt système et utilisateur de la revue du soir.
	 * Seules les rubriques qui ont du contenu sont envoyées et demandées.
	 */
	public static buildEveningMessages(data: EveningVaultData, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ChatMessage[] {
		const formatTaskLine = (t: ObsidianTask): string => TaskMutator.formatTaskForPrompt(t, config);
		const gamificationOn = data.gamificationEnabled !== false;
		const hasCalendar = Boolean(data.calendarEventsText && data.calendarEventsText.trim() && !data.calendarEventsText.startsWith('Aucun'));
		const googleConnected = data.googleConnected ?? hasCalendar;
		const block = (title: string, tasks: ObsidianTask[], limit: number) => tasks.length
			? `${title} :\n${tasks.slice(0, limit).map(formatTaskLine).join('\n')}${tasks.length > limit ? `\n… et ${tasks.length - limit} autre(s)` : ''}\n`
			: '';

		const completedSection = data.completedTodayTasks.length
			? block(`TACHES TERMINEES AUJOURD'HUI (${data.completedTodayTasks.length})`, data.completedTodayTasks, 25)
			: `TACHES TERMINEES AUJOURD'HUI : aucune tâche cochée aujourd'hui.\n`;
		const coinsLine = gamificationOn && data.coinsEarnedToday > 0 ? `Pieces gagnees aujourd'hui : +${data.coinsEarnedToday} pieces\n` : '';

		const morningPlan = data.morningBriefing
			? `CE QUE LE BRIEFING DE CE MATIN AVAIT PRÉVU :\n${clip(data.morningBriefing, 1500)}\n`
			: '';
		const calendarSectionText = hasCalendar
			? `AGENDA DU JOUR (rendez-vous qui ont occupé la journée) :\n${data.calendarEventsText}\n`
			: '';

		const delegated = buildDelegatedSection(
			(data.delegatedTasks || []).filter(t => !data.unfinishedTodayTasks.includes(t) && !data.overdueTasks.includes(t)),
			data.contacts || [],
			formatTaskLine
		);

		const inboxText = data.inboxNotes.length
			? `NOTES EN BOITE DE RECEPTION (${data.inboxNotes.length}) :\n${data.inboxNotes.slice(0, 20).map(n => `- [[${n}]]`).join('\n')}\n`
			: '';
		const foldersText = data.inboxNotes.length && data.folders?.length
			? `Dossiers existants (pour ranger) : ${data.folders.slice(0, 30).join(', ')}\n`
			: '';

		const dailyNoteBody = stripGeneratedSections(data.dailyNoteContent);
		const dailyNoteSnippet = dailyNoteBody
			? `NOTE QUOTIDIENNE DU JOUR (écrite par l'utilisateur) :\n${clip(dailyNoteBody, 1500)}\n`
			: '';

		const userMessage = [
			`Voici le bilan de mon coffre pour ce ${data.formattedDate}.`,
			[morningPlan, calendarSectionText].filter(Boolean).map(s => s.trim()).join('\n\n'),
			[
				completedSection + coinsLine,
				block(`TACHES PREVUES AUJOURD'HUI ET NON TERMINEES (${data.unfinishedTodayTasks.length})`, data.unfinishedTodayTasks, 20),
				block(`AUTRES TACHES EN RETARD (${data.overdueTasks.length})`, data.overdueTasks, 8),
				delegated.section.trim() ? `${delegated.section.trim()}\n` : '',
				block(`DEJA PREVU POUR DEMAIN (${(data.tomorrowTasks || []).length})`, data.tomorrowTasks || [], 10),
				inboxText,
				foldersText
			].filter(Boolean).map(s => s.trim()).join('\n\n'),
			dailyNoteSnippet,
			'Dresse le bilan de ma journée et aide-moi à libérer mon esprit pour ce soir.'
		].filter(s => s && s.trim()).map(s => s.trim()).join('\n\n');

		const customInstructionsSection = data.customPromptInstructions?.trim()
			? `\nINSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L'UTILISATEUR (À RESPECTER SCRUPULEUSEMENT, elles priment sur les règles générales) :\n${data.customPromptInstructions.trim()}\n`
			: '';

		const agendaRules = hasCalendar
			? `\nAGENDAS : les rendez-vous de l'agenda personnel ont occupé du temps réel : tiens-en compte pour juger la journée avec justesse. Les agendas d'autres personnes ne concernent pas l'utilisateur.\n`
			: '';

		const rhythm = data.rhythm;
		const rhythmLine = rhythm && rhythm.activeDays >= 3
			? `- D'habitude, l'utilisateur termine environ ${rhythm.avgPerActiveDay.toFixed(1).replace('.', ',').replace(',0', '')} tâche(s) les jours actifs ; aujourd'hui : ${data.completedTodayTasks.length}. Situe la journée avec justesse, sans flatterie ni reproche.`
			: '';

		const hasLeftovers = data.unfinishedTodayTasks.length > 0 || data.overdueTasks.length > 0;
		const structure = `DÉROULÉ DE LA REVUE (dans cet ordre, en omettant toute partie sans contenu utile) :
   - **Bilan de la Journée** : ce qui a avancé (tâches terminées${hasCalendar ? ', rendez-vous tenus' : ''}${gamificationOn ? ', pièces gagnées' : ''}), en reconnaissant l'effort réel.${data.morningBriefing ? ' Compare honnêtement avec le plan du matin : ce qui est fait, ce qui a glissé et pourquoi c\'est acceptable.' : ''}
${hasLeftovers ? `   - **Triage des Tâches Restantes** : pour chaque tâche restante importante, une décision simple (demain, plus tard, à abandonner). Un bouton « Reporter les tâches restantes à demain » existe : ne détaille pas un report qui va de soi, concentre-toi sur les vrais choix. Ne surcharge pas demain${(data.tomorrowTasks || []).length ? ` (déjà ${(data.tomorrowTasks || []).length} tâche(s) prévue(s))` : ''}.\n` : ''}${delegated.count ? `   - **Engagements envers les autres** : les tâches données par quelqu'un qui arrivent à échéance ; suggère de prévenir la personne si un délai est nécessaire.\n` : ''}${data.inboxNotes.length ? `   - **Boîte de Réception** : suggère brièvement où ranger les notes, dans les dossiers existants du coffre.\n` : ''}   - **Mot de Clôture** : une phrase pour fermer la journée et passer à la soirée.`;

		const systemPrompt = `Tu es "Second Brain Manager", le copilote d'organisation personnelle de l'utilisateur, à l'aise avec la méthode GTD.
Tu rédiges sa Revue du Soir : un bilan juste et apaisant de la journée, qui décharge l'esprit et prépare demain sans le surcharger.

CE QUE TU SAIS DE L'UTILISATEUR :
${[rhythmLine, '- Le soir, l\'objectif est de clore la journée : pas de nouvelles résolutions ni de liste d\'efforts supplémentaires.'].filter(Boolean).join('\n')}${customInstructionsSection}

SON COFFRE :
${describeVaultConventions({
	inboxFolder: data.inboxFolder,
	projects: data.projects,
	contacts: data.contacts,
	googleConnected,
	gamificationEnabled: gamificationOn
})}
${agendaRules}
${sharedStyleGuidelines()}

${structure}

TÂCHES CITÉES :
Pour une tâche existante, reprends son intitulé exact (sans chemin ni numéro de ligne) afin qu'elle reste cochable.
Ne crée pas de nouvelles tâches et n'ajoute pas de bloc json:actions : si un élément de la journée appelle vraiment une action nouvelle, mentionne-le simplement comme suggestion.`;

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userMessage }
		];
	}

	/**
	 * Exécute la génération de la revue du soir en streaming.
	 */
	public static async generateEveningReview(
		app: App,
		plugin: SecondBrainPlugin,
		signal: AbortSignal,
		onChunk: (chunk: string, fullText: string) => void
	): Promise<{ text: string; data: EveningVaultData; allTasks: ObsidianTask[] }> {
		const data = await this.collectEveningData(app, plugin);
		const messages = this.buildEveningMessages(data, plugin.settings);

		const apiKey = await plugin.getSecretApiKey(plugin.settings.llmProvider);
		const config: LLMConfig = {
			provider: plugin.settings.llmProvider,
			endpoint: plugin.settings.llmEndpoint,
			model: plugin.settings.llmModel,
			productId: plugin.settings.infomaniakProductId,
			apiKey,
			signal
		};

		let generatedText = '';
		await LLMService.generateStreamingResponse(
			messages,
			config,
			(chunk, full) => {
				generatedText = full;
				onChunk(chunk, full);
			}
		);

		const allTasks = [
			...data.unfinishedTodayTasks,
			...data.overdueTasks,
			...(data.delegatedTasks || []),
			...(data.tomorrowTasks || []),
			...data.completedTodayTasks
		];

		return {
			text: generatedText,
			data,
			allTasks
		};
	}

	/**
	 * Enregistre ou met à jour la section Revue du soir dans la Daily Note du jour.
	 */
	public static async saveReviewToDailyNote(
		app: App,
		plugin: SecondBrainPlugin,
		reviewText: string,
		dateStr: string
	): Promise<string> {
		const vaultContext = new VaultContextService(app, plugin.settings);
		const dailyRes = await vaultContext.getDailyNote(dateStr);
		const filePath = dailyRes.path;

		const folderPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
		if (folderPath) {
			const folder = app.vault.getFolderByPath(folderPath);
			if (!folder) {
				await app.vault.createFolder(folderPath);
			}
		}

		const cleanText = DailyNoteFormatter.formatForDailyNote(reviewText);
		const sectionHeader = EVENING_SECTION_HEADER;
		const sectionContent = `${sectionHeader}\n\n*Clôturé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}*\n\n${cleanText}\n`;

		const existingFile = app.vault.getFileByPath(filePath) || app.vault.getAbstractFileByPath(filePath);

		if (existingFile instanceof TFile) {
			await app.vault.process(existingFile, (content) => {
				if (content.includes(sectionHeader)) {
					const regex = new RegExp(`## 🌙 Revue du Soir & Bilan[\\s\\S]*?(?=\\n## |$)`, 'g');
					return content.replace(regex, sectionContent.trim());
				} else {
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
			const newlyUnlocked = GamificationService.recordWorkflowEvent(plugin.pluginData, 'evening_review');
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
	 * Reporte à demain toutes les tâches non terminées d'aujourd'hui dans leurs notes sources.
	 */
	public static async deferUnfinishedTasksToTomorrow(
		app: App,
		plugin: SecondBrainPlugin,
		tasks: ObsidianTask[]
	): Promise<number> {
		const tomorrowStr = CalendarDate.addDays(localDateStr(), 1);

		let updatedCount = 0;
		const tasksByFile = new Map<string, ObsidianTask[]>();

		for (const task of tasks) {
			if (!task.completed && task.status !== 'cancelled') {
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
						lines[idx] = TaskMutator.setDueDate(lines[idx], tomorrowStr, plugin.settings);
						updatedCount++;
					}
				}
				return lines.join('\n');
			});
		}

		return updatedCount;
	}
}
