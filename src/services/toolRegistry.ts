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
			description: 'Recherche des tâches Markdown Tasks existantes avec filtres (échéance, énergie, quadrant, statut).',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Texte contenu dans la tâche.' },
					status: { type: 'string', description: 'Statut de la tâche', enum: ['todo', 'done', 'in-progress', 'cancelled', 'all'] },
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
			description: 'Recherche globale dans l\'agenda Google par mot-clé, période, participant ou lieu.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Terme de recherche (sujet, personne, lieu).' },
					startDate: { type: 'string', description: 'Date de début (YYYY-MM-DD).' },
					endDate: { type: 'string', description: 'Date de fin (YYYY-MM-DD).' },
					location: { type: 'string', description: 'Filtre lieu.' },
					attendee: { type: 'string', description: 'Filtre participant.' },
					calendarId: { type: 'string', description: 'ID d\'un agenda ou "all".' },
					includePast: { type: 'boolean', description: 'Inclure le passé.' }
				},
				required: []
			}
		},

		// 2. Outils de Proposition d'Écriture (soumis à validation utilisateur)
		{
			name: 'propose_create_note',
			description: 'Propose la création d\'une nouvelle note (ex: fiche contact dans "03 - Contacts", compte-rendu, etc.).',
			parameters: {
				type: 'object',
				properties: {
					folder: { type: 'string', description: 'Dossier cible (ex: "03 - Contacts", "01 - Projets", "00 - Inbox").' },
					fileName: { type: 'string', description: 'Nom du fichier sans ou avec extension .md (ex: "Claire Dupont").' },
					content: { type: 'string', description: 'Contenu Markdown complet de la note.' },
					tags: { type: 'array', description: 'Tags à ajouter à la note.', items: { type: 'string' } }
				},
				required: ['folder', 'fileName', 'content']
			}
		},
		{
			name: 'propose_append_to_note',
			description: 'Propose d\'ajouter une entrée ou un compte-rendu dans une note existante ou la note quotidienne.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Chemin du fichier (ex: "04 - Journal/2026-08-17.md").' },
					entryText: { type: 'string', description: 'Texte formaté à ajouter.' },
					section: { type: 'string', description: 'Titre de la section sous laquelle insérer (optionnel).' }
				},
				required: ['filePath', 'entryText']
			}
		},
		{
			name: 'propose_create_task',
			description: 'Propose la création d\'une tâche Markdown canonique compatible Obsidian Tasks dans un fichier.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Fichier cible où insérer la tâche.' },
					taskTitle: { type: 'string', description: 'Intitulé brut de la tâche, sans case à cocher ni puce de liste (ex: "Rédiger le rapport").' },
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
			description: 'Propose la modification d\'une tâche existante (date, statut, quadrant, énergie, priorité).',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Fichier contenant la tâche.' },
					lineNumber: { type: 'number', description: 'Numéro de ligne de la tâche (1-indexé).' },
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
			description: 'Propose le découpage d\'une tâche complexe en sous-tâches ordonnées.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'Fichier contenant la tâche parente.' },
					parentLineNumber: { type: 'number', description: 'Ligne de la tâche parente.' },
					subtasks: {
						type: 'array',
						description: 'Liste des intitulés bruts des sous-tâches décomposées, sans cases à cocher "- [ ]" ni puces (ex: ["Étape 1", "Étape 2"]).',
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
			description: 'Propose de déplacer une note (ex: de l\'Inbox vers un dossier Domaine ou Projet).',
			parameters: {
				type: 'object',
				properties: {
					sourceFilePath: { type: 'string', description: 'Chemin actuel du fichier.' },
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
					status: args.status as 'todo' | 'done' | 'in-progress' | 'cancelled' | 'all',
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
				if (!res) return { output: `Erreur: Note introuvable à l'emplacement "${filePath}".` };
				return { output: JSON.stringify(res, null, 2) };
			}

			case 'get_note_connections': {
				const filePath = String(args.filePath || '');
				const res = await this.vaultContext.getNoteConnections(filePath);
				if (!res) return { output: `Erreur: Note introuvable pour "${filePath}".` };
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

					const timeMin = startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined;
					const timeMax = endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined;

					const events = await GoogleCalendarService.getEvents(this.settings, {
						timeMin,
						timeMax,
						query,
						location,
						attendee,
						calendarIds: calendarId ? [calendarId] : undefined,
						includePast,
						maxResults
					});

					if (events.length === 0) {
						return {
							output: 'Aucun événement Google Calendar trouvé correspondant aux critères spécifiés.'
						};
					}

					const formatted = events.map(ev => {
						const start = ev.start.dateTime || ev.start.date;
						const end = ev.end.dateTime || ev.end.date;
						const timeInfo = ev.allDay ? 'Toute la journée' : `${start?.split('T')[1]?.slice(0, 5) || ''} - ${end?.split('T')[1]?.slice(0, 5) || ''}`;
						let line = `- [Agenda: ${ev.calendarName || 'Principal'}] ${ev.start.date || start?.split('T')[0]} (${timeInfo}) : **${ev.summary}** (ID: \`${ev.id}\`)`;
						if (ev.location) line += ` | 📍 Lieu : ${ev.location}`;
						if (ev.description) line += ` | 📝 Notes : ${ev.description.replace(/\n+/g, ' ').slice(0, 150)}`;
						if (ev.attendees && ev.attendees.length > 0) {
							const attNames = ev.attendees.map(a => a.displayName || a.email).join(', ');
							line += ` | 👥 Participants : ${attNames}`;
						}
						return line;
					}).join('\n');

					return {
						output: `Événements Google Calendar trouvés (${events.length}) :\n${formatted}`
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
				const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;

				const proposal: ActionProposal = {
					id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
					type: 'create_note',
					description: `📄 Créer la note "${fileName}" dans "${folder}"`,
					selected: true,
					targetPath,
					folder,
					fileName,
					content,
					tags
				};

				return {
					output: `Proposition de création enregistrée pour "${targetPath}".`,
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
				const calendarId = args.calendarId ? String(args.calendarId) : undefined;

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
				const calendarId = args.calendarId ? String(args.calendarId) : undefined;

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

			default:
				return { output: `Outil inconnu : "${name}".` };
		}
	}
}
