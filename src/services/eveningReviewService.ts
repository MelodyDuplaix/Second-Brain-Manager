import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { DailyNoteFormatter } from './dailyNoteFormatter';
import { VaultContextService } from './vaultContextService';
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
		const structure = vaultContext.getVaultStructure();

		// Lecture de toutes les tâches du coffre
		const files = app.vault.getMarkdownFiles();
		const completedTodayTasks: ObsidianTask[] = [];
		const unfinishedTodayTasks: ObsidianTask[] = [];
		const overdueTasks: ObsidianTask[] = [];

		for (const file of files) {
			const content = await app.vault.read(file);
			const tasks = TaskParser.parseFile(content, file.path, plugin.settings);

			for (const t of tasks) {
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

		// Fichiers présents dans la boîte de réception (Inbox)
		const inboxFolder = normalizePath(plugin.settings.inboxFolder);
		const inboxNotes = files
			.filter(f => f.path.startsWith(inboxFolder) && f.basename)
			.map(f => f.basename);

		// Lecture de la note quotidienne du jour si elle existe
		let dailyNoteContent: string | undefined;
		const dailyPath = normalizePath(`${plugin.settings.dailyNotesFolder}/${dateStr}.md`);
		const dailyFile = app.vault.getFileByPath(dailyPath) || app.vault.getAbstractFileByPath(dailyPath);
		if (dailyFile instanceof TFile) {
			dailyNoteContent = await app.vault.read(dailyFile);
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
			dailyNoteContent
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour la revue du soir.
	 */
	public static buildEveningMessages(data: EveningVaultData): ChatMessage[] {
		const formatTaskLine = (t: ObsidianTask): string => {
			let line = `- [${t.completed ? 'x' : ' '}] ${t.title}`;
			if (t.dueDate) line += ` 📅 ${t.dueDate}`;
			if (t.scheduledDate) line += ` ⏳ ${t.scheduledDate}`;
			if (t.matrixTag) line += ` ${t.matrixTag}`;
			if (t.energy) line += ` #energie/${t.energy}`;
			if (t.pieces) line += ` #pieces/${t.pieces}`;
			const noteBasename = t.filePath.replace(/\.md$/, '').split('/').pop();
			if (noteBasename) line += ` [[${noteBasename}]]`;
			return line;
		};

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

		let dailyNoteSnippet = '';
		if (data.dailyNoteContent) {
			dailyNoteSnippet = `\nContenu actuel de la note quotidienne du jour (${data.dateStr}) :\n${data.dailyNoteContent.slice(0, 1500)}\n`;
		}

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en productivité bienveillante, méthodologie GTD et revue sans culpabilité.

TON OBJECTIF :
Fournir une Revue du Soir chaleureuse, déculpabilisante, constructive et apaisante pour aider l'utilisateur à clôturer sa journée, célébrer ses victoires, trier les tâches ouvertes et libérer sa charge mentale avant la soirée.

CONSIGNE DE STYLE STRICTE :
- N'utilise AUCUN émoji dans ta réponse textuelle. Reste sobre, clair, direct et apaisant.

CONSIGNES DE REDACTION :
1. **Ton & Posture** : Bienveillant, positif et valorisant. Ne jamais faire de reproches sur les tâches non terminées. Clôturer la journée dans la sérénité.
2. **Célébration des Victoires** : Valorise les tâches accomplies (${data.completedTodayTasks.length} tâche(s)) et les pièces gagnées (+${data.coinsEarnedToday} pièces).
3. **Triage Clair des Tâches Restantes** :
   - Pour les tâches non terminées, propose des options claires : *Reporter à demain* (\`📅\`), *Découper*, *Changer de quadrant*, ou *Abandonner sans regret* (\`- [-]\`).
   - Format Markdown Tasks standard : \`- [ ] Titre 📅 YYYY-MM-DD #tm/qN [[LienNote]]\` avec wikilinks.
4. **Nettoyage Mental & Inbox** :
   - Si des notes sont dans l'Inbox, suggère brièvement où les classer (\`01 - Projets/\`, \`03 - Contacts/\`).
5. **Structure de la Revue** :
   - **Bilan & Célébration de la Journée** (Ce qui a avancé, récompenses)
   - **Triage des Tâches Restantes** (Recommandations pour demain)
   - **Nettoyage Mental & Boîte de Réception** (Organisation fluide)
   - **Mot de Clôture & Déconnexion** (Conseil bienveillant pour la soirée)`;

		const userMessage = `Voici le bilan de mon coffre pour ce ${data.formattedDate} :

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
Dresse le bilan de ma journée et aide-moi à libérer mon esprit pour ce soir. N'utilise aucun émoji dans ta réponse.`;

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
		const messages = this.buildEveningMessages(data);

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
		const folderPath = normalizePath(plugin.settings.dailyNotesFolder);
		const filePath = normalizePath(`${folderPath}/${dateStr}.md`);

		const folder = app.vault.getFolderByPath(folderPath);
		if (!folder) {
			await app.vault.createFolder(folderPath);
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
			return filePath;
		}
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
