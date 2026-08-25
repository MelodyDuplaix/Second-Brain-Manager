import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { VaultContextService } from './vaultContextService';
import SecondBrainPlugin from '../main';

export interface RecoveryVaultData {
	dateStr: string;
	formattedDate: string;
	inactivityText: string;
	inactivityDays: number;
	quickWinTasks: ObsidianTask[];
	oneThingTask?: ObsidianTask;
	overdueTasks: ObsidianTask[];
	staleTasks: ObsidianTask[];
	inboxNotes: string[];
	projects: string[];
	energy: number;
	dailyNoteContent?: string;
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
		} else if (diffDays >= 1) {
			return { inactivityText: `Reprise après ${diffDays} jour(s) de pause`, inactivityDays: diffDays };
		} else if (diffHours >= 2) {
			return { inactivityText: `Reprise après ${diffHours} heures de pause`, inactivityDays: 0 };
		}

		return { inactivityText: 'Reprise en douceur', inactivityDays: 0 };
	}

	/**
	 * Collecte et structure toutes les données du coffre pour un redémarrage serein sans friction.
	 */
	public static async collectRecoveryData(app: App, plugin: SecondBrainPlugin): Promise<RecoveryVaultData> {
		const today = new Date();
		const dateStr = today.toISOString().split('T')[0];

		const formattedDate = today.toLocaleDateString('fr-FR', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

		const energy = plugin.settings.energyLevel;

		// Calcul de la durée d'inactivité
		let lastActiveTime = plugin.pluginData?.lastActiveSession;
		if (!lastActiveTime && plugin.pluginData?.completionEvents) {
			const timestamps = Object.values(plugin.pluginData.completionEvents)
				.map(e => e.completedAt)
				.filter(Boolean);
			if (timestamps.length > 0) {
				timestamps.sort();
				lastActiveTime = timestamps[timestamps.length - 1];
			}
		}
		const { inactivityText, inactivityDays } = this.calculateInactivity(lastActiveTime);

		const matrixAdapter = MatrixAdapterFactory.createAdapter(
			plugin.settings.matrixProvider,
			plugin.settings.customMatrixMapping
		);

		const vaultContext = new VaultContextService(app, plugin.settings);
		const structure = vaultContext.getVaultStructure();

		// Lecture de toutes les tâches ouvertes du coffre
		const files = app.vault.getMarkdownFiles();
		const allOpenTasks: ObsidianTask[] = [];

		for (const file of files) {
			const content = await app.vault.read(file);
			const tasks = TaskParser.parseFile(content, file.path, plugin.settings);
			const open = tasks.filter(t => !t.completed && t.status !== 'cancelled');
			allOpenTasks.push(...open);
		}

		// Seuil de 7 jours pour identifier les tâches en retard "obsolètes / en souffrance"
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

		const overdueTasks = allOpenTasks.filter(t => t.dueDate && t.dueDate < dateStr);
		const staleTasks = overdueTasks.filter(t => t.dueDate && t.dueDate <= sevenDaysAgo);

		// Identification des Quick Wins (tâches courtes, faciles ou faible énergie)
		const quickWinTasks = allOpenTasks
			.filter(t => {
				const isLowEnergy = t.energy !== undefined && t.energy <= 3;
				const isEasy = t.difficulty && t.difficulty.toLowerCase() === 'facile';
				const isQ3orQ4 = matrixAdapter.getQuadrant(t) === 'q3' || matrixAdapter.getQuadrant(t) === 'q4';
				return isLowEnergy || isEasy || isQ3orQ4;
			})
			.slice(0, 3);

		// Identification de la tâche majeure (The One Thing)
		// Priorité : Tâche Q1 en retard ou prévue aujourd'hui, sinon Q2 haute priorité
		let oneThingTask = allOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' && (t.dueDate === dateStr || (t.dueDate && t.dueDate < dateStr)));
		if (!oneThingTask) {
			oneThingTask = allOpenTasks.find(t => matrixAdapter.getQuadrant(t) === 'q1' || matrixAdapter.getQuadrant(t) === 'q2');
		}
		if (!oneThingTask && overdueTasks.length > 0) {
			oneThingTask = overdueTasks[0];
		}

		// Fichiers dans l'Inbox
		const inboxFolder = normalizePath(plugin.settings.inboxFolder);
		const inboxNotes = files
			.filter(f => f.path.startsWith(inboxFolder) && f.basename)
			.map(f => f.basename);

		// Note quotidienne du jour
		let dailyNoteContent: string | undefined;
		const dailyPath = normalizePath(`${plugin.settings.dailyNotesFolder}/${dateStr}.md`);
		const dailyFile = app.vault.getFileByPath(dailyPath) || app.vault.getAbstractFileByPath(dailyPath);
		if (dailyFile instanceof TFile) {
			dailyNoteContent = await app.vault.read(dailyFile);
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
			inboxNotes,
			projects: structure.projects,
			energy,
			dailyNoteContent
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour un réembarquement doux.
	 */
	public static buildRecoveryMessages(data: RecoveryVaultData): ChatMessage[] {
		const formatTaskLine = (t: ObsidianTask): string => {
			let line = `- [ ] ${t.title}`;
			if (t.dueDate) line += ` 📅 ${t.dueDate}`;
			if (t.scheduledDate) line += ` ⏳ ${t.scheduledDate}`;
			if (t.startDate) line += ` 🛫 ${t.startDate}`;
			if (t.matrixTag) line += ` ${t.matrixTag}`;
			if (t.energy) line += ` #energie/${t.energy}`;
			if (t.pieces) line += ` #pieces/${t.pieces}`;
			const noteBasename = t.filePath.replace(/\.md$/, '').split('/').pop();
			if (noteBasename) line += ` [[${noteBasename}]]`;
			return line;
		};

		const oneThingText = data.oneThingTask
			? formatTaskLine(data.oneThingTask)
			: 'Aucune tâche majeure détectée.';

		const quickWinsText = data.quickWinTasks.length > 0
			? data.quickWinTasks.map(formatTaskLine).join('\n')
			: 'Aucune tâche rapide identifiée.';

		const overdueText = data.overdueTasks.length > 0
			? data.overdueTasks.slice(0, 6).map(formatTaskLine).join('\n')
			: 'Aucune urgence en retard.';

		const staleText = data.staleTasks.length > 0
			? data.staleTasks.slice(0, 5).map(formatTaskLine).join('\n')
			: 'Aucune tâche ancienne en souffrance.';

		const inboxText = data.inboxNotes.length > 0
			? data.inboxNotes.map(n => `- [[${n}]]`).join('\n')
			: 'Inbox vide.';

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en reprise sereine après pause (Soft Landing) et productivité déculpabilisante.

TON OBJECTIF :
Aider l'utilisateur à **reprendre en douceur après une période d'inactivité ou de pause** (${data.inactivityText}), sans aucune surcharge cognitive, sans intimidation et sans culpabilité.

PHILOSOPHIE FONDAMENTALE :
1. **Zéro culpabilité** : Les pauses sont normales et nécessaires. Ne reproche jamais les retards accumulés.
2. **Action immédiate sans friction (Quick Win)** : Proposer d'abord une micro-victoire rapide (5-10 min) pour amorcer le momentum.
3. **Le Cap Unique (The One Thing)** : Isoler 1 SEULE tâche importante pour la journée.
4. **Allègement radical** : Encourager à délester, reporter en masse à demain/plus tard ou éliminer les tâches obsolètes.

STRUCTURE STRICTE DE TA RÉPONSE :
1. **☕ Mot d'accueil chaleureux & bienveillant** (2-3 phrases valorisantes sur le retour).
2. **🚀 Étape 1 : Le Quick Win pour se lancer** (Présenter 1 micro-tâche concrète et simple au format \`- [ ] ... [[Note]]\`).
3. **🎯 Étape 2 : The One Thing (La tâche prioritaire du jour)** (Présenter la seule tâche clé à accomplir au format \`- [ ] ... [[Note]]\`).
4. **🧹 Étape 3 : Triage & Allègement sans stress** :
   - Proposer de reporter en masse les tâches en retard.
   - Mentionner brièvement les ${data.inboxNotes.length} élément(s) en Inbox s'il y en a.
5. **🌱 Conseil de démarrage** : Une phrase courte et motivante pour se mettre en mouvement.

FORMAT DES TÂCHES OBLIGATOIRE :
Toute tâche proposée DOIT être rédigée sur une seule ligne au format Markdown Obsidian Tasks standard avec son lien source :
\`- [ ] Intitulé de la tâche 📅 YYYY-MM-DD #energie/X [[NomDeLaNote]]\`
Ne jamais inventer de fausses tâches si le coffre en contient déjà.`;

		const userPrompt = `Voici la situation actuelle de mon coffre pour ma reprise (${data.inactivityText}, Niveau d'énergie actuel : ${data.energy}/10) :

🌟 TÂCHE MAJEURE DÉTECTÉE (THE ONE THING) :
${oneThingText}

⚡ QUICK WINS DISPONIBLES (TÂCHES LÉGÈRES) :
${quickWinsText}

⏰ TÂCHES EN RETARD (${data.overdueTasks.length} au total) :
${overdueText}

⏳ TÂCHES EN SOUFFRANCE (> 7 jours de retard, ${data.staleTasks.length} au total) :
${staleText}

📥 ÉLÉMENTS EN BOÎTE DE RÉCEPTION (INBOX) :
${inboxText}

Prépare-moi un plan de reprise doux, minimaliste et direct pour redémarrer aujourd'hui sans stress.`;

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		];
	}

	/**
	 * Diffuse la génération du plan de reprise via le service LLM configuré.
	 */
	public static async streamRecovery(
		app: App,
		plugin: SecondBrainPlugin,
		messages: ChatMessage[],
		onChunk: (chunk: string) => void,
		signal?: AbortSignal
	): Promise<string> {
		const llmConfig: LLMConfig = {
			provider: plugin.settings.llmProvider,
			endpoint: plugin.settings.llmEndpoint,
			model: plugin.settings.llmModel,
			geminiSecretId: plugin.settings.geminiSecretId,
			openaiSecretId: plugin.settings.openaiSecretId,
			openrouterSecretId: plugin.settings.openrouterSecretId,
			infomaniakSecretId: plugin.settings.infomaniakSecretId,
			infomaniakProductId: plugin.settings.infomaniakProductId,
		};

		return await LLMService.streamChat(llmConfig, messages, onChunk, signal);
	}

	/**
	 * Reporte en masse une liste de tâches en retard à une date cible (par défaut aujourd'hui).
	 */
	public static async postponeOverdueTasks(
		app: App,
		tasks: ObsidianTask[],
		targetDateStr?: string
	): Promise<number> {
		const today = new Date().toISOString().split('T')[0];
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
	 * Enregistre le plan de reprise dans la note quotidienne du jour.
	 */
	public static async saveRecoveryToDailyNote(
		app: App,
		plugin: SecondBrainPlugin,
		recoveryMarkdown: string
	): Promise<void> {
		const today = new Date().toISOString().split('T')[0];
		const dailyFolder = normalizePath(plugin.settings.dailyNotesFolder);
		const dailyPath = normalizePath(`${dailyFolder}/${today}.md`);

		const file = app.vault.getFileByPath(dailyPath) || app.vault.getAbstractFileByPath(dailyPath);

		const sectionTitle = '## ☕ Reprise en Douceur & Focus';
		const sectionContent = `${sectionTitle}\n\n${recoveryMarkdown.trim()}\n`;

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
			const folder = app.vault.getAbstractFileByPath(dailyFolder);
			if (!folder) {
				await app.vault.createFolder(dailyFolder);
			}
			const initialContent = `# ${today}\n\n${sectionContent}`;
			await app.vault.create(dailyPath, initialContent);
		}
	}
}
