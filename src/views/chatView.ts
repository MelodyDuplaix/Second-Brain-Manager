import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, MarkdownView, normalizePath, TFile, setIcon } from 'obsidian';
import { ChatMessage, LLMConfig } from '../models/llm';
import { AgentOrchestrator } from '../services/agentOrchestrator';
import { ActionExecutor } from '../services/actionExecutor';
import { ActionPreviewWidget } from './actionPreviewWidget';
import { ContextPickerModal, ContextItem } from '../modals/contextPickerModal';
import { ModelPickerModal } from '../modals/modelPickerModal';
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
		await this.render();
	}

	async onClose(): Promise<void> {
		this.cancelCurrentGeneration();
		return super.onClose();
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

		// Header avec titre, badge de modèle et bouton d'effacement
		const headerEl = container.createEl('div', { cls: 'sbm-chat-header' });
		const titleRow = headerEl.createEl('div', { cls: 'sbm-chat-title-row' });
		
		const titleLeft = titleRow.createEl('div', { cls: 'sbm-chat-title-left' });
		titleLeft.createEl('h2', { text: 'Assistant IA' });
		const modelBadge = titleLeft.createEl('button', {
			cls: 'sbm-header-model-badge',
			text: this.plugin.settings.llmModel || 'Modèle IA'
		});
		modelBadge.title = `Fournisseur : ${this.plugin.settings.llmProvider} (Cliquer pour changer)`;

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

		// Délégation globale de clics : résout TOUS les wikilinks même s'ils sont dans des balises code ou texte brut
		this.messagesContainerEl.addEventListener('click', async (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			const linkEl = target.closest('a.internal-link, .sbm-clickable-link, a, code') as HTMLElement | null;

			if (linkEl) {
				let href = linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || linkEl.textContent || '';
				const wikiMatch = href.match(/\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/);
				if (wikiMatch) {
					href = wikiMatch[1];
				}

				if (href) {
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
				modelBadge.setText(selected.name);
				modelBadge.title = `Fournisseur : ${selected.providerName} (Cliquer pour changer)`;
			}).open();
		};

		currentModelBtn.addEventListener('click', openModelModal);
		modelBadge.addEventListener('click', openModelModal);

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
					}).open();
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

		// Bouton "+ @ Add context"
		const addContextBtn = leftPills.createEl('button', {
			cls: 'sbm-card-add-context-btn',
			text: '@ Add context'
		});
		addContextBtn.title = 'Joindre une note, un contact, un projet ou un dossier';
		addContextBtn.addEventListener('click', () => {
			new ContextPickerModal(this.app, (item) => {
				this.addContextItem(item);
			}).open();
		});

		// Suggestion de la note active si ouverte
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file) {
			const activeFile = activeView.file;
			const isAlreadyAttached = this.attachedContexts.some(c => c.path === activeFile.path);

			if (!isAlreadyAttached) {
				const activeNoteBtn = leftPills.createEl('button', {
					cls: 'sbm-card-active-note-pill',
					text: `+ Note active (${activeFile.basename})`
				});
				activeNoteBtn.title = 'Cliquer pour inclure cette note active dans le contexte';
				activeNoteBtn.addEventListener('click', () => {
					this.addContextItem({
						type: 'active-note',
						path: normalizePath(activeFile.path),
						title: activeFile.basename,
						desc: activeFile.path
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
				}
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

			if (agentResponse.actionProposals.length > 0) {
				ActionPreviewWidget.render(bubbleEl, agentResponse.actionProposals, this.actionExecutor);
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
				new Notice(`Erreur IA : ${errorMsg}`);
				textContentEl.setText(`Erreur : ${errorMsg}`);
				assistantMsg.content = `Erreur : ${errorMsg}`;
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
