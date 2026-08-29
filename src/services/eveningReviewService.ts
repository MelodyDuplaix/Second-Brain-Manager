import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
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
}

export class EveningReviewService {
	/**
	 * Récupère l'ensemble des données du coffre pour dresser le bilan du soir.
	 */
	public static async collectEveningData(app: App, plugin: SecondBrainPlugin): Promise<EveningVaultData> {
		const today = new Date();
		const dateStr = today.toISOString().split('T')[0];

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

		for (const t of results.flat()) {
			if (filterService.isTaskExcluded(t)) {
				continue;
			}
			if (t.completed || t.status === 'done') {
				if (t.completedDate === dateStr || !t.completedDate) {
					completedTodayTasks.push(t);
				}
			} else if (t.status !== 'cancelled') {
				if (t.dueDate === dateStr || t.scheduledDate === dateStr) {
					unfinishedTodayTasks.push(t);
				} else if (t.dueDate && t.dueDate < dateStr) {
					overdueTasks.push(t);
				}
			}
		}

		// Calcul des pièces gagnées aujourd'hui depuis l'historique
		let coinsEarnedToday = 0;
		if (plugin.pluginData && plugin.pluginData.completionEvents) {
			const events = Object.values(plugin.pluginData.completionEvents);
			events.forEach(ev => {
				if (ev.timestamp && ev.timestamp.startsWith(dateStr)) {
					coinsEarnedToday += ev.coinsAwarded || 0;
				}
			});
		}
		if (coinsEarnedToday === 0 && completedTodayTasks.length > 0) {
			coinsEarnedToday = completedTodayTasks.reduce((acc, t) => acc + (t.pieces || plugin.settings.defaultCoinsPerTask || 1), 0);
		}

		// Fichiers présents dans la boîte de réception (Inbox) non exclus
		const inboxFolder = normalizePath(plugin.settings.inboxFolder);
		const inboxNotes = files
			.filter(f => f.path.startsWith(inboxFolder) && f.basename && !filterService.isFileExcluded(f))
			.map(f => f.basename);

		// Lecture de la note quotidienne du jour si elle existe
		let dailyNoteContent: string | undefined;
		const dailyPath = normalizePath(`${plugin.settings.dailyNotesFolder}/${dateStr}.md`);
		const dailyFile = app.vault.getFileByPath(dailyPath) || app.vault.getAbstractFileByPath(dailyPath);
		if (dailyFile instanceof TFile && !filterService.isFileExcluded(dailyFile)) {
			dailyNoteContent = await app.vault.read(dailyFile);
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
			customPromptInstructions: plugin.settings.customPromptInstructions
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour la revue du soir.
	 */
	public static buildEveningMessages(data: EveningVaultData, config: TaskSyntaxConfig = DEFAULT_SYNTAX_CONFIG): ChatMessage[] {
		const formatTaskLine = (t: ObsidianTask): string => {
			return TaskMutator.formatTaskForPrompt(t, config);
		};

		const taskSyntaxDesc = TaskMutator.getTaskSyntaxPromptDescription(config);

		const completedText = data.completedTodayTasks.length > 0
			? data.completedTodayTasks.map(formatTaskLine).join('\n')
			: 'Aucune tâche marquée terminée aujourd\'hui.';

		const unfinishedText = data.unfinishedTodayTasks.length > 0
			? data.unfinishedTodayTasks.map(formatTaskLine).join('\n')
			: 'Toutes les tâches prévues aujourd\'hui ont été traitées.';

		const overdueText = data.overdueTasks.length > 0
			? data.overdueTasks.slice(0, 8).map(formatTaskLine).join('\n')
			: 'Aucune autre tâche en retard.';

		const inboxText = data.inboxNotes.length > 0
			? data.inboxNotes.map(n => `- [[${n}]]`).join('\n')
			: 'Boîte de réception vide.';

		let calendarSectionText = '';
		if (data.calendarEventsText && data.calendarEventsText.trim() && !data.calendarEventsText.startsWith('Aucun')) {
			calendarSectionText = `\nAGENDA DU JOUR (Rendez-vous et réunions ayant pris du temps sur la journée) :\n${data.calendarEventsText}\n`;
		}

		let customInstructionsSection = '';
		if (data.customPromptInstructions && data.customPromptInstructions.trim()) {
			customInstructionsSection = `\nINSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L'UTILISATEUR (À RESPECTER SCRUPULEUSEMENT) :\n${data.customPromptInstructions.trim()}\n`;
		}

		let dailyNoteSnippet = '';
		if (data.dailyNoteContent) {
			dailyNoteSnippet = `\nContenu actuel de la note quotidienne du jour (${data.dateStr}) :\n${data.dailyNoteContent.slice(0, 1500)}\n`;
		}

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en productivité personnelle, méthodologie GTD et clôture de journée.

PRISE EN COMPTE DU TEMPS AGENDA & SÉPARATION DES AGENDAS :
- Les rendez-vous sous "MON AGENDA PERSONNEL DE RÉFÉRENCE" ont la priorité absolue et occupent du temps réel de concentration. Prends en compte la charge d'événements personnels pour contextualiser les avancées de l'utilisateur avec justesse.
- Les événements sous "AGENDAS D'AUTRES PERSONNES" appartiennent exclusivement à des tiers (proches, collègues, équipe). L'utilisateur n'y a pas participé personnellement et ils n'impactent pas son temps.${customInstructionsSection}

TON OBJECTIF :
Fournir une Revue du Soir claire, constructive et agréable pour faire le point sur la journée écoulée, récapituler le travail accompli, réorganiser les tâches restantes et libérer la charge mentale avant la soirée.

CONSIGNES DE TON ET DE STYLE :
- **Ton Équilibré, Chaleureux et Professionnel** : Adopte un ton constructif, courtois et mature. Sois encourageant sans en faire trop, en reconnaissant les efforts et en apportant des conseils d'organisation pratiques.
- **Clarté et Rythme** : Présente les faits avec fluidité et structure sans lourdeur.
- **Sobriété Visuelle** : N'utilise AUCUN émoji dans ta réponse textuelle (sauf si le format de tâche configuré l'impose explicitement pour les métadonnées). Reste sobre et élégant.

CONSIGNES DE REDACTION :
1. **Bilan de la Journée** : Synthèse équilibrée des tâches accomplies (${data.completedTodayTasks.length} tâche(s)), des pièces gagnées (+${data.coinsEarnedToday} pièces) et du temps consacré aux rendez-vous d'agenda.
2. **Triage des Tâches Restantes** : Suggestions concrètes et réalistes pour les tâches non terminées (replanification ou délestage).
${taskSyntaxDesc}
3. **Organisation de la Boîte de Réception** :
   - Si des notes sont dans l'Inbox, suggère simplement où les classer (\`01 - Projets/\`, \`03 - Contacts/\`).
4. **Structure de la Revue** :
   - **Bilan de la Journée** (Avancées, tâches accomplies et rendez-vous tenus)
   - **Triage des Tâches Restantes** (Recommandations et replanifications pour demain)
   - **Organisation de l'Inbox & Mot de Clôture** (Classement fluide et mot de transition vers la soirée)`;

		const userMessage = `Voici le bilan de mon coffre pour ce ${data.formattedDate} :

${calendarSectionText}
TACHES TERMINEES AUJOURD'HUI (${data.completedTodayTasks.length}) :
${completedText}
Pieces gagnees aujourd'hui : +${data.coinsEarnedToday} pieces

TACHES PREVUES NON TERMINEES (${data.unfinishedTodayTasks.length}) :
${unfinishedText}

AUTRES TACHES EN RETARD (${data.overdueTasks.length}) :
${overdueText}

NOTES EN BOITE DE RECEPTION (${data.inboxNotes.length}) :
${inboxText}
${dailyNoteSnippet}
Dresse le bilan de ma journée et aide-moi à libérer mon esprit pour ce soir. N'utilise aucun émoji dans ta réponse textuelle (sauf si la syntaxe des tâches configurée l'exige).`;

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
		const sectionHeader = '## 🌙 Revue du Soir & Bilan';
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

		if (plugin?.pluginData && typeof plugin.savePluginData === 'function') {
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
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowStr = tomorrow.toISOString().split('T')[0];

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
