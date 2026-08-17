import { App } from 'obsidian';
import { ChatMessage, LLMConfig } from '../models/llm';
import { LLMService } from './llmService';
import { VaultContextService } from './vaultContextService';
import { ToolRegistry, ToolCallRequest } from './toolRegistry';
import { ActionProposal } from '../models/actions';
import { SecondBrainSettings } from '../main';

export interface AgentStepEvent {
	type: 'searching' | 'reading' | 'thinking' | 'streaming' | 'done';
	message?: string;
	toolName?: string;
}

export interface AgentResponse {
	text: string;
	actionProposals: ActionProposal[];
	executedTools: string[];
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
		this.toolRegistry = new ToolRegistry(this.vaultContext);
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
	public buildSystemPrompt(attachedContextNotes?: Array<{ path: string; title: string; content: string }>): string {
		const today = new Date().toISOString().split('T')[0];
		const energy = this.settings.energyLevel;
		const structure = this.vaultContext.getVaultStructure();
		const toolDocs = ToolRegistry.getSystemPromptToolDocumentation();

		let attachedContextText = '';
		if (attachedContextNotes && attachedContextNotes.length > 0) {
			attachedContextText = '\n\nDOCUMENTS JOINTS EN CONTEXTE PAR L\'UTILISATEUR :\n';
			attachedContextNotes.forEach(note => {
				attachedContextText += `--- Début de la note "${note.title}" (${note.path}) ---\n${note.content}\n--- Fin de la note ---\n\n`;
			});
		}

		return `Tu es l'assistant personnel intelligent "Second Brain Manager" intégré au coffre Obsidian de l'utilisateur.

CONTEXTE EN TEMPS RÉEL DU COFFRE :
- Date du jour : ${today}
- Niveau d'énergie actuel : ${energy}/10 (${energy <= 3 ? 'Mode Économie' : 'Mode Plein Potentiel'})
- Format de priorité matrice : ${this.settings.matrixProvider}
- Dossier Boîte de réception (Inbox) : "${this.settings.inboxFolder}"
- Dossier Journal (Daily notes) : "${this.settings.dailyNotesFolder}"
- Projets existants : ${structure.projects.slice(0, 20).join(', ') || 'Aucun'}
- Contacts existants : ${structure.contacts.slice(0, 20).join(', ') || 'Aucun'}
- Domaines existants : ${structure.domains.slice(0, 20).join(', ') || 'Aucun'}${attachedContextText}

COMPORTEMENT & FLUX D'EXÉCUTION (ReAct Loop) :
1. Si l'utilisateur pose une question nécessitant des données du coffre (ex: "qui est Claire ?", "quelles tâches sont prévues ?", "résume la note X"), émets immédiatement un bloc JSON d'outils de lecture (\`search_vault\`, \`search_tasks\`, \`read_note\`, \`get_note_connections\`).
2. Dès que tu as les données, réponds directement à l'utilisateur de manière naturelle, claire et concise en Markdown.
3. Pour toute action d'écriture (créer une note, ajouter au journal, créer ou modifier une tâche Tasks, relier des fiches), utilise les propositions d'actions (\`propose_create_note\`, \`propose_create_task\`, \`propose_append_to_note\`, \`propose_link_notes\`, etc.).
   - Les tâches doivent TOUJOURS respecter la syntaxe Obsidian Tasks :
     - [ ] Titre de la tâche 📅 YYYY-MM-DD #tm/qN #energie/X [[NomLien]]
   - RÈGLE ESSENTIELLE SUR LES LIENS : Écris TOUJOURS les noms de notes au format wikilink direct [[NomNote]] ou [[Dossier/NomNote]].
     NE METS JAMAIS d'accents graves / backticks autour des wikilinks (Écris [[Claire]] et JAMAIS \\\`[[Claire]]\\\`, sinon les liens ne sont pas cliquables dans Obsidian).

FORMAT DES APPELS D'OUTILS (Ne place AUCUN texte superflu avant le bloc JSON si tu n'as pas encore cherché les infos) :
\`\`\`json
[
  {
    "tool": "nom_outil",
    "arguments": { ... }
  }
]
\`\`\`

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
		onChunk: (chunk: string, fullVisibleText: string) => void
	): Promise<AgentResponse> {
		const messages: ChatMessage[] = [
			{ role: 'system', content: this.buildSystemPrompt(attachedContextNotes) },
			...conversationHistory
		];

		const collectedProposals: ActionProposal[] = [];
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
					const visibleStreamingText = full.replace(/```(?:json)?\s*[\s\S]*?(?:```|$)/g, '').trim();
					if (visibleStreamingText) {
						onChunk(chunk, visibleStreamingText);
					}
				}
			);

			// Extraction des appels d'outils
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
				finalAnswerText = cleanText || currentTurnOutput.replace(/```(?:json)?\s*[\s\S]*?```/g, '').trim();
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

				const res = await this.toolRegistry.executeTool(call);
				readResults.push(`Résultat de ${call.name}(${JSON.stringify(call.arguments)}) :\n${res.output}`);
			}

			const toolFeedbackMessage = `Résultats des recherches dans le coffre :\n\n${readResults.join('\n\n')}\n\nDonne maintenant ta réponse finale complète et bienveillante en Markdown à l'utilisateur, et ajoute si pertinent les propositions d'actions d'écriture (propose_create_note, propose_create_task...).`;

			messages.push({ role: 'user', content: toolFeedbackMessage });
		}

		onStatusUpdate({ type: 'done' });

		return {
			text: finalAnswerText,
			actionProposals: collectedProposals,
			executedTools
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
		const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
		const toolCalls: ToolCallRequest[] = [];
		let cleanText = text;
		let match: RegExpExecArray | null;

		while ((match = jsonBlockRegex.exec(text)) !== null) {
			const jsonString = match[1].trim();
			try {
				const parsed = JSON.parse(jsonString);
				const items = Array.isArray(parsed) ? parsed : [parsed];

				let hasTool = false;
				for (const item of items) {
					const name = item.tool || item.name;
					const args = item.arguments || item.args || item.parameters || {};

					if (name && typeof name === 'string') {
						toolCalls.push({ name, arguments: args });
						hasTool = true;
					}
				}

				if (hasTool) {
					cleanText = cleanText.replace(match[0], '').trim();
				}
			} catch {
				// Pas un bloc tool JSON
			}
		}

		return { toolCalls, cleanText: cleanText.trim() };
	}
}
