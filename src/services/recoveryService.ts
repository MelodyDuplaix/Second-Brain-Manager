import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { ActionProposal, UpdateTaskActionProposal } from '../models/actions';
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
	 * Génère automatiquement des propositions structurées d'allègement et de triage
	 * (décalage à aujourd'hui, annulation des tâches obsolètes, suppression d'échéances non prioritaires).
	 */
	public static generateDefaultLighteningProposals(data: RecoveryVaultData): ActionProposal[] {
		const proposals: ActionProposal[] = [];
		const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

		data.overdueTasks.forEach((task, idx) => {
			const isVeryStale = task.dueDate && task.dueDate <= fourteenDaysAgo;
			const isMeeting = /réunion|rdv|rendez-vous|call|point\s/i.test(task.title);

			if (isVeryStale || isMeeting) {
				// Proposition 1 : Annulation / Archivage des tâches obsolètes
				const prop: UpdateTaskActionProposal = {
					id: `recovery-cancel-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					description: `❌ Marquer comme obsolète / annulée : "${task.title}" (${task.filePath})`,
					selected: true,
					newStatus: 'cancelled'
				};
				proposals.push(prop);
			} else if (task.dueDate && task.dueDate < data.dateStr) {
				// Proposition 2 : Report des retards récents à aujourd'hui
				const prop: UpdateTaskActionProposal = {
					id: `recovery-postpone-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					description: `⏩ Reporter à aujourd'hui (${data.dateStr}) : "${task.title}"`,
					selected: true,
					newDueDate: data.dateStr
				};
				proposals.push(prop);
			}
		});

		return proposals;
	}

	/**
	 * Extrait les propositions d'actions JSON retournées par l'IA et nettoie le texte affiché.
	 */
	public static extractProposalsFromResponse(
		responseText: string,
		defaultProposals: ActionProposal[]
	): { cleanText: string; proposals: ActionProposal[] } {
		const jsonMatch = responseText.match(/```(?:json:actions|actions|json)\s*([\s\S]*?)```/);

		if (!jsonMatch) {
			return {
				cleanText: responseText.trim(),
				proposals: defaultProposals
			};
		}

		const rawJson = jsonMatch[1].trim();
		const cleanText = responseText.replace(jsonMatch[0], '').trim();

		try {
			const parsed = JSON.parse(rawJson);
			if (Array.isArray(parsed) && parsed.length > 0) {
				const validatedProposals: ActionProposal[] = parsed
					.filter(p => p && typeof p === 'object' && p.type && p.targetPath)
					.map((p, index) => ({
						id: p.id || `recovery-ai-${index}-${Date.now()}`,
						type: p.type,
						targetPath: p.targetPath,
						lineNumber: Number(p.lineNumber || 1),
						description: p.description || `Action sur ${p.targetPath}`,
						selected: p.selected !== false,
						newStatus: p.newStatus,
						newDueDate: p.newDueDate,
						newStartDate: p.newStartDate,
						newPriority: p.newPriority,
						newEnergy: p.newEnergy,
						newMatrixQuadrant: p.newMatrixQuadrant
					} as ActionProposal));

				if (validatedProposals.length > 0) {
					return {
						cleanText,
						proposals: validatedProposals
					};
				}
			}
		} catch {
			// En cas d'erreur de parsing JSON, on conserve les propositions par défaut
		}

		return {
			cleanText,
			proposals: defaultProposals
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour un réembarquement doux et un allègement structuré.
	 */
	public static buildRecoveryMessages(data: RecoveryVaultData): ChatMessage[] {
		const formatTaskDetailed = (t: ObsidianTask): string => {
			let line = `- [ ] ${t.title}`;
			if (t.dueDate) line += ` 📅 ${t.dueDate}`;
			if (t.scheduledDate) line += ` ⏳ ${t.scheduledDate}`;
			if (t.matrixTag) line += ` ${t.matrixTag}`;
			if (t.energy) line += ` #energie/${t.energy}`;
			const noteBasename = t.filePath.replace(/\.md$/, '').split('/').pop();
			if (noteBasename) line += ` [[${noteBasename}]]`;
			line += ` (Fichier: "${t.filePath}", Ligne: ${t.lineNumber})`;
			return line;
		};

		const oneThingText = data.oneThingTask
			? formatTaskDetailed(data.oneThingTask)
			: 'Aucune tâche majeure détectée.';

		const quickWinsText = data.quickWinTasks.length > 0
			? data.quickWinTasks.map(formatTaskDetailed).join('\n')
			: 'Aucune tâche rapide identifiée.';

		const overdueText = data.overdueTasks.length > 0
			? data.overdueTasks.slice(0, 10).map(formatTaskDetailed).join('\n')
			: 'Aucune urgence en retard.';

		const staleText = data.staleTasks.length > 0
			? data.staleTasks.slice(0, 8).map(formatTaskDetailed).join('\n')
			: 'Aucune tâche ancienne en souffrance.';

		const inboxText = data.inboxNotes.length > 0
			? data.inboxNotes.map(n => `- [[${n}]]`).join('\n')
			: 'Inbox vide.';

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en reprise sereine après pause (Soft Landing) et délestage d'esprit.

TON OBJECTIF :
Accueillir chaleureusement l'utilisateur (${data.inactivityText}), établir un bilan de reprise sans culpabilité, et proposer un **véritable plan de tri et d'allègement de ses tâches en souffrance**.

STRUCTURE DE TA RÉPONSE :
1. **☕ Accueil & Philosophie de reprise** (2 phrases déculpabilisantes).
2. **🚀 Étape 1 : Le Quick Win pour amorcer le mouvement** (1 tâche ultra-simple de 5 min au format \`- [ ] ... [[Note]]\`).
3. **🎯 Étape 2 : The One Thing** (La seule tâche prioritaire et stratégique du jour au format \`- [ ] ... [[Note]]\`).
4. **🧹 Étape 3 : Plan d'Allègement & Tri des tâches** :
   - Explique clairement quelles tâches sont décalées à aujourd'hui (${data.dateStr}), quelles tâches périmées/obsolètes doivent être annulées/abandonnées, et quelles tâches doivent être délestées de leur échéance.
5. **🌱 Conseil de démarrage** (1 phrase motivante).

BLOC D'ACTIONS STRUCTURÉES (OBLIGATOIRE À LA FIN DU MESSAGE) :
À la toute fin de ton message, inclus un bloc de code JSON strictement balisé \`\`\`json:actions ... \`\`\` contenant le tableau des propositions d'actions pour que l'utilisateur puisse appliquer toutes les modifications en 1 clic :
\`\`\`json:actions
[
  {
    "type": "update_task",
    "targetPath": "chemin/vers/fichier.md",
    "lineNumber": 12,
    "description": "⏩ Reporter à aujourd'hui : Titre de la tâche",
    "newDueDate": "${data.dateStr}"
  },
  {
    "type": "update_task",
    "targetPath": "chemin/vers/fichier.md",
    "lineNumber": 5,
    "description": "❌ Marquer comme obsolète / annulée : Titre",
    "newStatus": "cancelled"
  }
]
\`\`\`
Utilise les chemins exacts et numéros de ligne fournis.`;

		const userPrompt = `Voici la situation actuelle de mon coffre pour ma reprise (${data.inactivityText}, Date du jour : ${data.dateStr}, Énergie : ${data.energy}/10) :

🌟 TÂCHE MAJEURE DÉTECTÉE (THE ONE THING) :
${oneThingText}

⚡ QUICK WINS DISPONIBLES :
${quickWinsText}

⏰ TÂCHES EN RETARD (${data.overdueTasks.length} au total) :
${overdueText}

⏳ TÂCHES EN SOUFFRANCE (> 7 jours de retard, ${data.staleTasks.length} au total) :
${staleText}

📥 BOÎTE DE RÉCEPTION (INBOX) :
${inboxText}

Prépare-moi un plan de reprise complet avec un vrai tri et allègement des tâches, accompagné du bloc d'actions \`\`\`json:actions\`\`\` pour que je puisse tout appliquer en 1 clic.`;

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
		const messages = this.buildRecoveryMessages(data);
		const defaultProposals = this.generateDefaultLighteningProposals(data);

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

		const { cleanText, proposals } = this.extractProposalsFromResponse(rawGeneratedText, defaultProposals);

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
		recoveryMarkdown: string,
		dateStr?: string
	): Promise<string> {
		const today = dateStr || new Date().toISOString().split('T')[0];
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
			const folder = (typeof app.vault.getFolderByPath === 'function' ? app.vault.getFolderByPath(dailyFolder) : null) || app.vault.getAbstractFileByPath(dailyFolder);
			if (!folder) {
				await app.vault.createFolder(dailyFolder);
			}
			const initialContent = `# ${today}\n\n${sectionContent}`;
			await app.vault.create(dailyPath, initialContent);
		}

		return dailyPath;
	}
}
