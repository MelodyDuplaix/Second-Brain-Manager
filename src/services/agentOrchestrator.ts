import { App, normalizePath, TFile } from 'obsidian';
import { ChatMessage, LLMConfig } from '../models/llm';
import { LLMService } from './llmService';
import { VaultContextService } from './vaultContextService';
import { ToolRegistry, ToolCallRequest } from './toolRegistry';
import { ActionProposal } from '../models/actions';
import { ObsidianTask } from '../models/task';
import { TaskMutator } from '../mutators/taskMutator';
import { SecondBrainSettings } from '../main';
import { JsonUtils } from '../utils/jsonUtils';

export interface AgentStepEvent {
	type: 'searching' | 'reading' | 'thinking' | 'streaming' | 'done';
	message?: string;
	toolName?: string;
}

export interface AgentResponse {
	text: string;
	actionProposals: ActionProposal[];
	executedTools: string[];
	relevantTasks?: ObsidianTask[];
}

export class AgentOrchestrator {
	private app: App;
	private settings: SecondBrainSettings;
	private vaultContext: VaultContextService;
	private toolRegistry: ToolRegistry;

	constructor(app: App, settings: SecondBrainSettings) {
		this.app = app;
		this.settings = settings;
		this.vaultContext = new VaultContextService(app, settings);
		this.toolRegistry = new ToolRegistry(this.vaultContext, this.settings);
	}

	public getVaultContext(): VaultContextService {
		return this.vaultContext;
	}

	public getToolRegistry(): ToolRegistry {
		return this.toolRegistry;
	}

	/**
	 * Construit le prompt système enrichi avec la date, l'énergie, les projets, contacts et outils.
	 */
	public buildSystemPrompt(
		attachedContextNotes?: Array<{ path: string; title: string; content: string }>,
		activeFile?: TFile | null
	): string {
		const today = new Date().toISOString().split('T')[0];
		const energy = this.settings.energyLevel;
		const structure = this.vaultContext.getVaultStructure();
		const toolDocs = ToolRegistry.getSystemPromptToolDocumentation();

		const filterService = this.vaultContext.getFilterService();

		let activeNoteInfo = '';
		const effectiveActive = activeFile || this.app.workspace?.getActiveFile?.();
		if (effectiveActive instanceof TFile) {
			if (!filterService.isFileExcluded(effectiveActive)) {
				activeNoteInfo = `\n- NOTE ACTUELLEMENT OUVERTE DANS L'ÉDITEUR : "${normalizePath(effectiveActive.path)}" (Titre : "${effectiveActive.basename}")`;
			} else {
				activeNoteInfo = `\n- NOTE ACTUELLEMENT OUVERTE DANS L'ÉDITEUR : [Masquée par les filtres de confidentialité]`;
			}
		}

		let attachedContextText = '';
		const allowedAttached = (attachedContextNotes || []).filter(note =>
			!filterService.isFolderExcluded(note.path) &&
			!filterService.isFileNameExcluded(note.path) &&
			!filterService.isFileNameExcluded(note.title)
		);
		if (allowedAttached.length > 0) {
			attachedContextText = '\n\nDOCUMENTS JOINTS EN CONTEXTE PAR L\'UTILISATEUR :\n';
			allowedAttached.forEach(note => {
				const MAX_CHARS_PER_NOTE = 6000;
				let noteContent = note.content;
				if (noteContent.length > MAX_CHARS_PER_NOTE) {
					noteContent = noteContent.slice(0, MAX_CHARS_PER_NOTE) + '\n... [Contenu tronqué pour optimiser la latence]';
				}
				attachedContextText += `--- Début de la note "${note.title}" (${note.path}) ---\n${noteContent}\n--- Fin de la note ---\n\n`;
			});
		}

		const taskSyntaxDocs = TaskMutator.getTaskSyntaxPromptDescription(this.settings);
		const dailyConfig = this.vaultContext.getDailyNotesConfig();
		const dailyNotesFolder = dailyConfig.folder;
		
		let chosenName = today;
		try {
			if (typeof (this.app as any).moment === 'function' || typeof (window as any).moment === 'function') {
				const momentFn = (this.app as any).moment || (window as any).moment;
				const m = momentFn(today, 'YYYY-MM-DD');
				if (m.isValid() && dailyConfig.format) {
					chosenName = m.format(dailyConfig.format);
				}
			} else {
				const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
				const frDate = isoMatch ? `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}` : today;
				chosenName = (dailyNotesFolder.toLowerCase().includes('quotidienne') || (dailyConfig.format && dailyConfig.format.startsWith('DD'))) ? frDate : today;
			}
		} catch {
			chosenName = today;
		}

		const dailyNoteTodayPath = `${dailyNotesFolder}/${chosenName}.md`;

		let customInstructionsText = '';
		if (this.settings.customPromptInstructions && this.settings.customPromptInstructions.trim()) {
			customInstructionsText = `\n\nINSTRUCTIONS ET CONSIGNES PERSONNALISÉES DE L'UTILISATEUR (À RESPECTER SCRUPULEUSEMENT) :\n${this.settings.customPromptInstructions.trim()}\n`;
		}

		return `Tu es l'assistant personnel intelligent "Second Brain Manager" intégré au coffre Obsidian de l'utilisateur.

CONTEXTE EN TEMPS RÉEL DU COFFRE :
- Date du jour : ${today}
- Note quotidienne du jour (Journal) : "${dailyNoteTodayPath}"
- Dossier Journal (Daily notes) : "${dailyNotesFolder}"
- Dossier Boîte de réception (Inbox) : "${this.settings.inboxFolder}"${activeNoteInfo}
- Niveau d'énergie actuel : ${energy}/10 (${energy <= 3 ? 'Mode Économie' : 'Mode Plein Potentiel'})
- Format des tâches configuré : ${this.settings.taskFormat}
- Format de priorité matrice : ${this.settings.matrixProvider}
- Projets existants : ${structure.projects.slice(0, 20).join(', ') || 'Aucun'}
- Contacts existants : ${structure.contacts.slice(0, 20).join(', ') || 'Aucun'}
- Domaines existants : ${structure.domains.slice(0, 20).join(', ') || 'Aucun'}
- Modèles & Templates disponibles : ${structure.templates?.slice(0, 20).join(', ') || 'Aucun'}${attachedContextText}${customInstructionsText}

COMPORTEMENT & FLUX D'EXÉCUTION (ReAct Loop) :
1. RECHERCHE D'INFORMATIONS :
   - Si la question nécessite des données du coffre (planning du jour, tâches en retard, résumé d'une note, profil d'un contact, emplacement d'un projet), émets d'abord un bloc JSON d'outils de lecture (\`search_vault\`, \`search_tasks\`, \`read_note\`, \`get_note_connections\`, \`list_templates\`, \`read_template\`, \`search_calendar_events\`).
   - Pour toute question relative à l'agenda, au planning, aux rendez-vous ou à la journée :
     -> Appelle TOUJOURS \`search_calendar_events\` SANS spécifier de \`calendarId\` (pour interroger automatiquement TOUS les agendas configurés : principal, secondaires, partagés).
     -> ATTENTION CRITIQUE SUR LES ÉVÉNEMENTS MULTI-JOURS : Tout événement étalé sur plusieurs jours dont la période couvre la date demandée (ex: débuté il y a quelques jours et se terminant aujourd'hui ou plus tard) est un événement TOTALEMENT EN COURS ET ACTIF aujourd'hui ! Il ne faut JAMAIS le considérer comme passé sous prétexte que sa date de début est antérieure à aujourd'hui.

2. CONSULTATION VS MODIFICATION (RÈGLE IMPORTANTE) :
   - Pour les demandes d'information ou de planning (ex: "Quel est mon planning ?", "Qu'est-ce qui est en retard ?", "Résume mes priorités") :
      -> Réponds de façon claire, courtoise, structurée et professionnelle en Markdown.
      -> Présente les tâches en respectant scrupuleusement le format configuré :
${taskSyntaxDocs}
     -> NE PROPOSE PAS de modifications/créations d'actions (\`propose_create_task\`, \`propose_update_task\`) SAUF si l'utilisateur a explicitement demandé de modifier, replanifier ou créer.
   - Ne génère des propositions d'actions d'écriture (\`propose_create_note\`, \`propose_create_task\`, \`propose_update_task\`, \`propose_decompose_task\`, \`propose_link_notes\`) QUE si :
     a) L'utilisateur le demande expressément (ex: "Reporte ces tâches", "Crée la tâche X", "Rajoute à faire...", "Décompose la tâche Y").
     b) L'utilisateur relate une réunion / prise de note avec des actions et personnes concrètes à enregistrer.

3. RÈGLE CRITIQUE SUR LA NOTE QUOTIDIENNE / JOURNAL :
   - Si l'utilisateur demande d'ajouter, noter ou planifier quelque chose dans sa "note quotidienne", son "journal", pour "aujourd'hui" ou sans note cible explicite :
     -> Utilise TOUJOURS le chemin "${dailyNoteTodayPath}" comme \`filePath\` ou \`targetPath\`.

4. RÈGLE CRITIQUE SUR LE CHEMIN DES NOTES & LA CRÉATION DE TÂCHES :
   - Si la note cible est la note actuellement ouverte ou que l'utilisateur dit "dans cette note", "ici", ou nomme la note ouverte :
     -> Utilise TOUJOURS le chemin canonique de la note ouverte (ex: "${effectiveActive instanceof TFile ? normalizePath(effectiveActive.path) : ''}") comme \`filePath\`.
   - Si l'utilisateur nomme un projet ou une note existante du coffre :
     -> Utilise le chemin complet retourné par les recherches (ex: "Note rangés/MFRB/Tâche à faire MFRB.md" ou "01 - Projets/Second Brain.md") ou le nom exact de la note.
   - Si l'utilisateur demande de créer ou d'ajouter une ou plusieurs tâches (ex: "Rajoute à faire...", "Crée la tâche...", "Ajoute dans le projet X : faire Y") :
     -> Appelle TOUJOURS l'outil \`propose_create_task\` pour chaque tâche demandée.
     -> N'utilise JAMAIS \`propose_move_note\` ni \`propose_update_task\` pour créer de nouvelles tâches !
     -> Génère TOUTES les propositions d'actions nécessaires dans la liste JSON si l'utilisateur demande plusieurs actions.

5. RÈGLE ESSENTIELLE SUR LES LIENS :
   - Écris TOUJOURS les wikilinks directs : [[NomNote]] ou [[Dossier/NomNote]].
   - NE METS JAMAIS de backticks autour des wikilinks (Écris [[Claire]] et JAMAIS \\\`[[Claire]]\\\`).

6. RÈGLE ESSENTIELLE SUR LE FORMAT DES TÂCHES ET SOUS-TÂCHES :
   - Lorsque tu appelles \`propose_create_task\` ou \`propose_decompose_task\`, fournis UNIQUEMENT le texte brut de l'intitulé dans \`taskTitle\` ou dans la liste \`subtasks\`, SANS ajouter "- [ ]" ni "[ ]" ni puces au début (ex: "Rédiger le plan", et JAMAIS "- [ ] Rédiger le plan").
   - Si tu rédiges une liste de tâches dans ton texte Markdown de réponse, chaque tâche doit commencer par un seul et unique "- [ ] " (ex: "- [ ] Titre", et JAMAIS "- [ ] - [ ] Titre" ni "- [ ] [ ] Titre").

7. CONSIGNE DE STYLE STRICTE :
   - N'utilise AUCUN émoji dans tes réponses textuelles (sauf si le format de tâche configuré l'impose explicitement pour les métadonnées). Reste sobre, clair, direct et professionnel.

8. GESTION DU TEMPS ET DES AGENDAS (Google Calendar) :
   - PRISE EN COMPTE DES AGENDAS :
     1. "Mon Agenda Principal & Secondaires" ("${this.settings.defaultCalendarId || 'primary'}") : Rendez-vous personnels de l'utilisateur (incluant les formations ou événements multi-jours en cours). Le principal bloque son temps de travail en priorité n°1. Planifie et ordonne toujours les tâches dans les plages horaires libres disponibles.
     2. "Agendas Partagés / Proches" : Appartiennent à des tiers (ex: conjoint, collègues). Mentionne-les sobrement si pertinent à titre purement informatif (ex: "Agenda d'Antoine : ..."), sans formules lourdes ou moralisatrices, et sans les compter comme des contraintes de l'utilisateur ni signaler de faux conflit d'agenda.
   - Pour toute création ou proposition d'événement Google Calendar (\`propose_create_calendar_event\`), utilise le calendrier de référence configuré ("${this.settings.defaultCalendarId || 'primary'}").

9. GARDE-FOU CRITIQUE SUR LES CRÉATIONS DE NOTES ET DE TÂCHES :
   - INTERDICTION ABSOLUE D'AFFIRMER QU'UNE NOTE OU UNE TÂCHE EST CRÉÉE dans ton texte (ex: "Fiche créée avec succès", "J'ai créé la note X...") si tu n'as pas émis le bloc JSON d'appel d'outil (\`propose_create_note\`, \`propose_create_task\`) dans ta réponse !
   - Lorsque l'utilisateur demande de créer une fiche/note à partir d'une autre note (ex: "crée la fiche François avec les infos de la note sans titre 175") :
      -> Tour 1 : Appelle d'abord \`read_note\` pour lire la note source demandée (ex: "Notes en vrac/Sans titre 175.md").
      -> Tour 2 : Une fois le contenu de la note reçu, émets \`propose_create_note\` avec le nom exact demandé (ex: fileName: "François Gafier.md" ou "François Gueyffier.md") et le dossier cible (ex: folder: "personne" ou "03 - Contacts").
      -> Ne cible JAMAIS une autre note (comme une note ouverte Françoise) si le nom demandé est différent !

10. OUVERTURE DE NOTES & AFFICHAGE DANS L'ÉDITEUR :
   - Si l'utilisateur demande d'ouvrir, d'afficher ou de montrer une note (ex: "Ouvre la note Projet X", "Affiche la fiche de Claire", "Ouvre mon journal d'aujourd'hui") :
     -> Appelle directement l'outil \`open_note\` avec \`filePath\` (et optionnellement \`newLeaf: true\` si demandé dans un nouvel onglet, ou \`lineNumber\` si une ligne précise est ciblée).

11. RECHERCHE ET EXÉCUTION DE COMMANDES OBSIDIAN :
   - Si l'utilisateur demande d'exécuter une action Obsidian ou de lancer une commande (ex: "Ouvre la vue graphique", "Bascule la barre latérale", "Active le mode source", "Lance la commande X") :
     -> Si l'identifiant exact de la commande est connu (ex: "app:open-daily-note", "workspace:toggle-left-sidebar", "graph:open", "editor:toggle-source"), appelle directement \`execute_command\`.
     -> Si l'identifiant précis est incertain ou dépend de plugins tiers, appelle \`search_commands\` avec un mot-clé pour obtenir la liste des commandes et leur identifiant exact, puis \`execute_command\`.

12. CRÉATION DE NOTES SELON MODÈLES & TEMPLATES (Obsidian, Templater, QuickAdd) :
   - Si l'utilisateur demande de créer une note en suivant un modèle ou template (ex: "crée la note de Claire selon le template personne", "crée le projet X avec le modèle projet") :
     -> Utilise la liste des modèles disponibles ci-dessus ou appelle \`read_template\` pour analyser son format, ses titres et ses placeholders.
     -> Appelle \`propose_create_note\` en spécifiant le \`templateName\` (ex: "personne", "projet"), le nom de fichier, le dossier cible et le contenu structuré correspondant.

FORMAT DES APPELS D'OUTILS (Ne place AUCUN texte superflu avant le bloc JSON si tu n'as pas encore cherché les infos) :
\`\`\`json
[
  {
    "tool": "nom_outil",
    "arguments": { ... }
  }
]
\`\`\`
RÈGLE CRITIQUE SUR LES PROPOSITIONS DE CRÉATION DE NOTES (\`propose_create_note\`) :
- Lorsque tu génères le texte d'un template ou d'une note dans l'argument "content", veille à ce que la chaîne JSON soit un JSON valide (guillemets internes échappés par \\", retours à la ligne échappés par \\n).

${toolDocs}`;
	}

	/**
	 * Boucle agentique autonome (ReAct) : exécute automatiquement les outils de lecture en arrière-plan
	 * sans jamais afficher de JSON brut à l'utilisateur.
	 */
	public async executeAgentLoop(
		conversationHistory: ChatMessage[],
		config: LLMConfig,
		attachedContextNotes: Array<{ path: string; title: string; content: string }>,
		onStatusUpdate: (status: AgentStepEvent) => void,
		onChunk: (chunk: string, fullVisibleText: string) => void,
		activeFile?: TFile | null
	): Promise<AgentResponse> {
		// Optimisation de la latence : fenêtre glissante des 8 derniers messages pour accélérer le préfill GPU
		const trimmedHistory = conversationHistory.length > 8 ? conversationHistory.slice(-8) : conversationHistory;

		const messages: ChatMessage[] = [
			{ role: 'system', content: this.buildSystemPrompt(attachedContextNotes, activeFile) },
			...trimmedHistory
		];

		const collectedProposals: ActionProposal[] = [];
		const collectedTasks: ObsidianTask[] = [];
		const executedTools: string[] = [];
		const MAX_TURNS = 3;
		let currentTurn = 0;
		let finalAnswerText = '';

		while (currentTurn < MAX_TURNS) {
			currentTurn++;
			let currentTurnOutput = '';

			onStatusUpdate({ type: 'thinking', message: currentTurn === 1 ? 'Analyse de votre demande...' : 'Synthèse des informations...' });

			await LLMService.generateStreamingResponse(
				messages,
				config,
				(chunk, full) => {
					currentTurnOutput = full;
					// Filtrage en direct : on ne stream que le texte naturel, JAMAIS les blocs JSON de tool calls
					const visibleStreamingText = JsonUtils.cleanStreamingText(full);
					if (visibleStreamingText) {
						onChunk(chunk, visibleStreamingText);
					}
				}
			);

			// Extraction robuste des appels d'outils
			const { toolCalls, cleanText } = this.extractToolCallsFromOutput(currentTurnOutput);

			// Séparation lecture vs écriture
			const readCalls = toolCalls.filter(c => !c.name.startsWith('propose_'));
			const writeCalls = toolCalls.filter(c => c.name.startsWith('propose_'));

			// Traitement des propositions d'écriture
			for (const call of writeCalls) {
				const res = await this.toolRegistry.executeTool(call);
				if (res.actionProposals) {
					collectedProposals.push(...res.actionProposals);
				}
			}

			// Si aucun outil de lecture n'est demandé, c'est la réponse finale
			if (readCalls.length === 0) {
				finalAnswerText = cleanText || JsonUtils.extractToolCallsFromText(currentTurnOutput).cleanText;
				break;
			}

			// Exécution transparente des outils de lecture
			messages.push({ role: 'assistant', content: currentTurnOutput });

			const readResults: string[] = [];
			for (const call of readCalls) {
				const label = this.formatToolCallHumanReadable(call);
				executedTools.push(label);
				onStatusUpdate({
					type: 'searching',
					message: label,
					toolName: call.name
				});

				if (call.name === 'search_tasks') {
					try {
						const tasks = await this.vaultContext.searchTasks(call.arguments || {});
						tasks.forEach(t => {
							if (!collectedTasks.some(ct => ct.filePath === t.filePath && ct.lineNumber === t.lineNumber)) {
								collectedTasks.push(t);
							}
						});
					} catch {
						// Ignorer
					}
				}

				const res = await this.toolRegistry.executeTool(call);
				readResults.push(`Résultat de ${call.name}(${JSON.stringify(call.arguments)}) :\n${res.output}`);
			}

			const toolFeedbackMessage = `Résultats des recherches dans le coffre :\n\n${readResults.join('\n\n')}\n\nDonne maintenant ta réponse finale complète, sobre et structurée en Markdown à l'utilisateur, et ajoute si pertinent les propositions d'actions d'écriture (propose_create_note, propose_create_task...).`;

			messages.push({ role: 'user', content: toolFeedbackMessage });
		}

		onStatusUpdate({ type: 'done' });

		return {
			text: finalAnswerText,
			actionProposals: collectedProposals,
			executedTools,
			relevantTasks: collectedTasks
		};
	}

	private formatToolCallHumanReadable(call: ToolCallRequest): string {
		const args = call.arguments || {};
		switch (call.name) {
			case 'search_vault':
				return `Recherche dans le coffre : "${args.query || ''}"`;
			case 'search_tasks':
				return `Consultation des tâches : "${args.query || args.status || 'toutes'}"`;
			case 'read_note':
				return `Lecture de la note : "${args.filePath || ''}"`;
			case 'get_note_connections':
				return `Analyse des connexions de : "${args.filePath || ''}"`;
			case 'get_daily_note':
				return `Consultation du journal du jour`;
			case 'get_vault_structure':
				return `Analyse de l'arborescence du coffre`;
			default:
				return `Exécution de l'outil : ${call.name}`;
		}
	}

	private extractToolCallsFromOutput(text: string): { toolCalls: ToolCallRequest[]; cleanText: string } {
		const res = JsonUtils.extractToolCallsFromText(text);
		const toolCalls: ToolCallRequest[] = res.toolCalls.map(tc => ({
			name: tc.name,
			arguments: tc.arguments
		}));
		return {
			toolCalls,
			cleanText: res.cleanText
		};
	}
}
