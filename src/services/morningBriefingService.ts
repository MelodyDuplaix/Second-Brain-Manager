import { App, normalizePath, TFile } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
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
	overdueTasks: ObsidianTask[];
	todayTasks: ObsidianTask[];
	priorityTasks: ObsidianTask[];
	inboxTasks: ObsidianTask[];
	projects: string[];
	contacts: string[];
	dailyNoteContent?: string;
}

export class MorningBriefingService {
	/**
	 * Récupère et structure l'ensemble des données du coffre nécessaires pour le briefing.
	 */
	public static async collectBriefingData(app: App, plugin: SecondBrainPlugin): Promise<BriefingVaultData> {
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
			overdueTasks,
			todayTasks,
			priorityTasks,
			inboxTasks,
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

		let dailyNoteSnippet = '';
		if (data.dailyNoteContent) {
			dailyNoteSnippet = `\nContenu actuel de la note quotidienne du jour (${data.dateStr}) :\n${data.dailyNoteContent.slice(0, 1500)}\n`;
		}

		const systemPrompt = `Tu es l'assistant et copilote personnel "Second Brain Manager", expert en productivité bienveillante, méthodologie GTD et matrice d'Eisenhower.

TON OBJECTIF :
Fournir un **Briefing du Matin clair, motivant, ultra-structuré et sur-mesure** pour organiser la journée de l'utilisateur en respectant scrupuleusement son niveau d'énergie.

CONSIGNES STRICTES DE RÉDACTION :
1. **Ton & Posture** : Chaleureux, constructif, direct et rassurant. Pas de bavardage inutile ni de méta-commentaire.
2. **Adaptation au Niveau d'Énergie (${data.energy}/10 - ${data.modeText})** :
   - Si Énergie 1-3 (Mode Économie) : Protège l'utilisateur ! Recommande **1 seule tâche essentielle maximum** et propose de délester ou reporter le reste sans culpabiliser.
   - Si Énergie 4-7 (Mode Équilibré) : 1 grande tâche Q1 le matin + 2 ou 3 tâches secondaires Q2 l'après-midi.
   - Si Énergie 8-10 (Plein Potentiel) : Focus sur les chantiers complexes, les créations de fond et les projets prioritaires.
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
		onChunk: (chunk: string, fullText: string) => void
	): Promise<{ text: string; data: BriefingVaultData; allTasks: ObsidianTask[] }> {
		const data = await this.collectBriefingData(app, plugin);
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
			...data.inboxTasks
		];

		return {
			text: generatedText,
			data,
			allTasks
		};
	}
}
