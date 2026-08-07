import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer } from 'obsidian';
import { ChatMessage, LLMConfig } from '../models/llm';
import { LLMService } from '../services/llmService';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_CHAT = 'sbm-chat-view';

export class ChatView extends ItemView {
	private plugin: SecondBrainPlugin;
	private messages: ChatMessage[] = [];
	private isGenerating = false;
	private messagesContainerEl: HTMLElement | null = null;
	private sendBtnEl: HTMLButtonElement | null = null;
	private textareaEl: HTMLTextAreaElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.messages = [
			{
				role: 'assistant',
				content: 'Bonjour ! Je suis votre assistant Second Brain. Comment puis-je vous aider aujourd\'hui ?'
			}
		];
	}

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return 'Second Brain — Agent IA';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('sbm-chat-container');

		// Header avec bouton d'effacement
		const headerEl = container.createEl('div', { cls: 'sbm-chat-header' });
		const titleRow = headerEl.createEl('div', { cls: 'sbm-chat-title-row' });
		titleRow.createEl('h2', { text: 'Assistant IA' });

		const clearBtn = titleRow.createEl('button', { cls: 'sbm-chat-clear-btn', text: 'Effacer' });
		clearBtn.addEventListener('click', () => {
			this.messages = [
				{
					role: 'assistant',
					content: 'Conversation réinitialisée. En quoi puis-je vous être utile ?'
				}
			];
			this.renderFullMessages();
		});

		// Zone de messages persistante
		this.messagesContainerEl = container.createEl('div', { cls: 'sbm-messages-area' });
		this.renderFullMessages();

		// Zone de saisie
		const inputArea = container.createEl('div', { cls: 'sbm-chat-input-area' });

		this.textareaEl = inputArea.createEl('textarea', {
			cls: 'sbm-chat-textarea',
			placeholder: 'Posez une question ou demandez un briefing...'
		});

		this.sendBtnEl = inputArea.createEl('button', {
			cls: 'sbm-chat-send-btn',
			text: 'Envoyer'
		});

		this.sendBtnEl.addEventListener('click', () => this.handleSendMessage());

		this.textareaEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.handleSendMessage();
			}
		});

		setTimeout(() => {
			if (this.textareaEl) this.textareaEl.focus();
		}, 30);
	}

	private renderFullMessages(): void {
		if (!this.messagesContainerEl) return;
		this.messagesContainerEl.empty();

		this.messages.forEach(msg => {
			if (msg.role === 'system') return;
			this.appendMessageElement(msg.role, msg.content);
		});

		this.scrollToBottom();
	}

	private appendMessageElement(role: 'user' | 'assistant', initialContent: string): HTMLElement {
		if (!this.messagesContainerEl) return document.createElement('div');

		const msgEl = this.messagesContainerEl.createEl('div', {
			cls: `sbm-chat-msg ${role}`
		});

		const bubbleEl = msgEl.createEl('div', { cls: 'sbm-msg-bubble' });
		bubbleEl.setText(initialContent);

		this.scrollToBottom();
		return bubbleEl;
	}

	private scrollToBottom(): void {
		if (this.messagesContainerEl) {
			this.messagesContainerEl.scrollTop = this.messagesContainerEl.scrollHeight;
		}
	}

	private async handleSendMessage(): Promise<void> {
		if (!this.textareaEl || this.isGenerating) return;

		const text = this.textareaEl.value.trim();
		if (!text) return;

		// 1. Ajouter le message utilisateur
		this.messages.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
		this.appendMessageElement('user', text);

		this.textareaEl.value = '';
		this.isGenerating = true;
		if (this.sendBtnEl) this.sendBtnEl.setText('Génération...');

		// 2. Créer la bulle de message assistant en direct avec curseur animé
		const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: new Date().toISOString() };
		this.messages.push(assistantMsg);
		const assistantBubbleEl = this.appendMessageElement('assistant', '▌');
		assistantBubbleEl.addClass('sbm-msg-streaming');

		// File d'attente pour le flux progressif lissé (effet machine à écrire)
		let targetText = '';
		let displayedText = '';
		let streamFinished = false;

		const typeWriterInterval = window.setInterval(() => {
			if (displayedText.length < targetText.length) {
				// Avancement fluide par groupe de 1 à 3 caractères
				const step = Math.min(3, targetText.length - displayedText.length);
				displayedText += targetText.slice(displayedText.length, displayedText.length + step);
				assistantBubbleEl.setText(displayedText + (streamFinished ? '' : '▌'));
				this.scrollToBottom();
			} else if (streamFinished) {
				window.clearInterval(typeWriterInterval);
			}
		}, 16);

		try {
			const apiKey = await this.plugin.getSecretApiKey(this.plugin.settings.llmProvider);
			const config: LLMConfig = {
				provider: this.plugin.settings.llmProvider,
				endpoint: this.plugin.settings.llmEndpoint,
				model: this.plugin.settings.llmModel,
				apiKey
			};

			await LLMService.generateStreamingResponse(
				this.messages.slice(0, -1),
				config,
				(_chunk, fullText) => {
					targetText = fullText;
					assistantMsg.content = fullText;
				}
			);

			streamFinished = true;

			// Attente que le buffer d'affichage rattrape le texte complet
			while (displayedText.length < targetText.length) {
				displayedText = targetText;
				assistantBubbleEl.setText(displayedText);
				await new Promise(r => setTimeout(r, 20));
			}

			window.clearInterval(typeWriterInterval);
			assistantBubbleEl.removeClass('sbm-msg-streaming');

			// Rendu Markdown soigné et compact du résultat final
			if (targetText) {
				assistantBubbleEl.empty();
				await MarkdownRenderer.render(this.app, targetText, assistantBubbleEl, '', this);
			}
		} catch (err: unknown) {
			window.clearInterval(typeWriterInterval);
			const errorMsg = err instanceof Error ? err.message : String(err);
			new Notice(`Erreur IA : ${errorMsg}`);
			assistantBubbleEl.removeClass('sbm-msg-streaming');
			assistantBubbleEl.setText(`Erreur : ${errorMsg}`);
			assistantMsg.content = `Erreur : ${errorMsg}`;
		} finally {
			this.isGenerating = false;
			if (this.sendBtnEl) this.sendBtnEl.setText('Envoyer');
			this.scrollToBottom();
			if (this.textareaEl) this.textareaEl.focus();
		}
	}
}
