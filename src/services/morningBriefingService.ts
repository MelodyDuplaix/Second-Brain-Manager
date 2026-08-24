import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { MatrixAdapterFactory } from '../adapters/matrixAdapter';
import { LLMService } from './llmService';
import { LLMConfig, ChatMessage } from '../models/llm';
import { VaultContextService } from './vaultContextService';
import SecondBrainPlugin from '../main';

export interface BriefingVaultData {
	dateStr: string;
	formattedDate: string;
	energy: number;
	modeText: string;
	focusProject?: string;
	overdueTasks: ObsidianTask[];
	todayTasks: ObsidianTask[];
	priorityTasks: ObsidianTask[];
	inboxTasks: ObsidianTask[];
	projectTasks: ObsidianTask[];
	projects: string[];
	contacts: string[];
	dailyNoteContent?: string;
}

export class MorningBriefingService {
	/**
	 * Récupère et structure l'ensemble des données du coffre nécessaires pour le briefing.
	 */
	public static async collectBriefingData(
		app: App,
		plugin: SecondBrainPlugin,
		focusProject?: string
	): Promise<BriefingVaultData> {
		const today = new Date();
		const dateStr = today.toISOString().split('T')[0];

		// Formatage de la date en français (ex: "Lundi 24 Août 2026")
		const formattedDate = today.toLocaleDateString('fr-FR', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		const capitalizedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

		const energy = plugin.settings.energyLevel;
		const modeText = energy <= 3
			? 'Mode Économie (Faible énergie - priorité à la préservation et au délestage)'
			: energy <= 7
				? 'Mode Équilibré (Énergie moyenne - focus sur 1 tâche majeure et 2-3 secondaires)'
				: 'Mode Plein Potentiel (Haute énergie - idéal pour les chantiers complexes et créatifs)';

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

		// Classification
		const overdueTasks = allOpenTasks.filter(t => t.dueDate && t.dueDate < dateStr);
		const todayTasks = allOpenTasks.filter(t =>
			t.dueDate === dateStr ||
			t.scheduledDate === dateStr ||
			(t.startDate && t.startDate <= dateStr)
		);
		const inboxFolder = plugin.settings.inboxFolder;
		const inboxTasks = allOpenTasks.filter(t => t.filePath.startsWith(inboxFolder));

		const priorityTasks = allOpenTasks.filter(t => {
			const q = matrixAdapter.getQuadrant(t);
			return q === 'q1' || q === 'q2' || (t.priority && (t.priority === 'highest' || t.priority === 'high'));
		});

		// Tâches spécifiques au projet focus si sélectionné
		const projectTasks = focusProject
			? allOpenTasks.filter(t =>
				t.filePath.toLowerCase().includes(focusProject.toLowerCase()) ||
				t.title.toLowerCase().includes(focusProject.toLowerCase()) ||
				t.tags.some(tag => tag.toLowerCase().includes(focusProject.toLowerCase()))
			)
			: [];

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
			energy,
			modeText,
			focusProject: focusProject && focusProject !== 'all' ? focusProject : undefined,
			overdueTasks,
			todayTasks,
			priorityTasks,
			inboxTasks,
			projectTasks,
			projects: structure.projects,
			contacts: structure.contacts,
			dailyNoteContent
		};
	}

	/**
	 * Construit le prompt système et utilisateur optimisé pour un briefing percutant.
	 */
	public static buildBriefingMessages(data: BriefingVaultData): ChatMessage[] {
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

		const overdueText = data.overdueTasks.length > 0
			? data.overdueTasks.map(formatTaskLine).join('\n')
			: 'Aucune tâche en retard.';

		const todayText = data.todayTasks.length > 0
			? data.todayTasks.map(formatTaskLine).join('\n')
			: 'Aucune tâche expressément planifiée pour aujourd\'hui.';

		const priorityText = data.priorityTasks.length > 0
			? data.priorityTasks.slice(0, 8).map(formatTaskLine).join('\n')
			: 'Aucune tâche Q1/Q2 prioritaire.';

		const inboxText = data.inboxTasks.length > 0
			? data.inboxTasks.slice(0, 5).map(formatTaskLine).join('\n')
			: 'Aucun élément en boîte de réception.';

		let focusProjectText = '';
		if (data.focusProject) {
			const tasksForProject = data.projectTasks.length > 0
				? data.projectTasks.map(formatTaskLine).join('\n')
				: `Aucune tâche explicite trouvée pour ${data.focusProject}.`;
			focusProjectText = `\n🎯 PROJET PRIORITAIRE DU JOUR DÉSIGNÉ PAR L'UTILISATEUR : "[[${data.focusProject}]]"\n` +
				`TÂCHES LIÉES À CE PROJET :\n${tasksForProject}\n`;
		}

		let dailyNoteSnippet = '';
		if (data.dailyNoteContent) {
			dailyNoteSnippet = `\nContenu actuel de la note quotidienne du jour (${data.dateStr}) :\n${data.dailyNoteContent.slice(0, 1500)}\n`;
		}

		let focusDirectives = '';
		if (data.focusProject) {
			focusDirectives = `\n- **Projet Focus Majeur** : L'utilisateur a explicitement demandé de focaliser sa journée sur "[[${data.focusProject}]]". Fais de ce projet le cœur de ton Cap du Jour et privilégie ses tâches dans le plan de journée.`;
		}

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en productivité bienveillante, méthodologie GTD et matrice d'Eisenhower.

TON OBJECTIF :
Fournir un **Briefing du Matin clair, motivant, ultra-structuré et sur-mesure** pour organiser la journée de l'utilisateur en respectant scrupuleusement son niveau d'énergie.

CONSIGNES STRICTES DE RÉDACTION :
1. **Ton & Posture** : Chaleureux, constructif, direct et rassurant. Pas de bavardage inutile ni de méta-commentaire.
2. **Adaptation au Niveau d'Énergie (${data.energy}/10 - ${data.modeText})** :
   - Si Énergie 1-3 (Mode Économie) : Protège l'utilisateur ! Recommande **1 seule tâche essentielle maximum** et propose de délester ou reporter le reste sans culpabiliser.
   - Si Énergie 4-7 (Mode Équilibré) : 1 grande tâche Q1 le matin + 2 ou 3 tâches secondaires Q2 l'après-midi.
   - Si Énergie 8-10 (Plein Potentiel) : Focus sur les chantiers complexes, les créations de fond et les projets prioritaires.${focusDirectives}
3. **Format des Tâches Recommandées** :
   - Écris TOUTES les tâches au format Obsidian Tasks standard : \`- [ ] Titre de la tâche 📅 YYYY-MM-DD #tm/qN [[LienNote]]\`
   - Conserve les wikilinks vers les notes sources (ex: \`[[Acme Project]]\`, \`[[Maison]]\`).
   - N'entoure JAMAIS les wikilinks de backticks (\`[[...]]\`).
4. **Structure du Briefing** :
   - 🌅 **Cap du Jour** (Le focus ou projet n°1 incontournable)
   - ⚡ **Plan de Journée Recommandé** (Les tâches sélectionnées et ordonnées selon l'énergie)
   - ⏰ **Alertes & Points d'Attention** (Urgences réelles ou tâches en souffrance à traiter ou reporter)
   - 💡 **Conseil d'Énergie & Rythme** (Un conseil pratique pour optimiser la journée sans stress)`;

		const userMessage = `Voici l'état actuel de mon coffre pour ce ${data.formattedDate} :

Niveau d'énergie : ${data.energy}/10 (${data.modeText})
Projets actifs : ${data.projects.join(', ') || 'Aucun'}
Contacts récents : ${data.contacts.join(', ') || 'Aucun'}
${focusProjectText}
TÂCHES EN RETARD :
${overdueText}

TÂCHES PLANIFIÉES POUR AUJOURD'HUI :
${todayText}

TÂCHES PRIORITAIRES (Q1 / Q2) :
${priorityText}

TÂCHES EN BOÎTE DE RÉCEPTION (INBOX) :
${inboxText}
${dailyNoteSnippet}
Propose-moi mon briefing et mon plan d'action optimisé pour aujourd'hui.`;

		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userMessage }
		];
	}

	/**
	 * Exécute la génération du briefing en streaming.
	 */
	public static async generateBriefing(
		app: App,
		plugin: SecondBrainPlugin,
		signal: AbortSignal,
		onChunk: (chunk: string, fullText: string) => void,
		focusProject?: string
	): Promise<{ text: string; data: BriefingVaultData; allTasks: ObsidianTask[] }> {
		const data = await this.collectBriefingData(app, plugin, focusProject);
		const messages = this.buildBriefingMessages(data);

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
			...data.overdueTasks,
			...data.todayTasks,
			...data.priorityTasks,
			...data.inboxTasks,
			...data.projectTasks
		];

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
		const folderPath = normalizePath(plugin.settings.dailyNotesFolder);
		const filePath = normalizePath(`${folderPath}/${dateStr}.md`);

		// Création du dossier si nécessaire
		const folder = app.vault.getFolderByPath(folderPath);
		if (!folder) {
			await app.vault.createFolder(folderPath);
		}

		const cleanText = briefingText.replace(/`(\[\[[^`\]]+\]\])`/g, '$1').trim();
		const sectionHeader = '## 🌅 Briefing & Focus du Jour';
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
			return filePath;
		}
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
