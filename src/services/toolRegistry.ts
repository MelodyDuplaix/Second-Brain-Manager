import { VaultContextService } from './vaultContextService';
import { ToolDefinition, ActionProposal } from '../models/actions';
import { TaskMutator } from '../mutators/taskMutator';
import { GoogleCalendarService } from './googleCalendarService';
import { normalizePath } from 'obsidian';

export interface ToolCallRequest {
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolExecutionResult {
	output: string;
	actionProposals?: ActionProposal[];
}

export class ToolRegistry {
	private vaultContext: VaultContextService;
	private static tools: ToolDefinition[] = [
		// 1. Outils de Lecture & RAG
		{
			name: 'search_vault',
			description: 'Recherche des notes dans le coffre par mot-clé, dossier ou tag.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Termes de recherche (titre ou contenu).' },
					folder: { type: 'string', description: 'Filtrer par dossier optionnel (ex: "01 - Projets", "03 - Contacts").' },
					tags: { type: 'string', description: 'Filtrer par tag optionnel (ex: "#contact", "#travail").' },
					limit: { type: 'number', description: 'Nombre maximum de résultats (défaut 5).' }
				},
				required: ['query']
			}
		},
		{
			name: 'search_tasks',
			description: 'Recherche des tâches Markdown Tasks existantes avec filtres (échéance, énergie, quadrant, statut, en pause).',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Texte contenu dans la tâche.' },
					status: { type: 'string', description: 'Statut de la tâche', enum: ['todo', 'done', 'in-progress', 'cancelled', 'paused', 'all'] },
					isPaused: { type: 'boolean', description: 'Filtrer uniquement les tâches en pause (true) ou actives (false).' },
					dueBefore: { type: 'string', description: 'Date d\'échéance maximale (format YYYY-MM-DD).' },
					quadrant: { type: 'string', description: 'Quadrant d\'Eisenhower', enum: ['q1', 'q2', 'q3', 'q4'] },
					energyMax: { type: 'number', description: 'Niveau d\'énergie maximum (1-10).' },
					folder: { type: 'string', description: 'Dossier spécifique où chercher les tâches.' }
				},
				required: []
			}
		},
		{
			name: 'read_note',
			description: 'Lit le contenu textuel complet d\'une note spécifique.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Chemin relatif de la note (ex: "03 - Contacts/Claire.md").' }
				},
				required: ['filePath']
			}
		},
		{
			name: 'get_note_connections',
			description: 'Récupère les liens sortants [[...]], les backlinks et les tags associés à une note.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Chemin de la note à analyser.' }
				},
				required: ['filePath']
			}
		},
		{
			name: 'get_daily_note',
			description: 'Récupère la note quotidienne du journal pour une date (défaut aujourd\'hui).',
			parameters: {
				type: 'object',
				properties: {
					date: { type: 'string', description: 'Date au format YYYY-MM-DD (optionnel, défaut aujourd\'hui).' }
				},
				required: []
			}
		},
		{
			name: 'get_vault_structure',
			description: 'Renvoie l\'arborescence globale du coffre (liste des projets, contacts, domaines et dossiers).',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		},
		{
			name: 'list_calendars',
			description: 'Liste tous les agendas Google disponibles sur le compte (personnel, professionnel, agendas secondaires et partagés).',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		},
		{
			name: 'get_calendar_events',
			description: 'Recherche et récupère les événements de l\'agenda Google Calendar selon de multiples paramètres et critères (période, mot-clé, lieu, participant, agenda spécifique, événements passés ou futurs).',
			parameters: {
				type: 'object',
				properties: {
					startDate: { type: 'string', description: 'Date de début au format YYYY-MM-DD (optionnel, défaut aujourd\'hui).' },
					endDate: { type: 'string', description: 'Date de fin au format YYYY-MM-DD (optionnel, ex: +7 jours ou fin du mois).' },
					query: { type: 'string', description: 'Terme de recherche plein texte (titre, sujet ou notes).' },
					location: { type: 'string', description: 'Filtre sur le lieu ou lien de réunion (ex: "Paris", "Visio", "Zoom").' },
					attendee: { type: 'string', description: 'Filtre sur le nom ou l\'email d\'un participant.' },
					calendarId: { type: 'string', description: 'ID d\'un agenda spécifique, ou "all" pour chercher dans tous les agendas du compte.' },
					includePast: { type: 'boolean', description: 'Inclure les événements passés (défaut: true si startDate est dans le passé ou si recherche par mot-clé).' },
					maxResults: { type: 'number', description: 'Nombre maximum d\'événements à retourner (défaut: 50).' }
				},
				required: []
			}
		},
		{
			name: 'search_calendar_events',
			description: 'Recherche globale dans TOUS les agendas Google accessibles (principal, secondaires, partagés). Ne spécifiez pas calendarId pour rechercher dans tous les agendas à la fois.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Terme de recherche plein texte (sujet, personne, lieu).' },
					startDate: { type: 'string', description: 'Date de début (YYYY-MM-DD).' },
					endDate: { type: 'string', description: 'Date de fin (YYYY-MM-DD).' },
					location: { type: 'string', description: 'Filtre lieu.' },
					attendee: { type: 'string', description: 'Filtre participant.' },
					calendarId: { type: 'string', description: 'ID d\'un agenda spécifique uniquement si l\'utilisateur demande expressément un seul calendrier. Laissez vide ou "all" pour interroger tous les agendas configurés.' },
					includePast: { type: 'boolean', description: 'Inclure le passé.' }
				},
				required: []
			}
		},
		{
			name: 'open_note',
			description: 'Ouvre une note spécifique dans l\'espace de travail Obsidian de l\'utilisateur (affichage direct dans l\'éditeur, avec option de nouvel onglet ou de navigation à une ligne précise).',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Chemin relatif du fichier ou nom de la note (ex: "01 - Projets/Alpha.md" ou "Claire Dupont").' },
					newLeaf: { type: 'boolean', description: 'Ouvrir dans un nouvel onglet séparé (défaut: false).' },
					lineNumber: { type: 'number', description: 'Numéro de ligne vers laquelle naviguer (1-indexé, optionnel).' }
				},
				required: ['filePath']
			}
		},
		{
			name: 'search_commands',
			description: 'Recherche les commandes disponibles dans Obsidian (commandes natives et de plugins tiers installés) par mot-clé pour trouver leur identifiant et leur nom exact.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Mot-clé ou terme de recherche (ex: "daily", "sidebar", "graph", "table", "tasks", "template"). Laissez vide pour lister les principales commandes.' },
					limit: { type: 'number', description: 'Nombre maximum de commandes à retourner (défaut: 30).' }
				},
				required: []
			}
		},
		{
			name: 'execute_command',
			description: 'Exécute une commande native d\'Obsidian ou d\'un plugin tiers par son identifiant de commande (ex: "app:open-daily-note", "workspace:toggle-left-sidebar", "graph:open") ou par recherche de son intitulé.',
			parameters: {
				type: 'object',
				properties: {
					commandId: { type: 'string', description: 'Identifiant unique de la commande Obsidian (ex: "app:open-daily-note", "editor:toggle-source", "graph:open") ou intitulé exact.' }
				},
				required: ['commandId']
			}
		},
		{
			name: 'list_templates',
			description: 'Liste les modèles et templates disponibles dans le coffre (Obsidian Templates, Templater, QuickAdd) pour créer des notes structurées (fiches personnes, projets, réunions, etc.).',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Terme de recherche optionnel pour filtrer les modèles par nom (ex: "personne", "projet", "reunion").' }
				},
				required: []
			}
		},
		{
			name: 'read_template',
			description: 'Lit le contenu brut, la structure et les variables/placeholders d\'un modèle ou template spécifique.',
			parameters: {
				type: 'object',
				properties: {
					templateName: { type: 'string', description: 'Nom ou chemin du modèle à lire (ex: "personne", "fiche contact", "Templates/Projet.md").' }
				},
				required: ['templateName']
			}
		},

		// 2. Outils de Proposition d'Écriture (soumis à validation utilisateur)
		{
			name: 'propose_create_note',
			description: 'Propose la création d\'une nouvelle note (ex: fiche contact dans "03 - Contacts", compte-rendu, etc.), avec possibilité d\'appliquer un modèle / template (Obsidian, Templater, QuickAdd).',
			parameters: {
				type: 'object',
				properties: {
					folder: { type: 'string', description: 'Dossier cible (ex: "03 - Contacts", "01 - Projets", "00 - Inbox").' },
					fileName: { type: 'string', description: 'Nom du fichier sans ou avec extension .md (ex: "Claire Dupont").' },
					content: { type: 'string', description: 'Contenu Markdown complet de la note. Utilisez systématiquement des wikilinks [[Nom]] pour toute personne, contact, projet ou note référencée.' },
					templateName: { type: 'string', description: 'Nom ou chemin optionnel d\'un modèle / template à appliquer (ex: "personne", "projet", "Templates/Contact.md").' },
					variables: { type: 'object', description: 'Variables clé-valeur optionnelles pour compléter les placeholders du template.' },
					tags: { type: 'array', description: 'Tags à ajouter à la note.', items: { type: 'string' } }
				},
				required: ['folder', 'fileName', 'content']
			}
		},
		{
			name: 'propose_append_to_note',
			description: 'Propose d\'ajouter une entrée ou un texte dans une note existante ou la note quotidienne.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Chemin relatif du fichier cible (ex: "04 - Journal/2026-08-27.md" ou "01 - Projets/Projet.md").' },
					entryText: { type: 'string', description: 'Texte formaté à ajouter. Utilisez des wikilinks [[Nom]] pour toute personne, contact, projet ou note mentionnée.' },
					section: { type: 'string', description: 'Titre de la section sous laquelle insérer (optionnel).' }
				},
				required: ['filePath', 'entryText']
			}
		},
		{
			name: 'propose_create_task',
			description: 'Propose la création d\'une tâche Markdown canonique compatible Obsidian Tasks dans un fichier ou la note quotidienne.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Fichier cible où insérer la tâche. Si la tâche concerne un projet, un contact ou un sujet précis, ciblez prioritairement la note correspondante (ex: "01 - Projets/Alpha.md", "03 - Contacts/Claire.md") plutôt que le journal. Réservez le journal quotidien aux tâches généralistes ou aux demandes explicites.' },
					taskTitle: { type: 'string', description: 'Intitulé brut de la tâche sans puce. Si vous mentionnez une personne, un contact, un projet ou une autre note, utilisez systématiquement un wikilink [[Nom]] (ex: "Appeler [[Claire Dupont]] pour valider le devis").' },
					dueDate: { type: 'string', description: 'Date d\'échéance (YYYY-MM-DD).' },
					startDate: { type: 'string', description: 'Date de début (YYYY-MM-DD).' },
					priority: { type: 'string', description: 'Priorité', enum: ['highest', 'high', 'medium', 'normal', 'low', 'lowest'] },
					energy: { type: 'number', description: 'Niveau d\'énergie requis (1-10).' },
					pieces: { type: 'number', description: 'Récompense en pièces (défaut calcul automatique).' },
					matrixQuadrant: { type: 'string', description: 'Quadrant d\'Eisenhower', enum: ['q1', 'q2', 'q3', 'q4'] },
					domainTags: { type: 'array', description: 'Tags de domaine (ex: ["#travail", "#client"]).', items: { type: 'string' } },
					linkedNotes: { type: 'array', description: 'Noms des notes à lier en wikilinks (ex: ["Claire Dupont"]).', items: { type: 'string' } }
				},
				required: ['filePath', 'taskTitle']
			}
		},
		{
			name: 'propose_update_task',
			description: 'Propose la modification d\'une tâche existante (date, statut, quadrant, énergie, priorité, intitulé). NE PAS UTILISER pour créer de nouvelles tâches.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Fichier contenant la tâche.' },
					lineNumber: { type: 'number', description: 'Numéro de ligne de la tâche (1-indexé).' },
					taskTitle: { type: 'string', description: 'Nouvel intitulé de la tâche si modifié. Utilisez systématiquement des wikilinks [[Nom]] pour toute personne, contact ou note mentionnée.' },
					newStatus: { type: 'string', description: 'Nouveau statut (todo, in-progress, done, cancelled).' },
					newDueDate: { type: 'string', description: 'Nouvelle date d\'échéance (YYYY-MM-DD ou "null" pour retirer).' },
					newPriority: { type: 'string', description: 'Nouvelle priorité', enum: ['highest', 'high', 'medium', 'normal', 'low', 'lowest'] },
					newEnergy: { type: 'number', description: 'Nouveau niveau d\'énergie (1-10).' },
					newMatrixQuadrant: { type: 'string', description: 'Nouveau quadrant', enum: ['q1', 'q2', 'q3', 'q4'] }
				},
				required: ['filePath', 'lineNumber']
			}
		},
		{
			name: 'propose_decompose_task',
			description: 'Propose le découpage d\'une tâche complexe existante en sous-tâches ordonnées.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Fichier contenant la tâche parente.' },
					parentLineNumber: { type: 'number', description: 'Ligne de la tâche parente.' },
					subtasks: {
						type: 'array',
						description: 'Liste des intitulés bruts des sous-tâches décomposées, sans cases à cocher "- [ ]" ni puces. Utilisez systématiquement des wikilinks [[Nom]] pour toute personne, contact ou note mentionnée (ex: ["Appeler [[Claire]]", "Finaliser pour [[Projet Alpha]]"]).',
						items: { type: 'string' }
					}
				},
				required: ['filePath', 'parentLineNumber', 'subtasks']
			}
		},
		{
			name: 'propose_link_notes',
			description: 'Propose de relier deux fiches ou notes entre elles via des wikilinks [[...]].',
			parameters: {
				type: 'object',
				properties: {
					sourceFilePath: { type: 'string', description: 'Fichier source à enrichir.' },
					targetNoteName: { type: 'string', description: 'Nom de la note cible à référencer en [[lien]].' },
					contextExplanation: { type: 'string', description: 'Contexte ou raison de la liaison.' }
				},
				required: ['sourceFilePath', 'targetNoteName']
			}
		},
		{
			name: 'propose_move_note',
			description: 'Propose de déplacer ou ranger une note existante vers un dossier (NE PAS UTILISER pour créer des tâches).',
			parameters: {
				type: 'object',
				properties: {
					sourceFilePath: { type: 'string', description: 'Chemin actuel du fichier à déplacer.' },
					destinationFolder: { type: 'string', description: 'Dossier de destination (ex: "01 - Projets").' }
				},
				required: ['sourceFilePath', 'destinationFolder']
			}
		},
		{
			name: 'propose_create_calendar_event',
			description: 'Propose la création d\'un événement / rendez-vous dans l\'agenda Google Calendar.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Titre de l\'événement / rendez-vous (ex: "RDV Comptable", "Point hebdo").' },
					startDate: { type: 'string', description: 'Date de début au format YYYY-MM-DD (ex: "2026-08-28").' },
					startTime: { type: 'string', description: 'Heure de début au format HH:mm (ex: "14:00"). Omettre pour un événement sur toute la journée.' },
					endDate: { type: 'string', description: 'Date de fin au format YYYY-MM-DD (optionnel, défaut même jour).' },
					endTime: { type: 'string', description: 'Heure de fin au format HH:mm (ex: "15:00", optionnel).' },
					description: { type: 'string', description: 'Description détaillée ou ordre du jour de l\'événement (optionnel).' },
					location: { type: 'string', description: 'Lieu de l\'événement ou lien de visioconférence (optionnel).' },
					calendarId: { type: 'string', description: 'Identifiant du calendrier Google cible (défaut "primary").' }
				},
				required: ['title', 'startDate']
			}
		},
		{
			name: 'propose_update_calendar_event',
			description: 'Propose la modification d\'un événement existant dans Google Calendar.',
			parameters: {
				type: 'object',
				properties: {
					eventId: { type: 'string', description: 'Identifiant unique de l\'événement Google Calendar.' },
					title: { type: 'string', description: 'Nouveau titre de l\'événement.' },
					startDate: { type: 'string', description: 'Nouvelle date de début (YYYY-MM-DD).' },
					startTime: { type: 'string', description: 'Nouvelle heure de début (HH:mm).' },
					endDate: { type: 'string', description: 'Nouvelle date de fin (YYYY-MM-DD).' },
					endTime: { type: 'string', description: 'Nouvelle heure de fin (HH:mm).' },
					description: { type: 'string', description: 'Nouvelle description.' },
					location: { type: 'string', description: 'Nouveau lieu.' },
					calendarId: { type: 'string', description: 'Identifiant du calendrier Google.' }
				},
				required: ['eventId']
			}
		},
		{
			name: 'propose_open_note',
			description: 'Propose à l\'utilisateur d\'ouvrir une note spécifique dans l\'éditeur Obsidian.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Chemin relatif du fichier ou nom de la note (ex: "01 - Projets/Alpha.md").' },
					newLeaf: { type: 'boolean', description: 'Ouvrir dans un nouvel onglet (défaut false).' },
					lineNumber: { type: 'number', description: 'Numéro de ligne vers laquelle naviguer (optionnel).' }
				},
				required: ['filePath']
			}
		},
		{
			name: 'propose_execute_command',
			description: 'Propose à l\'utilisateur d\'exécuter une commande Obsidian spécifique.',
			parameters: {
				type: 'object',
				properties: {
					commandId: { type: 'string', description: 'Identifiant ou nom de la commande Obsidian à exécuter.' }
				},
				required: ['commandId']
			}
		}
	];

	private settings?: any;

	constructor(vaultContext: VaultContextService, settings?: any) {
		this.vaultContext = vaultContext;
		this.settings = settings;
	}

	public static getToolDefinitions(): ToolDefinition[] {
		return this.tools;
	}

	/**
	 * Convertit la liste des outils au format JSON Schema attendu par OpenAI & Ollama.
	 */
	public static getOpenAIToolsSchema(): Array<{ type: 'function'; function: ToolDefinition }> {
		return this.tools.map(t => ({
			type: 'function',
			function: t
		}));
	}

	/**
	 * Convertit la liste des outils au format attendu par l'API Google Gemini.
	 */
	public static getGeminiToolsSchema(): Array<{ functionDeclarations: ToolDefinition[] }> {
		return [{ functionDeclarations: this.tools }];
	}

	/**
	 * Génère une documentation compacte pour les modèles locaux sans Function Calling natif.
	 */
	public static getSystemPromptToolDocumentation(): string {
		let doc = '### OUTILS DISPONIBLES :\n';
		this.tools.forEach(t => {
			doc += `- **${t.name}**: ${t.description}\n  Paramètres: ${JSON.stringify(t.parameters.properties)}\n`;
		});
		doc += '\nPour appeler un outil, utilisez le format JSON : ```json\n{"tool": "nom_outil", "arguments": { ... }}\n```\n';
		return doc;
	}

	/**
	 * Exécute un appel d'outil (lecture ou génération d'action).
	 */
	public async executeTool(toolCall: ToolCallRequest): Promise<ToolExecutionResult> {
		const { name, arguments: args } = toolCall;

		switch (name) {
			// --- Outils de Lecture & RAG ---
			case 'search_vault': {
				const query = String(args.query || '');
				const folder = args.folder ? String(args.folder) : undefined;
				const tags = args.tags ? String(args.tags) : undefined;
				const limit = typeof args.limit === 'number' ? args.limit : 5;
				const res = await this.vaultContext.searchNotes(query, limit, folder, tags);
				return { output: JSON.stringify(res, null, 2) };
			}

			case 'search_tasks': {
				const res = await this.vaultContext.searchTasks({
					query: args.query ? String(args.query) : undefined,
					status: args.status as 'todo' | 'done' | 'in-progress' | 'cancelled' | 'paused' | 'all',
					isPaused: typeof args.isPaused === 'boolean' ? args.isPaused : undefined,
					dueBefore: args.dueBefore ? String(args.dueBefore) : undefined,
					quadrant: args.quadrant ? String(args.quadrant) : undefined,
					energyMax: typeof args.energyMax === 'number' ? args.energyMax : undefined,
					folder: args.folder ? String(args.folder) : undefined,
					limit: typeof args.limit === 'number' ? args.limit : 20
				});
				return { output: JSON.stringify(res.map(t => ({
					file: t.filePath,
					line: t.lineNumber,
					title: t.title,
					completed: t.completed,
					isPaused: t.isPaused,
					status: t.status,
					dueDate: t.dueDate,
					energy: t.energy,
					pieces: t.pieces,
					matrixTag: t.matrixTag,
					domainTags: t.domainTags
				})), null, 2) };
			}

			case 'read_note': {
				const filePath = String(args.filePath || '');
				const res = await this.vaultContext.readNote(filePath);
				if (!res) return { output: `Erreur: Note introuvable ou protégée par vos règles de confidentialité à l'emplacement "${filePath}".` };
				return { output: JSON.stringify(res, null, 2) };
			}

			case 'get_note_connections': {
				const filePath = String(args.filePath || '');
				const res = await this.vaultContext.getNoteConnections(filePath);
				if (!res) return { output: `Erreur: Note introuvable ou protégée par vos règles de confidentialité pour "${filePath}".` };
				return { output: JSON.stringify(res, null, 2) };
			}

			case 'get_daily_note': {
				const date = args.date ? String(args.date) : undefined;
				const res = await this.vaultContext.getDailyNote(date);
				return { output: JSON.stringify(res, null, 2) };
			}

			case 'get_vault_structure': {
				const res = this.vaultContext.getVaultStructure();
				return { output: JSON.stringify(res, null, 2) };
			}

			case 'list_templates': {
				const query = args.query ? String(args.query) : undefined;
				const templates = this.vaultContext.listTemplates(query);
				if (templates.length === 0) {
					return { output: `Aucun modèle/template trouvé${query ? ` pour "${query}"` : ''} dans le coffre.` };
				}
				const lines = templates.map(t => `- **${t.name}** (Chemin: \`${t.path}\`)`);
				return { output: `Modèles / Templates disponibles (${templates.length}) :\n${lines.join('\n')}` };
			}

			case 'read_template': {
				const templateName = String(args.templateName || args.name || '');
				if (!templateName) return { output: 'Erreur: Veuillez spécifier le nom ou le chemin du modèle à lire.' };
				const tpl = await this.vaultContext.readTemplate(templateName);
				if (!tpl) {
					return { output: `Modèle introuvable pour "${templateName}". Utilisez list_templates pour voir les modèles disponibles.` };
				}
				return { output: JSON.stringify({
					name: tpl.name,
					path: tpl.path,
					placeholders: tpl.placeholders,
					content: tpl.content
				}, null, 2) };
			}

			case 'list_calendars': {
				if (!this.settings || !this.settings.googleRefreshToken) {
					return {
						output: 'Google Calendar n\'est pas connecté. Veuillez renseigner votre Client ID et Client Secret puis lancer l\'approbation dans les réglages.'
					};
				}
				try {
					const cals = await GoogleCalendarService.listCalendars(this.settings);
					const lines = cals.map(c => `- **${c.summary}** (ID: \`${c.id}\`)${c.primary ? ' [Principal]' : ''}${c.description ? ` : ${c.description}` : ''}`);
					return {
						output: `Agendas Google disponibles (${cals.length}) :\n${lines.join('\n')}`
					};
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					return { output: `Erreur récupération agendas Google : ${errorMsg}` };
				}
			}

			case 'search_calendar_events':
			case 'get_calendar_events': {
				if (!this.settings || !this.settings.googleRefreshToken) {
					return {
						output: 'Google Calendar n\'est pas encore connecté. Vous pouvez renseigner vos identifiants dans les paramètres du plugin Second Brain.'
					};
				}
				try {
					const startDate = args.startDate ? String(args.startDate) : undefined;
					const endDate = args.endDate ? String(args.endDate) : undefined;
					const query = args.query ? String(args.query) : undefined;
					const location = args.location ? String(args.location) : undefined;
					const attendee = args.attendee ? String(args.attendee) : undefined;
					const calendarId = args.calendarId ? String(args.calendarId) : undefined;
					const includePast = typeof args.includePast === 'boolean' ? args.includePast : undefined;
					const maxResults = typeof args.maxResults === 'number' ? args.maxResults : undefined;

					// Si startDate est spécifié (ex: "2026-08-28"), on élargit timeMin pour capturer les événements multi-jours démarrés plus tôt
					let timeMin: string | undefined = undefined;
					if (startDate) {
						const d = new Date(`${startDate}T00:00:00`);
						d.setDate(d.getDate() - 7);
						timeMin = d.toISOString();
					}
					const timeMax = endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined;

					let events = await GoogleCalendarService.getEvents(this.settings, {
						timeMin,
						timeMax,
						query,
						location,
						attendee,
						calendarIds: (calendarId && calendarId !== 'all') ? [calendarId] : undefined,
						includePast,
						maxResults
					});

					// Filtrer précisément selon la date demandée (avec support multi-jours) si pas de recherche plein texte
					if (startDate && !query) {
						events = events.filter(ev => {
							if (endDate && endDate !== startDate) {
								const evStart = ev.start?.date || (ev.start?.dateTime ? ev.start.dateTime.split('T')[0] : '');
								const evEnd = ev.end?.date || (ev.end?.dateTime ? ev.end.dateTime.split('T')[0] : '');
								if (!evStart) return false;
								return (evEnd ? evEnd >= startDate : evStart >= startDate) && evStart <= endDate;
							}
							return GoogleCalendarService.isEventOnDate(ev, startDate);
						});
					}

					if (events.length === 0) {
						return {
							output: 'Aucun événement Google Calendar trouvé correspondant aux critères spécifiés.'
						};
					}

					const calendarsConfig = this.settings?.calendarsConfig || {};
					const refCalId = this.settings?.defaultCalendarId || 'primary';

					const getRole = (ev: GoogleCalendarEvent): { role: string; ownerName?: string } => {
						const calId = ev.calendarId;
						if (calId && calendarsConfig[calId]) {
							const conf = calendarsConfig[calId];
							return { role: conf.role, ownerName: conf.ownerName };
						}
						if (calId === refCalId || (!calId && refCalId === 'primary') || (refCalId === 'primary' && (ev.calendarName?.toLowerCase().includes('principal') ?? false))) {
							return { role: 'primary' };
						}
						return { role: 'other_person' };
					};

					const primaryEvents: GoogleCalendarEvent[] = [];
					const secondaryEvents: GoogleCalendarEvent[] = [];
					const otherEvents: Array<{ event: GoogleCalendarEvent; ownerName?: string }> = [];

					for (const ev of events) {
						const { role, ownerName } = getRole(ev);
						if (role === 'ignore') continue;
						if (role === 'primary') primaryEvents.push(ev);
						else if (role === 'secondary') secondaryEvents.push(ev);
						else otherEvents.push({ event: ev, ownerName });
					}

					const formatEvent = (ev: GoogleCalendarEvent): string => {
						const startDateTime = ev.start?.dateTime;
						const endDateTime = ev.end?.dateTime;
						const startDateVal = ev.start?.date || (startDateTime ? startDateTime.split('T')[0] : '');
						const endDateVal = ev.end?.date || (endDateTime ? endDateTime.split('T')[0] : '');

						let timeInfo = 'Toute la journée';
						const isMultiDay = startDateVal && endDateVal && startDateVal !== endDateVal && (!ev.start?.date || !ev.end?.date || ev.end.date > ev.start.date);

						if (startDateTime && endDateTime) {
							const startTime = new Date(startDateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
							const endTime = new Date(endDateTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
							if (startDateVal === endDateVal) {
								timeInfo = `${startTime} - ${endTime}`;
							} else {
								timeInfo = `Du ${startDateVal} ${startTime} au ${endDateVal} ${endTime} (En cours / actif aujourd'hui)`;
							}
						} else if (isMultiDay && startDateVal && endDateVal) {
							timeInfo = `Multi-jours : du ${startDateVal} au ${endDateVal} (Événement en cours / actif aujourd'hui)`;
						}

						const dateDisplay = (startDateVal && endDateVal && startDateVal !== endDateVal)
							? `Du ${startDateVal} au ${endDateVal}`
							: (startDateVal || 'Date non spécifiée');

						let line = `- [Agenda: ${ev.calendarName || 'Principal'}] ${dateDisplay} (${timeInfo}) : **${ev.summary}** (ID: \`${ev.id}\`)`;
						if (ev.location) line += ` | 📍 Lieu : ${ev.location}`;
						if (ev.description) line += ` | 📝 Notes : ${ev.description.replace(/\n+/g, ' ').slice(0, 150)}`;
						if (ev.attendees && ev.attendees.length > 0) {
							const attNames = ev.attendees.map(a => a.displayName || a.email).join(', ');
							line += ` | 👥 Participants : ${attNames}`;
						}
						return line;
					};

					const sections: string[] = [];
					if (primaryEvents.length > 0) {
						sections.push(`👤 1. MON AGENDA PRINCIPAL DE RÉFÉRENCE (Contraintes prioritaires de l'utilisateur) :\n` + primaryEvents.map(formatEvent).join('\n'));
					}
					if (secondaryEvents.length > 0) {
						sections.push(`🎯 2. MES AGENDAS SECONDAIRES (Événements perso/flexibles de l'utilisateur) :\n` + secondaryEvents.map(formatEvent).join('\n'));
					}
					if (otherEvents.length > 0) {
						sections.push(`👥 3. AGENDAS D'AUTRES PERSONNES / CALENDRIERS PARTAGÉS (Concernent d'autres personnes - Ne bloquent pas la disponibilité de l'utilisateur) :\n` + otherEvents.map(o => {
							const ownerTag = o.ownerName ? `[Propriétaire: ${o.ownerName}] ` : '';
							return `${ownerTag}${formatEvent(o.event)}`;
						}).join('\n'));
					}

					return {
						output: `Événements Google Calendar trouvés (${primaryEvents.length + secondaryEvents.length + otherEvents.length}) :\n\n${sections.join('\n\n')}`
					};
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					return {
						output: `Erreur lors de la récupération des événements Google Calendar : ${errorMsg}`
					};
				}
			}

			// --- Outils d'Écriture (Propositions) ---
			case 'propose_create_note': {
				const folder = normalizePath(String(args.folder || '00 - Inbox'));
				const rawName = String(args.fileName || 'Sans titre');
				const fileName = rawName.endsWith('.md') ? rawName : `${rawName}.md`;
				const targetPath = normalizePath(`${folder}/${fileName}`);
				const content = String(args.content || '');
				const templateName = args.templateName ? String(args.templateName) : undefined;
				const variables = (args.variables && typeof args.variables === 'object') ? args.variables as Record<string, string> : undefined;
				const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;

				const templateLabel = templateName ? ` (Modèle: ${templateName})` : '';

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'create_note',
					description: `📄 Créer la note "${fileName}" dans "${folder}"${templateLabel}`,
					selected: true,
					targetPath,
					folder,
					fileName,
					content,
					templateName,
					variables,
					tags
				};

				return {
					output: `Proposition de création enregistrée pour "${targetPath}"${templateLabel}.`,
					actionProposals: [proposal]
				};
			}

			case 'propose_append_to_note': {
				const targetPath = normalizePath(String(args.filePath || ''));
				const entryText = String(args.entryText || '');
				const section = args.section ? String(args.section) : undefined;

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'append_to_note',
					description: `📝 Ajouter du contenu dans "${targetPath}"${section ? ` (Section ${section})` : ''}`,
					selected: true,
					targetPath,
					entryText,
					section
				};

				return {
					output: `Proposition d'ajout de texte enregistrée pour "${targetPath}".`,
					actionProposals: [proposal]
				};
			}

			case 'propose_create_task': {
				const targetPath = normalizePath(String(args.filePath || ''));
				const rawTitle = String(args.taskTitle || '');
				const taskTitle = TaskMutator.cleanTaskPrefix(rawTitle);
				const dueDate = args.dueDate ? String(args.dueDate) : undefined;
				const startDate = args.startDate ? String(args.startDate) : undefined;
				const priority = args.priority as 'highest' | 'high' | 'medium' | 'normal' | 'low' | 'lowest' | undefined;
				const energy = typeof args.energy === 'number' ? args.energy : undefined;
				const pieces = typeof args.pieces === 'number' ? args.pieces : undefined;
				const matrixQuadrant = args.matrixQuadrant as 'q1' | 'q2' | 'q3' | 'q4' | undefined;
				const domainTags = Array.isArray(args.domainTags) ? args.domainTags.map(String) : undefined;
				const linkedNotes = Array.isArray(args.linkedNotes) ? args.linkedNotes.map(String) : undefined;

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'create_task',
					description: `⏰ Créer la tâche « ${taskTitle} » dans "${targetPath}"`,
					selected: true,
					targetPath,
					taskTitle,
					dueDate,
					startDate,
					priority,
					energy,
					pieces,
					matrixQuadrant,
					domainTags,
					linkedNotes
				};

				return {
					output: `Proposition de tâche enregistrée : "${taskTitle}" dans "${targetPath}".`,
					actionProposals: [proposal]
				};
			}

			case 'propose_update_task': {
				const targetPath = normalizePath(String(args.filePath || ''));
				const lineNumber = Number(args.lineNumber || 1);

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'update_task',
					description: `✏️ Modifier la tâche à la ligne ${lineNumber} dans "${targetPath}"`,
					selected: true,
					targetPath,
					lineNumber,
					newStatus: args.newStatus ? String(args.newStatus) : undefined,
					newDueDate: args.newDueDate ? String(args.newDueDate) : undefined,
					newPriority: args.newPriority as 'highest' | 'high' | 'medium' | 'normal' | 'low' | 'lowest' | undefined,
					newEnergy: typeof args.newEnergy === 'number' ? args.newEnergy : undefined,
					newMatrixQuadrant: args.newMatrixQuadrant as 'q1' | 'q2' | 'q3' | 'q4' | undefined
				};

				return {
					output: `Proposition de modification de tâche enregistrée (ligne ${lineNumber}).`,
					actionProposals: [proposal]
				};
			}

			case 'propose_decompose_task': {
				const targetPath = normalizePath(String(args.filePath || ''));
				const parentLineNumber = Number(args.parentLineNumber || 1);
				const subtaskStrings = Array.isArray(args.subtasks) ? args.subtasks.map(String) : [];

				const subtasks = subtaskStrings
					.map(title => ({ title: TaskMutator.cleanTaskPrefix(title) }))
					.filter(st => st.title.length > 0);

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'decompose_task',
					description: `🧩 Décomposer la tâche (ligne ${parentLineNumber}) en ${subtasks.length} sous-tâches`,
					selected: true,
					targetPath,
					parentLineNumber,
					subtasks
				};

				return {
					output: `Proposition de décomposition enregistrée (${subtasks.length} sous-tâches).`,
					actionProposals: [proposal]
				};
			}

			case 'propose_link_notes': {
				const targetPath = normalizePath(String(args.sourceFilePath || ''));
				const targetNoteName = String(args.targetNoteName || '');
				const contextExplanation = args.contextExplanation ? String(args.contextExplanation) : undefined;

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'link_notes',
					description: `🔗 Lier "${targetPath}" avec [[${targetNoteName}]]`,
					selected: true,
					targetPath,
					targetNoteName,
					contextExplanation
				};

				return {
					output: `Proposition de liaison avec "[[${targetNoteName}]]" enregistrée.`,
					actionProposals: [proposal]
				};
			}

			case 'propose_move_note': {
				const targetPath = normalizePath(String(args.sourceFilePath || ''));
				const destinationFolder = normalizePath(String(args.destinationFolder || ''));

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'move_note',
					description: `📁 Déplacer "${targetPath}" vers "${destinationFolder}"`,
					selected: true,
					targetPath,
					destinationFolder
				};

				return {
					output: `Proposition de déplacement vers "${destinationFolder}" enregistrée.`,
					actionProposals: [proposal]
				};
			}

			case 'propose_create_calendar_event': {
				const title = String(args.title || 'Nouvel événement');
				const startDate = String(args.startDate || new Date().toISOString().split('T')[0]);
				const startTime = args.startTime ? String(args.startTime) : undefined;
				const endDate = args.endDate ? String(args.endDate) : undefined;
				const endTime = args.endTime ? String(args.endTime) : undefined;
				const description = args.description ? String(args.description) : undefined;
				const location = args.location ? String(args.location) : undefined;
				const calendarId = args.calendarId ? String(args.calendarId) : (this.settings?.defaultCalendarId || 'primary');

				const timeLabel = startTime ? ` à ${startTime}${endTime ? `-${endTime}` : ''}` : ' (toute la journée)';
				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'create_calendar_event',
					description: `📅 Agenda Google : Créer "${title}" le ${startDate}${timeLabel}`,
					selected: true,
					targetPath: 'Google Calendar',
					title,
					startDate,
					startTime,
					endDate,
					endTime,
					eventDescription: description,
					location,
					calendarId
				};

				return {
					output: `Proposition de création d'événement dans l'agenda Google enregistrée : "${title}" le ${startDate}${timeLabel}.`,
					actionProposals: [proposal]
				};
			}

			case 'propose_update_calendar_event': {
				const eventId = String(args.eventId || '');
				const title = args.title ? String(args.title) : undefined;
				const startDate = args.startDate ? String(args.startDate) : undefined;
				const startTime = args.startTime ? String(args.startTime) : undefined;
				const endDate = args.endDate ? String(args.endDate) : undefined;
				const endTime = args.endTime ? String(args.endTime) : undefined;
				const description = args.description ? String(args.description) : undefined;
				const location = args.location ? String(args.location) : undefined;
				const calendarId = args.calendarId ? String(args.calendarId) : (this.settings?.defaultCalendarId || 'primary');

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'update_calendar_event',
					description: `📅 Agenda Google : Mettre à jour l'événement "${title || eventId}"`,
					selected: true,
					targetPath: 'Google Calendar',
					eventId,
					title,
					startDate,
					startTime,
					endDate,
					endTime,
					eventDescription: description,
					location,
					calendarId
				};

				return {
					output: `Proposition de mise à jour de l'événement "${title || eventId}" enregistrée.`,
					actionProposals: [proposal]
				};
			}

			// --- Outils d'Interaction Workspace & Commandes Obsidian ---
			case 'open_note': {
				const filePath = String(args.filePath || '');
				const newLeaf = Boolean(args.newLeaf);
				const lineNumber = typeof args.lineNumber === 'number' ? args.lineNumber : undefined;

				const opened = await this.vaultContext.openNoteInWorkspace(filePath, { newLeaf, lineNumber });
				if (opened) {
					return {
						output: `Note "${filePath}" ouverte avec succès dans l'espace de travail Obsidian${lineNumber ? ` (ligne ${lineNumber})` : ''}${newLeaf ? ' (nouvel onglet)' : ''}.`
					};
				} else {
					return {
						output: `Impossible d'ouvrir la note : fichier introuvable ou inaccessible pour "${filePath}".`
					};
				}
			}

			case 'search_commands': {
				const query = args.query ? String(args.query) : undefined;
				const limit = typeof args.limit === 'number' ? args.limit : 30;

				const cmds = this.vaultContext.searchObsidianCommands(query, limit);
				if (cmds.length === 0) {
					return {
						output: `Aucune commande Obsidian trouvée${query ? ` pour "${query}"` : ''}.`
					};
				}
				const lines = cmds.map(c => `- **${c.name}** (ID: \`${c.id}\`)`);
				return {
					output: `Commandes Obsidian trouvées (${cmds.length}) :\n${lines.join('\n')}`
				};
			}

			case 'execute_command': {
				const commandId = String(args.commandId || '');
				if (!commandId) {
					return { output: 'Erreur: Identifiant ou nom de commande non spécifié.' };
				}

				const res = this.vaultContext.executeObsidianCommand(commandId);
				if (res.success) {
					return {
						output: `Commande "${res.commandName || commandId}" exécutée avec succès dans Obsidian.`
					};
				} else {
					return {
						output: `Échec de l'exécution de la commande "${commandId}" : ${res.error || 'Commande introuvable ou inactive.'}`
					};
				}
			}

			case 'propose_open_note': {
				const filePath = String(args.filePath || '');
				const newLeaf = Boolean(args.newLeaf);
				const lineNumber = typeof args.lineNumber === 'number' ? args.lineNumber : undefined;

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'open_note',
					description: `📖 Ouvrir la note "[[${filePath}]]" dans l'éditeur${newLeaf ? ' (nouvel onglet)' : ''}`,
					selected: true,
					targetPath: filePath,
					newLeaf,
					lineNumber
				};

				return {
					output: `Proposition d'ouverture enregistrée pour "[[${filePath}]]".`,
					actionProposals: [proposal]
				};
			}

			case 'propose_execute_command': {
				const commandId = String(args.commandId || '');

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'execute_command',
					description: `⚡ Exécuter la commande Obsidian "${commandId}"`,
					selected: true,
					targetPath: commandId,
					commandId
				};

				return {
					output: `Proposition d'exécution de commande enregistrée pour "${commandId}".`,
					actionProposals: [proposal]
				};
			}

			default:
				return { output: `Outil inconnu : "${name}".` };
		}
	}
}
