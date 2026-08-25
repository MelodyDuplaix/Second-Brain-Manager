import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { ActionProposal, UpdateTaskActionProposal, TaskDiffMetadata } from '../models/actions';
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
	 * Génère un ensemble varié et intelligent de propositions d'allègement avec métadonnées exhaustives
	 * (reports, rétrogradations de quadrant, priorisations, annulations, allègements d'échéances et d'énergie).
	 */
	public static generateDefaultLighteningProposals(data: RecoveryVaultData, plugin?: SecondBrainPlugin): ActionProposal[] {
		const proposals: ActionProposal[] = [];
		const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

		const matrixAdapter = plugin 
			? MatrixAdapterFactory.createAdapter(plugin.settings.matrixProvider, plugin.settings.customMatrixMapping)
			: MatrixAdapterFactory.createAdapter('task-matrix');

		data.overdueTasks.forEach((task, idx) => {
			const isVeryStale = task.dueDate && task.dueDate <= fourteenDaysAgo;
			const isMeetingOrCall = /réunion|rdv|rendez-vous|call|point\s/i.test(task.title);
			const currentQ = matrixAdapter.getQuadrant(task);

			if (isVeryStale || isMeetingOrCall) {
				// 1. Annulation des tâches obsolètes
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

			} else if (currentQ === 'q1' && task.dueDate && task.dueDate <= sevenDaysAgo) {
				// 2. Rétrogradation de quadrant (Q1 -> Q2 ou Q3) pour soulager la reprise
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

			} else if (currentQ === 'q4' || (task.energy !== undefined && task.energy >= 8 && task.dueDate && task.dueDate < data.dateStr)) {
				// 3. Délestage d'échéance ou allègement d'énergie
				const diff: TaskDiffMetadata = {
					taskTitle: task.title,
					filePath: task.filePath,
					lineNumber: task.lineNumber,
					oldDueDate: task.dueDate,
					newDueDate: null,
					oldQuadrant: currentQ,
					newQuadrant: currentQ,
					oldEnergy: task.energy,
					newEnergy: task.energy ? Math.min(task.energy, 4) : undefined,
					reason: 'Suppression de l\'échéance pour enlever la pression temporelle et ajustement d\'énergie'
				};

				proposals.push({
					id: `recovery-lighten-${idx}-${Date.now()}`,
					type: 'update_task',
					targetPath: task.filePath,
					lineNumber: task.lineNumber,
					taskTitle: task.title,
					description: `🧹 Délester l'échéance : "${task.title}"`,
					selected: true,
					newDueDate: null,
					newEnergy: diff.newEnergy,
					diff,
					reason: diff.reason
				} as UpdateTaskActionProposal);

			} else {
				// 4. Report de date normal à aujourd'hui
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

		return proposals;
	}

	/**
	 * Extrait les propositions d'actions JSON retournées par l'IA et les enrichit avec les métadonnées de tâche.
	 */
	public static extractProposalsFromResponse(
		responseText: string,
		defaultProposals: ActionProposal[],
		vaultTasks: ObsidianTask[] = []
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
					.map((p, index) => {
						const targetPath = String(p.targetPath);
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

						return {
							id: p.id || `recovery-ai-${index}-${Date.now()}`,
							type: p.type,
							targetPath,
							lineNumber: lineNum,
							taskTitle,
							description: p.description || `Action sur ${taskTitle}`,
							selected: p.selected !== false,
							newStatus: p.newStatus,
							newDueDate: p.newDueDate,
							newStartDate: p.newStartDate,
							newPriority: p.newPriority,
							newEnergy: p.newEnergy,
							newMatrixQuadrant: p.newMatrixQuadrant,
							diff,
							reason
						} as ActionProposal;
					});

				if (validatedProposals.length > 0) {
					return {
						cleanText,
						proposals: validatedProposals
					};
				}
			}
		} catch {
			// En cas d'erreur de parsing, repli sur defaultProposals
		}

		return {
			cleanText,
			proposals: defaultProposals
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour un réembarquement doux et un allègement complet.
	 */
	public static buildRecoveryMessages(data: RecoveryVaultData): ChatMessage[] {
		const formatTaskDetailed = (t: ObsidianTask): string => {
			let line = `- [ ] ${t.title}`;
			if (t.dueDate) line += ` 📅 ${t.dueDate}`;
			if (t.scheduledDate) line += ` ⏳ ${t.scheduledDate}`;
			if (t.matrixTag) line += ` ${t.matrixTag}`;
			if (t.priority) line += ` (Priorité: ${t.priority})`;
			if (t.energy) line += ` #energie/${t.energy}`;
			const noteBasename = t.filePath.replace(/\.md$/, '').split('/').pop();
			if (noteBasename) line += ` [[${noteBasename}]]`;
			line += ` [Fichier: "${t.filePath}", Ligne: ${t.lineNumber}]`;
			return line;
		};

		const oneThingText = data.oneThingTask
			? formatTaskDetailed(data.oneThingTask)
			: 'Aucune tâche majeure détectée.';

		const quickWinsText = data.quickWinTasks.length > 0
			? data.quickWinTasks.map(formatTaskDetailed).join('\n')
			: 'Aucune tâche rapide identifiée.';

		const overdueText = data.overdueTasks.length > 0
			? data.overdueTasks.slice(0, 12).map(formatTaskDetailed).join('\n')
			: 'Aucune urgence en retard.';

		const staleText = data.staleTasks.length > 0
			? data.staleTasks.slice(0, 10).map(formatTaskDetailed).join('\n')
			: 'Aucune tâche ancienne en souffrance.';

		const inboxText = data.inboxNotes.length > 0
			? data.inboxNotes.map(n => `- [[${n}]]`).join('\n')
			: 'Inbox vide.';

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en reprise sereine après pause (Soft Landing) et allègement radical de charge mentale.

TON OBJECTIF :
Accueillir chaleureusement l'utilisateur (${data.inactivityText}), dresser un bilan déculpabilisant, et proposer un **véritable plan de tri et d'allègement de toutes ses tâches en souffrance**.

VARIÉTÉ D'ACTIONS À PROPOSER DANS LE PLAN :
Ne te limite pas à de simples reports de dates. Propose une combinaison intelligente et adaptée :
1. 🔽 **Rétrogradation de quadrant / priorité** (ex: passer de Q1 à Q2 ou Q3 des tâches qui ne sont pas de véritables urgences pour alléger la pression).
2. 🔺 **Priorisation / Promotion** (ex: passer en Q1 une urgence vitale).
3. ⏩ **Report de date** (décaler à aujourd'hui ${data.dateStr} les tâches encore d'actualité).
4. ❌ **Annulation / Obsolescence** (passer en \`newStatus: "cancelled"\` les réunions ou tâches périmées depuis longtemps).
5. 🧹 **Délestage d'échéances** (mettre \`newDueDate: null\` pour retirer la pression temporelle sur les tâches de fond).
6. ⚡ **Ajustement d'énergie** (réduire l'énergie estimée pour faciliter le passage à l'action).

STRUCTURE DE TA RÉPONSE :
1. **☕ Accueil & Philosophie de reprise** (2 phrases déculpabilisantes).
2. **🚀 Étape 1 : Le Quick Win pour amorcer le mouvement** (1 tâche ultra-simple de 5 min au format \`- [ ] ... [[Note]]\`).
3. **🎯 Étape 2 : The One Thing** (La seule tâche prioritaire et stratégique du jour au format \`- [ ] ... [[Note]]\`).
4. **🧹 Étape 3 : Plan d'Allègement & Tri Détaillé** :
   - Explique et justifie les rétrogradations, annulations et reports proposés.
5. **🌱 Conseil de démarrage** (1 phrase motivante).

BLOC D'ACTIONS STRUCTURÉES (OBLIGATOIRE À LA FIN DU MESSAGE) :
À la toute fin de ton message, inclus un bloc de code JSON strictement balisé \`\`\`json:actions ... \`\`\` contenant le tableau des propositions d'actions :
\`\`\`json:actions
[
  {
    "type": "update_task",
    "targetPath": "01 - Projets/Acme.md",
    "lineNumber": 12,
    "taskTitle": "Rédiger le rapport",
    "description": "🔽 Rétrograder en Q2 et replanifier : Rédiger le rapport",
    "newMatrixQuadrant": "q2",
    "newDueDate": "${data.dateStr}",
    "reason": "Tâche non urgente, rétrogradée pour soulager la reprise"
  },
  {
    "type": "update_task",
    "targetPath": "02 - Domaines/Maison.md",
    "lineNumber": 5,
    "taskTitle": "Réunion du 10 août",
    "description": "❌ Marquer comme obsolète / annulée",
    "newStatus": "cancelled",
    "reason": "Réunion passée non pertinente"
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

Prépare-moi un plan de reprise complet avec un vrai tri et allègement des tâches (rétrogradations, annulations, reports, délestages), accompagné du bloc d'actions \`\`\`json:actions\`\`\` pour que je puisse tout appliquer en 1 clic.`;

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

		// Lecture de toutes les tâches pour enrichissement
		const files = app.vault.getMarkdownFiles();
		const vaultTasks: ObsidianTask[] = [];
		for (const file of files) {
			const content = await app.vault.read(file);
			vaultTasks.push(...TaskParser.parseFile(content, file.path, plugin.settings));
		}

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

		const { cleanText, proposals } = this.extractProposalsFromResponse(rawGeneratedText, defaultProposals, vaultTasks);

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
