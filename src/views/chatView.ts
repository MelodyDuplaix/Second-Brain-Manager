import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, MarkdownView, normalizePath, TFile, setIcon } from 'obsidian';
import { ChatMessage, LLMConfig } from '../models/llm';
import { AgentOrchestrator } from '../services/agentOrchestrator';
import { ActionExecutor } from '../services/actionExecutor';
import { ActionPreviewWidget } from './actionPreviewWidget';
import { TaskCardWidget } from './taskCardWidget';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { VaultContextService } from '../services/vaultContextService';
import { ContextPickerModal, ContextItem } from '../modals/contextPickerModal';
import { ModelPickerModal } from '../modals/modelPickerModal';
import { SecretsManagementModal } from '../modals/secretsManagementModal';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_CHAT = 'sbm-chat-view';

export class ChatView extends ItemView {
	private plugin: SecondBrainPlugin;
	private messages: ChatMessage[] = [];
	private isGenerating = false;
	private messagesContainerEl: HTMLElement | null = null;
	private sendBtnEl: HTMLButtonElement | null = null;
	private textareaEl: HTMLTextAreaElement | null = null;
	private cardTopContextEl: HTMLElement | null = null;
	private currentAbortController: AbortController | null = null;

	private orchestrator: AgentOrchestrator;
	private actionExecutor: ActionExecutor;
	private attachedContexts: ContextItem[] = [];
	private editingMessageIndex: number | null = null;
	private lastActiveFile: TFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.orchestrator = new AgentOrchestrator(this.app, this.plugin.settings);
		this.actionExecutor = new ActionExecutor(this.app, this.plugin.settings);

		this.messages = [
			{
				role: 'assistant',
				content: 'Bonjour ! Je suis votre assistant Second Brain. Vous pouvez me poser des questions sur votre coffre, me raconter une réunion pour créer automatiquement des fiches et des tâches, ou me demander un briefing.',
				timestamp: new Date().toISOString()
			}
		];
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return 'Assistant IA';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.workspace.on('file-open', (file) => {
			if (file instanceof TFile) {
				this.lastActiveFile = file;
				this.renderContextInsideCard();
			}
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			if (leaf && leaf.view instanceof MarkdownView && leaf.view.file instanceof TFile) {
				this.lastActiveFile = leaf.view.file;
				this.renderContextInsideCard();
			}
		}));
		await this.render();
	}

	async onClose(): Promise<void> {
		this.cancelCurrentGeneration();
		return super.onClose();
	}

	/**
	 * Charge une conversation existante et lance automatiquement la génération si autoTrigger est vrai.
	 */
	public async setConversation(messages: ChatMessage[], autoTrigger = false): Promise<void> {
		this.cancelCurrentGeneration();
		this.messages = [...messages];
		this.renderFullMessages();
		if (autoTrigger) {
			await this.triggerAssistantGeneration();
		}
	}

	private cancelCurrentGeneration(): void {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}
		this.isGenerating = false;
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('sbm-chat-container');

		// Header avec titre et bouton d'effacement
		const headerEl = container.createEl('div', { cls: 'sbm-chat-header' });
		const titleRow = headerEl.createEl('div', { cls: 'sbm-chat-title-row' });
		
		const titleLeft = titleRow.createEl('div', { cls: 'sbm-chat-title-left' });
		titleLeft.createEl('h2', { text: 'Assistant IA' });

		const clearBtn = titleRow.createEl('button', { cls: 'sbm-chat-clear-btn' });
		setIcon(clearBtn, 'trash-2');
		clearBtn.title = 'Effacer la conversation';
		clearBtn.addEventListener('click', () => {
			this.cancelCurrentGeneration();
			this.messages = [
				{
					role: 'assistant',
					content: 'Conversation réinitialisée. En quoi puis-je vous être utile ?',
					timestamp: new Date().toISOString()
				}
			];
			this.attachedContexts = [];
			this.editingMessageIndex = null;
			this.renderFullMessages();
			this.renderContextInsideCard();
		});

		// Zone de messages scrollable
		this.messagesContainerEl = container.createEl('div', { cls: 'sbm-messages-area' });

		// Délégation globale de clics : résout les wikilinks cliquables sans bloquer la sélection de texte
		this.messagesContainerEl.addEventListener('click', async (e: MouseEvent) => {
			// Si l'utilisateur est en train de sélectionner du texte avec la souris, ne rien faire
			const selection = window.getSelection();
			if (selection && selection.toString().trim().length > 0) {
				return;
			}

			const target = e.target as HTMLElement;
			const linkEl = target.closest('a.internal-link, .sbm-clickable-link, a') as HTMLElement | null;

			if (linkEl) {
				let href = linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || linkEl.textContent || '';
				const wikiMatch = href.match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/);
				if (wikiMatch) {
					href = wikiMatch[1];
				}

				if (href && !href.startsWith('http://') && !href.startsWith('https://')) {
					e.preventDefault();
					const cleanPath = href.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim();
					await this.app.workspace.openLinkText(cleanPath, '', false);
				}
			}
		});

		this.renderFullMessages();

		// Conteneur de saisie unifié Copilot (cadre fluide et intégré)
		const inputCard = container.createEl('div', { cls: 'sbm-chat-input-card' });

		// 1. Barre de contexte intégrée DANS le cadre en haut
		this.cardTopContextEl = inputCard.createEl('div', { cls: 'sbm-card-top-context' });
		this.renderContextInsideCard();

		// 2. Zone de texte fluide
		this.textareaEl = inputCard.createEl('textarea', {
			cls: 'sbm-chat-textarea',
			placeholder: 'Votre assistant IA pour Obsidian • @ pour ajouter du contexte • / pour les commandes'
		});

		// 3. Barre d'outils inférieure intégrée DANS le cadre
		const inputBottomBar = inputCard.createEl('div', { cls: 'sbm-input-bottom-bar' });

		const inputLeftActions = inputBottomBar.createEl('div', { cls: 'sbm-input-left-actions' });

		const currentModelBtn = inputLeftActions.createEl('button', {
			cls: 'sbm-input-model-btn',
			text: `⚡ ${this.plugin.settings.llmModel || this.plugin.settings.llmProvider} ▾`
		});
		currentModelBtn.title = 'Cliquer pour changer de modèle ou de fournisseur IA';

		const openModelModal = () => {
			new ModelPickerModal(this.app, this.plugin, (selected) => {
				currentModelBtn.setText(`⚡ ${selected.name} ▾`);
			}).open();
		};

		currentModelBtn.addEventListener('click', openModelModal);

		this.sendBtnEl = inputBottomBar.createEl('button', {
			cls: 'sbm-chat-send-btn mod-cta'
		});
		setIcon(this.sendBtnEl, 'arrow-up');
		this.sendBtnEl.title = 'Envoyer (Entrée)';

		this.sendBtnEl.addEventListener('click', () => this.handleSendMessage());

		this.textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSendMessage();
			} else if (e.key === '@') {
				setTimeout(() => {
					new ContextPickerModal(this.app, (item) => {
						this.addContextItem(item);
						if (this.textareaEl) {
							this.textareaEl.value = this.textareaEl.value.replace(/@\s*$/, '');
							this.textareaEl.focus();
						}
					}, this.plugin.settings).open();
				}, 10);
			}
		});

		setTimeout(() => {
			if (this.textareaEl) this.textareaEl.focus();
		}, 30);
	}

	private renderContextInsideCard(): void {
		if (!this.cardTopContextEl) return;
		this.cardTopContextEl.empty();

		const leftPills = this.cardTopContextEl.createEl('div', { cls: 'sbm-card-context-left' });
		const filterService = this.orchestrator.getVaultContext().getFilterService();

		// Bouton "+ @ Add context"
		const addContextBtn = leftPills.createEl('button', {
			cls: 'sbm-card-add-context-btn',
			text: '@ Add context'
		});
		addContextBtn.title = 'Joindre une note, un contact, un projet ou un dossier';
		addContextBtn.addEventListener('click', () => {
			new ContextPickerModal(this.app, (item) => {
				this.addContextItem(item);
			}, this.plugin.settings).open();
		});

		// Recherche de la note active ou de la dernière note ouverte
		let activeFile: TFile | null = this.lastActiveFile || this.app.workspace.getActiveFile();
		if (!activeFile) {
			const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of mdLeaves) {
				const view = leaf.view as MarkdownView;
				if (view && view.file instanceof TFile) {
					activeFile = view.file;
					break;
				}
			}
		}
		if (!activeFile) {
			const recentFiles = this.app.vault.getMarkdownFiles();
			if (recentFiles.length > 0) {
				activeFile = recentFiles.sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
			}
		}

		if (activeFile && !filterService.isFileExcluded(activeFile)) {
			const isAlreadyAttached = this.attachedContexts.some(c => c.path === activeFile?.path);
			if (!isAlreadyAttached) {
				const activeNoteBtn = leftPills.createEl('button', {
					cls: 'sbm-card-active-note-pill',
					text: `+ Note active (${activeFile.basename})`
				});
				activeNoteBtn.title = `Cliquer pour inclure [[${activeFile.basename}]] dans le contexte`;
				const fileToAdd = activeFile;
				activeNoteBtn.addEventListener('click', () => {
					this.addContextItem({
						type: 'active-note',
						path: normalizePath(fileToAdd.path),
						title: fileToAdd.basename,
						desc: fileToAdd.path
					});
				});
			}
		}

		// Rendu des pilules de contexte sélectionnées
		this.attachedContexts.forEach((ctx, index) => {
			const pill = leftPills.createEl('span', { cls: 'sbm-context-pill' });
			const icon = ctx.type === 'folder' ? '📁' : ctx.type === 'active-note' ? '⚡' : '📄';
			pill.createEl('span', { text: `${icon} ${ctx.title}`, cls: 'sbm-pill-text' });

			const removeBtn = pill.createEl('span', { cls: 'sbm-pill-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.title = 'Retirer ce contexte';
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.attachedContexts.splice(index, 1);
				this.renderContextInsideCard();
			});
		});
	}

	private addContextItem(item: ContextItem): void {
		if (!this.attachedContexts.some(c => c.path === item.path)) {
			this.attachedContexts.push(item);
			this.renderContextInsideCard();
			new Notice(`Contexte joint : ${item.title}`);
		}
	}

	private renderFullMessages(): void {
		if (!this.messagesContainerEl) return;
		this.messagesContainerEl.empty();

		if (this.messages.length <= 1) {
			this.renderSuggestedPrompts(this.messagesContainerEl);
		}

		this.messages.forEach((msg, idx) => {
			if (msg.role === 'system') return;
			this.renderSingleMessageElement(msg, idx);
		});

		this.scrollToBottom();
	}

	private renderSuggestedPrompts(container: HTMLElement): void {
		const suggestionsBox = container.createEl('div', { cls: 'sbm-suggested-prompts-box' });
		suggestionsBox.createEl('div', { cls: 'sbm-suggested-title', text: 'Suggested Prompts' });

		const prompts = [
			{
				title: 'Active Note Insights',
				desc: 'Analyse en détail la note ouverte et propose des actions concrètes',
				prompt: 'Analyse la note actuellement ouverte dans mon coffre, extrais les points clés, décisions et tâches à prévoir.'
			},
			{
				title: 'Contacts & Meeting Review',
				desc: 'Retrouve les interactions passées et propose des synthèses',
				prompt: 'Fais-moi un récapitulatif de mes contacts récents et des réunions enregistrées dans mon coffre.'
			},
			{
				title: 'Daily Focus & Priorities',
				desc: 'Organise ma journée selon mon niveau d\'énergie actuel',
				prompt: 'Quel est mon programme prioritaire pour aujourd\'hui selon mon énergie et mes échéances ?'
			}
		];

		const grid = suggestionsBox.createEl('div', { cls: 'sbm-suggested-grid' });
		prompts.forEach(p => {
			const card = grid.createEl('div', { cls: 'sbm-suggested-card' });
			const topRow = card.createEl('div', { cls: 'sbm-suggested-card-header' });
			topRow.createEl('div', { cls: 'sbm-suggested-card-title', text: p.title });
			const iconSpan = topRow.createEl('span', { cls: 'sbm-suggested-card-icon' });
			setIcon(iconSpan, 'plus-circle');

			card.createEl('div', { cls: 'sbm-suggested-card-desc', text: p.desc });

			card.addEventListener('click', () => {
				if (this.textareaEl) {
					this.textareaEl.value = p.prompt;
					this.handleSendMessage();
				}
			});
		});
	}

	private cleanWikilinkSyntax(rawText: string): string {
		// Supprime les accents graves/backticks autour des wikilinks (ex: `[[Claire]]` -> [[Claire]])
		return rawText.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
	}

	private renderSingleMessageElement(msg: ChatMessage, msgIndex: number): HTMLElement {
		if (!this.messagesContainerEl) return document.createElement('div');

		const msgEl = this.messagesContainerEl.createEl('div', {
			cls: `sbm-chat-msg ${msg.role}`
		});

		const bubbleEl = msgEl.createEl('div', { cls: 'sbm-msg-bubble' });

		// Mode Édition In-Place
		if (this.editingMessageIndex === msgIndex) {
			const editBox = bubbleEl.createDiv({ cls: 'sbm-inline-edit-box' });
			const editTextarea = editBox.createEl('textarea', { cls: 'sbm-inline-edit-textarea' });
			editTextarea.value = msg.content;

			const editActions = editBox.createDiv({ cls: 'sbm-inline-edit-actions' });
			
			const saveBtn = editActions.createEl('button', {
				cls: 'sbm-inline-save-btn mod-cta',
				text: 'Enregistrer et soumettre'
			});

			const cancelBtn = editActions.createEl('button', {
				cls: 'sbm-inline-cancel-btn',
				text: 'Annuler'
			});

			saveBtn.addEventListener('click', async () => {
				const newText = editTextarea.value.trim();
				if (!newText) return;

				this.messages[msgIndex].content = newText;
				// Tronque l'historique après ce message pour regénérer la suite
				this.messages.splice(msgIndex + 1);
				this.editingMessageIndex = null;
				this.renderFullMessages();

				// Relance la génération de l'assistant à partir de cette modification
				await this.triggerAssistantGeneration();
			});

			cancelBtn.addEventListener('click', () => {
				this.editingMessageIndex = null;
				this.renderFullMessages();
			});

			setTimeout(() => editTextarea.focus(), 30);
			return bubbleEl;
		}

		// Contenu Markdown normal (nettoyé de tout backtick parasite autour des liens)
		const textContentEl = bubbleEl.createEl('div', { cls: 'sbm-msg-text-content' });
		if (msg.content) {
			const cleanedContent = this.cleanWikilinkSyntax(msg.content);
			MarkdownRenderer.render(this.app, cleanedContent, textContentEl, '', this);

			// Intégration in-place des widgets de tâches au cœur du message
			if (msg.role === 'assistant') {
				this.upgradeTaskElementsInPlace(textContentEl, msg.content, msg.tasks);

				if (msg.proposals && msg.proposals.length > 0) {
					ActionPreviewWidget.render(bubbleEl, msg.proposals, this.actionExecutor, this.app);

					const noteCreations = msg.proposals.filter(p => p.type === 'create_note');
					if (noteCreations.length > 0) {
						const directButtonsContainer = bubbleEl.createDiv({ cls: 'sbm-direct-open-note-container' });
						noteCreations.forEach(nc => {
							const createProp = nc as any;
							const targetPath = createProp.targetPath || (createProp.folder ? `${createProp.folder}/${createProp.fileName}` : createProp.fileName);
							const cleanName = createProp.fileName?.replace(/\.md$/, '') || targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Note';
							const btn = directButtonsContainer.createEl('button', {
								cls: 'sbm-direct-open-note-btn',
								text: `📄 Ouvrir la note : ${cleanName}`
							});
							btn.title = `Ouvrir ${targetPath} directement dans l'éditeur`;
							btn.addEventListener('click', async () => {
								await ActionPreviewWidget.openNote(this.app, targetPath);
							});
						});
					}
				}
			}
		}

		// Barre de métadonnées et actions (Copilot-like)
		const metaBar = bubbleEl.createEl('div', { cls: 'sbm-msg-meta-bar' });

		const timeText = msg.timestamp
			? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
			: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		metaBar.createEl('span', { cls: 'sbm-msg-time', text: timeText });

		const actionsGroup = metaBar.createEl('div', { cls: 'sbm-msg-actions-group' });

		// 1. Bouton Copier
		const copyBtn = actionsGroup.createEl('button', { cls: 'sbm-msg-action-icon-btn' });
		setIcon(copyBtn, 'copy');
		copyBtn.title = 'Copier le message';
		copyBtn.addEventListener('click', async () => {
			await navigator.clipboard.writeText(msg.content);
			new Notice('Message copié dans le presse-papier !');
			setIcon(copyBtn, 'check');
			setTimeout(() => setIcon(copyBtn, 'copy'), 1500);
		});

		// 2. Bouton Éditer (pour messages utilisateur -> édition in-place)
		if (msg.role === 'user') {
			const editBtn = actionsGroup.createEl('button', { cls: 'sbm-msg-action-icon-btn' });
			setIcon(editBtn, 'pencil');
			editBtn.title = 'Modifier ce message à cet emplacement';
			editBtn.addEventListener('click', () => {
				this.editingMessageIndex = msgIndex;
				this.renderFullMessages();
			});
		}

		// 3. Bouton Régénérer (pour messages assistant)
		if (msg.role === 'assistant' && msgIndex > 0) {
			const regenBtn = actionsGroup.createEl('button', { cls: 'sbm-msg-action-icon-btn' });
			setIcon(regenBtn, 'rotate-cw');
			regenBtn.title = 'Régénérer cette réponse';
			regenBtn.addEventListener('click', async () => {
				this.messages.splice(msgIndex); // Retire cette réponse et les suivantes
				this.renderFullMessages();
				await this.triggerAssistantGeneration();
			});
		}

		// 4. Bouton Supprimer (Actif sur TOUS les messages : utilisateur ET assistant)
		const delBtn = actionsGroup.createEl('button', { cls: 'sbm-msg-action-icon-btn' });
		setIcon(delBtn, 'trash');
		delBtn.title = 'Supprimer ce message';
		delBtn.addEventListener('click', () => {
			this.messages.splice(msgIndex, 1);
			if (this.messages.length === 0) {
				this.messages = [
					{
						role: 'assistant',
						content: 'Conversation réinitialisée. En quoi puis-je vous être utile ?',
						timestamp: new Date().toISOString()
					}
				];
			}
			this.renderFullMessages();
			new Notice('Message supprimé.');
		});

		return bubbleEl;
	}

	private isTaskMatch(text: string, vaultTitle: string): boolean {
		const stopWords = new Set([
			'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'a', 'à', 'pour', 'dans', 'en', 'par',
			'sur', 'et', 'ou', 'ce', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son',
			'sa', 'ses', 'the', 'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by', 'about'
		]);

		const clean = (str: string) =>
			str
				.toLowerCase()
				.replace(/\[\[([^\]]+)\]\]/g, '$1')
				.replace(/#[\w/_-]+/g, '')
				.replace(/📅[^\s]+|⚡[^\s]+|\(énergie\s*:[^)]+\)/gi, '')
				.replace(/[^\p{L}\p{N}]+/gu, ' ')
				.trim();

		const cleanText = clean(text);
		const cleanVault = clean(vaultTitle);

		if (!cleanText || !cleanVault) return false;

		const getWords = (s: string) =>
			s.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));

		const wordsA = getWords(cleanText);
		const wordsB = getWords(cleanVault);

		if (wordsA.length === 0 || wordsB.length === 0) return false;

		// Si le texte est un long paragraphe explicatif (> 25 mots), ce n'est pas une simple tâche
		if (wordsA.length > 25 && wordsA.length > wordsB.length * 3) return false;

		// 1. Inclusion directe
		if (cleanText.includes(cleanVault) || cleanVault.includes(cleanText)) return true;

		// 2. Mots-clés en commun
		const common = wordsA.filter(w => wordsB.includes(w));
		const matchRatio = common.length / wordsB.length;

		return matchRatio >= 0.6 || (common.length >= 2 && wordsB.length <= 3 && matchRatio >= 0.5);
	}

	private async upgradeTaskElementsInPlace(
		textContentEl: HTMLElement,
		content: string,
		attachedTasks?: ObsidianTask[]
	): Promise<void> {
		// 1. Récupère les tâches du coffre
		let vaultTasks: ObsidianTask[] = attachedTasks && attachedTasks.length > 0 ? attachedTasks : [];
		if (vaultTasks.length === 0) {
			try {
				const vaultContext = new VaultContextService(this.app, this.plugin.settings);
				vaultTasks = await vaultContext.searchTasks({});
			} catch {
				vaultTasks = [];
			}
		}

		let upgradedCount = 0;
		const usedTaskIds = new Set<string>();

		// A. Traitement des blocs de code <pre> contenant des tâches Markdown
		const preElements = Array.from(textContentEl.querySelectorAll('pre'));
		preElements.forEach(pre => {
			if (pre.closest('.sbm-inline-task-wrapper') || pre.closest('.sbm-chat-task-card') || pre.closest('.sbm-chat-tasks-container')) return;
			const rawText = pre.textContent || '';
			const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

			const taskLines: ObsidianTask[] = [];
			lines.forEach(line => {
				// Recherche match dans les tâches du coffre
				const matched = vaultTasks.find(vt => {
					const taskId = `${vt.filePath}:${vt.lineNumber}`;
					if (usedTaskIds.has(taskId)) return false;
					return this.isTaskMatch(line, vt.title);
				});

				if (matched) {
					usedTaskIds.add(`${matched.filePath}:${matched.lineNumber}`);
					taskLines.push(matched);
				} else if (/^\[[ xX/]\]|^[-*0-9.]+\s*\[[ xX/]\]/.test(line) || (line.includes('📅') && line.includes('#tm/'))) {
					const cleanLine = TaskMutator.cleanTaskPrefix(line);
					const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
					if (parsed) taskLines.push(parsed);
				}
			});

			if (taskLines.length > 0) {
				const tasksContainer = document.createElement('div');
				tasksContainer.className = 'sbm-chat-tasks-container';
				taskLines.forEach(t => {
					TaskCardWidget.render(tasksContainer, t, this.plugin, () => {
						this.renderFullMessages();
					});
					upgradedCount++;
				});
				pre.replaceWith(tasksContainer);
			}
		});

		// B. Traitement des tableaux markdown <table> contenant des tâches
		const tableElements = Array.from(textContentEl.querySelectorAll('table'));
		tableElements.forEach(table => {
			if (table.closest('.sbm-inline-task-wrapper') || table.closest('.sbm-chat-task-card') || table.closest('.sbm-chat-tasks-container')) return;
			const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter(r => !r.closest('thead'));
			if (rows.length === 0) return;

			const rowTasks: ObsidianTask[] = [];
			rows.forEach(row => {
				const cells = Array.from(row.querySelectorAll('td, th'));
				if (cells.length === 0) return;
				const rowText = cells.map(c => c.textContent || '').join(' ');

				const matched = vaultTasks.find(vt => {
					const taskId = `${vt.filePath}:${vt.lineNumber}`;
					if (usedTaskIds.has(taskId)) return false;
					return this.isTaskMatch(rowText, vt.title);
				});

				if (matched) {
					usedTaskIds.add(`${matched.filePath}:${matched.lineNumber}`);
					rowTasks.push(matched);
				}
			});

			// Si au moins une ligne du tableau correspond à une tâche du coffre
			if (rowTasks.length > 0) {
				const tasksContainer = document.createElement('div');
				tasksContainer.className = 'sbm-chat-tasks-container';
				rowTasks.forEach(t => {
					TaskCardWidget.render(tasksContainer, t, this.plugin, () => {
						this.renderFullMessages();
					});
					upgradedCount++;
				});
				table.replaceWith(tasksContainer);
			}
		});

		// C. Recherche dans tous les <li> et <p> candidats
		const candidateElements = Array.from(textContentEl.querySelectorAll('li, p'));

		candidateElements.forEach(el => {
			if (el.closest('.sbm-inline-task-wrapper') || el.closest('.sbm-chat-task-card') || el.closest('.sbm-chat-tasks-container')) return;

			// Si c'est un parent <li> contenant d'autres <li>, ignorer (on ne traite que les feuilles)
			if (el.tagName.toLowerCase() === 'li' && el.querySelector('li') !== null) return;

			const text = el.textContent || '';
			if (!text.trim()) return;

			// Si c'est un paragraphe <p>, on n'analyse QUE s'il commence par une puce ou contient des marqueurs explicites de tâche
			if (el.tagName.toLowerCase() === 'p') {
				const isTaskLike =
					/^[-*0-9.]+\s*\[[ xX/]\]/.test(text.trim()) ||
					text.includes('📅') ||
					text.includes('⚡') ||
					text.includes('#tm/') ||
					text.includes('#energie/');
				if (!isTaskLike) return;
			}

			// Recherche par similarité floue avec les tâches du coffre
			const matched = vaultTasks.find(vt => {
				const taskId = `${vt.filePath}:${vt.lineNumber}`;
				if (usedTaskIds.has(taskId)) return false;
				return this.isTaskMatch(text, vt.title);
			});

			if (matched) {
				const taskId = `${matched.filePath}:${matched.lineNumber}`;
				usedTaskIds.add(taskId);

				const wrapper = document.createElement('div');
				wrapper.className = 'sbm-inline-task-wrapper';
				TaskCardWidget.render(wrapper, matched, this.plugin, () => {
					this.renderFullMessages();
				});
				el.replaceWith(wrapper);
				upgradedCount++;
			} else if (
				/^\[[ xX/]\]/.test(text.trim()) ||
				el.classList.contains('task-list-item') ||
				el.querySelector('input[type="checkbox"]') !== null ||
				(text.includes('📅') && (text.includes('⚡') || text.includes('#tm/')))
			) {
				const cleanLine = TaskMutator.cleanTaskPrefix(text);
				const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
				if (parsed) {
					const wrapper = document.createElement('div');
					wrapper.className = 'sbm-inline-task-wrapper';
					TaskCardWidget.render(wrapper, parsed, this.plugin, () => {
						this.renderFullMessages();
					});
					el.replaceWith(wrapper);
					upgradedCount++;
				}
			}
		});

		// D. Fallback : Si des tâches spécifiques ont été trouvées mais qu'aucune n'a été matchée
		if (upgradedCount === 0 && attachedTasks && attachedTasks.length > 0) {
			const tasksContainer = textContentEl.createDiv({ cls: 'sbm-chat-tasks-container' });
			attachedTasks.forEach(task => {
				TaskCardWidget.render(tasksContainer, task, this.plugin, () => {
					this.renderFullMessages();
				});
			});
		}
	}

	private scrollToBottom(): void {
		if (this.messagesContainerEl) {
			this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
		}
	}

	private async handleSendMessage(): Promise<void> {
		if (!this.textareaEl) return;

		if (this.isGenerating) {
			this.cancelCurrentGeneration();
			if (this.sendBtnEl) setIcon(this.sendBtnEl, 'arrow-up');
			return;
		}

		const text = this.textareaEl.value.trim();
		if (!text) return;

		// 1. Ajouter le message utilisateur
		this.messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
		this.renderFullMessages();

		this.textareaEl.value = '';
		await this.triggerAssistantGeneration();
	}

	private async triggerAssistantGeneration(): Promise<void> {
		this.isGenerating = true;
		if (this.sendBtnEl) {
			setIcon(this.sendBtnEl, 'square');
			this.sendBtnEl.title = 'Arrêter la génération';
		}

		// Préparation de la bulle assistant avec spinner animé
		const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: new Date().toISOString() };
		this.messages.push(assistantMsg);

		if (!this.messagesContainerEl) return;
		const msgEl = this.messagesContainerEl.createEl('div', { cls: 'sbm-chat-msg assistant' });
		const bubbleEl = msgEl.createEl('div', { cls: 'sbm-msg-bubble sbm-msg-streaming' });

		const thinkingBox = bubbleEl.createEl('div', { cls: 'sbm-thinking-box' });
		const spinnerIcon = thinkingBox.createEl('div', { cls: 'sbm-thinking-spinner' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });

		const thinkingLabel = thinkingBox.createEl('span', {
			cls: 'sbm-thinking-label',
			text: 'Réflexion en cours...'
		});

		const textContentEl = bubbleEl.createEl('div', { cls: 'sbm-msg-text-content' });
		this.scrollToBottom();

		this.currentAbortController = new AbortController();

		try {
			const apiKey = await this.plugin.getSecretApiKey(this.plugin.settings.llmProvider);
			const config: LLMConfig = {
				provider: this.plugin.settings.llmProvider,
				endpoint: this.plugin.settings.llmEndpoint,
				model: this.plugin.settings.llmModel,
				productId: this.plugin.settings.infomaniakProductId,
				apiKey,
				signal: this.currentAbortController.signal
			};

			const attachedNotesData: Array<{ path: string; title: string; content: string }> = [];
			for (const ctx of this.attachedContexts) {
				const file = this.app.vault.getFileByPath(ctx.path) || this.app.vault.getAbstractFileByPath(ctx.path);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					attachedNotesData.push({
						path: ctx.path,
						title: file.basename,
						content: content.slice(0, 4000)
					});
				}
			}

			let currentActiveFile: TFile | null = this.lastActiveFile || this.app.workspace.getActiveFile();
			if (!currentActiveFile) {
				const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
				for (const leaf of mdLeaves) {
					const view = leaf.view as MarkdownView;
					if (view && view.file instanceof TFile) {
						currentActiveFile = view.file;
						break;
					}
				}
			}

			const agentResponse = await this.orchestrator.executeAgentLoop(
				this.messages.slice(0, -1),
				config,
				attachedNotesData,
				(status) => {
					if (status.type === 'searching' && status.message) {
						thinkingLabel.setText(`🔍 ${status.message}`);
					} else if (status.type === 'thinking') {
						thinkingLabel.setText('🧠 Synthèse des informations...');
					} else if (status.type === 'done') {
						thinkingBox.remove();
					}
					this.scrollToBottom();
				},
				(_chunk, fullVisibleText) => {
					const cleaned = this.cleanWikilinkSyntax(fullVisibleText);
					textContentEl.setText(cleaned);
					this.scrollToBottom();
				},
				currentActiveFile
			);

			bubbleEl.removeClass('sbm-msg-streaming');
			thinkingBox.remove();

			if (agentResponse.executedTools && agentResponse.executedTools.length > 0) {
				const toolBadge = bubbleEl.createEl('div', { cls: 'sbm-executed-tools-badge' });
				toolBadge.createEl('span', { text: `🔍 ${agentResponse.executedTools.length} recherche(s) effectuée(s)` });
				toolBadge.title = agentResponse.executedTools.join('\n');
			}

			textContentEl.empty();
			if (agentResponse.text) {
				const cleanedText = this.cleanWikilinkSyntax(agentResponse.text);
				await MarkdownRenderer.render(this.app, cleanedText, textContentEl, '', this);
				assistantMsg.content = cleanedText;
			}

			if (agentResponse.relevantTasks && agentResponse.relevantTasks.length > 0) {
				assistantMsg.tasks = agentResponse.relevantTasks;
			}
			if (agentResponse.actionProposals.length > 0) {
				assistantMsg.proposals = agentResponse.actionProposals;
			}

			// Rendu in-place des widgets de tâches interactifs
			await this.upgradeTaskElementsInPlace(textContentEl, agentResponse.text, assistantMsg.tasks);

			if (agentResponse.actionProposals.length > 0) {
				ActionPreviewWidget.render(bubbleEl, agentResponse.actionProposals, this.actionExecutor, this.app);

				const noteCreations = agentResponse.actionProposals.filter(p => p.type === 'create_note');
				if (noteCreations.length > 0) {
					const directButtonsContainer = bubbleEl.createDiv({ cls: 'sbm-direct-open-note-container' });
					noteCreations.forEach(nc => {
						const createProp = nc as any;
						const targetPath = createProp.targetPath || (createProp.folder ? `${createProp.folder}/${createProp.fileName}` : createProp.fileName);
						const cleanName = createProp.fileName?.replace(/\.md$/, '') || targetPath.split('/').pop()?.replace(/\.md$/, '') || 'Note';
						const btn = directButtonsContainer.createEl('button', {
							cls: 'sbm-direct-open-note-btn',
							text: `📄 Ouvrir la note : ${cleanName}`
						});
						btn.title = `Ouvrir ${targetPath} directement dans l'éditeur`;
						btn.addEventListener('click', async () => {
							await ActionPreviewWidget.openNote(this.app, targetPath);
						});
					});
				}
			}

			const metaBar = bubbleEl.createEl('div', { cls: 'sbm-msg-meta-bar' });
			const timeText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			metaBar.createEl('span', { cls: 'sbm-msg-time', text: timeText });

			const actionsGroup = metaBar.createEl('div', { cls: 'sbm-msg-actions-group' });

			const copyBtn = actionsGroup.createEl('button', { cls: 'sbm-msg-action-icon-btn' });
			setIcon(copyBtn, 'copy');
			copyBtn.title = 'Copier la réponse';
			copyBtn.addEventListener('click', async () => {
				await navigator.clipboard.writeText(agentResponse.text);
				new Notice('Réponse copiée dans le presse-papier !');
				setIcon(copyBtn, 'check');
				setTimeout(() => setIcon(copyBtn, 'copy'), 1500);
			});

			const delBtn = actionsGroup.createEl('button', { cls: 'sbm-msg-action-icon-btn' });
			setIcon(delBtn, 'trash');
			delBtn.title = 'Supprimer cette réponse';
			delBtn.addEventListener('click', () => {
				const idx = this.messages.indexOf(assistantMsg);
				if (idx !== -1) {
					this.messages.splice(idx, 1);
					this.renderFullMessages();
				}
			});

			this.attachedContexts = [];
			this.renderContextInsideCard();
		} catch (err: unknown) {
			thinkingBox.remove();
			bubbleEl.removeClass('sbm-msg-streaming');

			const errorMsg = err instanceof Error ? err.message : String(err);
			const isAborted = err instanceof DOMException && err.name === 'AbortError';

			if (isAborted) {
				textContentEl.setText('Génération interrompue.');
				assistantMsg.content = 'Génération interrompue.';
			} else {
				// 1. Intégrité de l'historique : Retirer le message d'erreur de this.messages
				const idx = this.messages.indexOf(assistantMsg);
				if (idx !== -1) {
					this.messages.splice(idx, 1);
				}

				// 2. Transformer la bulle en carte d'alerte stylisée
				msgEl.addClass('sbm-chat-msg-error');
				bubbleEl.empty();
				bubbleEl.className = 'sbm-msg-bubble sbm-msg-error-bubble';

				// Header de l'erreur
				const errorHeader = bubbleEl.createDiv({ cls: 'sbm-error-card-header' });
				const titleLeft = errorHeader.createDiv({ cls: 'sbm-error-title-left' });
				const warnIcon = titleLeft.createSpan({ cls: 'sbm-error-warn-icon' });
				setIcon(warnIcon, 'alert-triangle');
				titleLeft.createEl('span', {
					cls: 'sbm-error-title-text',
					text: `Erreur (${this.plugin.settings.llmProvider.toUpperCase()})`
				});

				const closeBtn = errorHeader.createEl('button', { cls: 'sbm-error-dismiss-btn' });
				setIcon(closeBtn, 'x');
				closeBtn.title = 'Fermer cette alerte';
				closeBtn.addEventListener('click', () => {
					msgEl.remove();
				});

				// Corps du message d'erreur (sélectionnable à 100%)
				const errorBody = bubbleEl.createDiv({ cls: 'sbm-error-message-box' });
				errorBody.setText(errorMsg);

				// Barre d'actions correctives contextuelles
				const actionsBar = bubbleEl.createDiv({ cls: 'sbm-error-actions-bar' });

				// Bouton Réessayer
				const retryBtn = actionsBar.createEl('button', {
					cls: 'sbm-error-action-btn mod-cta',
					text: '🔄 Réessayer'
				});
				retryBtn.title = 'Relancer la génération de la réponse';
				retryBtn.addEventListener('click', async () => {
					msgEl.remove();
					await this.triggerAssistantGeneration();
				});

				// Bouton Gérer les clés d'API
				const secretsBtn = actionsBar.createEl('button', {
					cls: 'sbm-error-action-btn',
					text: '🔑 Gérer les clés d\'API'
				});
				secretsBtn.title = 'Ouvrir le gestionnaire de clés API et secrets';
				secretsBtn.addEventListener('click', () => {
					const curProv = this.plugin.settings.llmProvider;
					const target = (curProv === 'gemini' || curProv === 'openai' || curProv === 'openrouter' || curProv === 'infomaniak')
						? curProv
						: undefined;
					new SecretsManagementModal(this.app, this.plugin, () => {}, target).open();
				});

				// Bouton Copier l'erreur
				const copyErrorBtn = actionsBar.createEl('button', {
					cls: 'sbm-error-action-btn',
					text: '📋 Copier l\'erreur'
				});
				copyErrorBtn.title = 'Copier le message d\'erreur dans le presse-papier';
				copyErrorBtn.addEventListener('click', async () => {
					await navigator.clipboard.writeText(errorMsg);
					new Notice('Erreur copiée dans le presse-papier !');
					copyErrorBtn.setText('✓ Copié !');
					setTimeout(() => copyErrorBtn.setText('📋 Copier l\'erreur'), 2000);
				});

				new Notice(`Erreur IA : ${errorMsg.slice(0, 80)}...`);
			}
		} finally {
			this.isGenerating = false;
			this.currentAbortController = null;
			if (this.sendBtnEl) {
				setIcon(this.sendBtnEl, 'arrow-up');
				this.sendBtnEl.title = 'Envoyer';
			}
			this.scrollToBottom();
			if (this.textareaEl) this.textareaEl.focus();
		}
	}
}
