import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskCardWidget } from './taskCardWidget';
import { EveningReviewService, EveningVaultData } from '../services/eveningReviewService';
import { SecretsManagementModal } from '../modals/secretsManagementModal';
import { ChatMessage } from '../models/llm';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_EVENING_REVIEW = 'sbm-evening-review-view';

export class EveningReviewView extends ItemView {
	private plugin: SecondBrainPlugin;
	private isGenerating = false;
	private currentAbortController: AbortController | null = null;
	private generatedReviewText = '';
	private eveningVaultData: EveningVaultData | null = null;
	private vaultTasks: ObsidianTask[] = [];

	private contentElWrapper: HTMLElement | null = null;
	private responseAreaEl: HTMLElement | null = null;
	private badgesContainerEl: HTMLElement | null = null;
	private regenBtnEl: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_EVENING_REVIEW;
	}

	getDisplayText(): string {
		return 'Revue du soir';
	}

	getIcon(): string {
		return 'moon';
	}

	async onOpen(): Promise<void> {
		await this.render();
		if (!this.generatedReviewText) {
			await this.triggerReviewGeneration();
		}
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
		container.addClass('sbm-briefing-view-container');
		container.addClass('sbm-evening-view-container');

		const todayFormatted = new Date().toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
		const capDate = todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

		// 1. Header fixe en haut
		const headerEl = container.createEl('div', { cls: 'sbm-briefing-view-header sbm-evening-view-header' });
		
		const titleRow = headerEl.createEl('div', { cls: 'sbm-briefing-title-row' });
		const titleLeft = titleRow.createEl('div', { cls: 'sbm-briefing-title-left' });
		
		const titleIcon = titleLeft.createSpan({ cls: 'sbm-briefing-header-icon sbm-evening-header-icon' });
		setIcon(titleIcon, 'moon');
		
		const titleTextGroup = titleLeft.createDiv({ cls: 'sbm-briefing-title-group' });
		titleTextGroup.createEl('h2', { text: 'Revue du soir', cls: 'sbm-briefing-main-title' });
		titleTextGroup.createEl('span', { text: `📅 ${capDate}`, cls: 'sbm-briefing-date-sub' });

		// Actions & Badges de synthèse en haut à droite
		const headerActions = titleRow.createEl('div', { cls: 'sbm-briefing-header-actions' });

		this.badgesContainerEl = headerActions.createDiv({ cls: 'sbm-evening-stats-badges' });
		this.renderHeaderBadges();

		this.regenBtnEl = headerActions.createEl('button', { cls: 'sbm-briefing-regen-btn' });
		setIcon(this.regenBtnEl, 'rotate-cw');
		this.regenBtnEl.createSpan({ text: 'Actualiser' });
		this.regenBtnEl.title = 'Relancer la génération de la revue';
		this.regenBtnEl.addEventListener('click', async () => {
			await this.triggerReviewGeneration();
		});

		// 2. Corps central scrollable
		const scrollBody = container.createEl('div', { cls: 'sbm-briefing-scroll-body' });
		this.contentElWrapper = scrollBody.createEl('div', { cls: 'sbm-briefing-content-flow' });

		// Délégation globale de clics : résout les wikilinks dans la revue
		scrollBody.addEventListener('click', async (e: MouseEvent) => {
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

		// 3. Footer fixe en bas pour la transition vers le Chat
		this.responseAreaEl = container.createEl('div', { cls: 'sbm-briefing-footer-dock' });
		this.renderResponseArea();
	}

	private renderHeaderBadges(): void {
		if (!this.badgesContainerEl) return;
		this.badgesContainerEl.empty();

		if (this.eveningVaultData) {
			const completedCount = this.eveningVaultData.completedTodayTasks.length;
			const coinsCount = this.eveningVaultData.coinsEarnedToday;
			const remainingCount = this.eveningVaultData.unfinishedTodayTasks.length;

			const compBadge = this.badgesContainerEl.createSpan({ cls: 'sbm-evening-badge completed' });
			compBadge.setText(`✅ ${completedCount} faite${completedCount > 1 ? 's' : ''}`);

			const coinsBadge = this.badgesContainerEl.createSpan({ cls: 'sbm-evening-badge coins' });
			coinsBadge.setText(`🪙 +${coinsCount}`);

			if (remainingCount > 0) {
				const remBadge = this.badgesContainerEl.createSpan({ cls: 'sbm-evening-badge remaining' });
				remBadge.setText(`⏳ ${remainingCount} restante${remainingCount > 1 ? 's' : ''}`);
			}
		}
	}

	private async triggerReviewGeneration(): Promise<void> {
		if (this.isGenerating) {
			this.cancelCurrentGeneration();
		}

		this.isGenerating = true;
		if (this.regenBtnEl) {
			this.regenBtnEl.disabled = true;
			this.regenBtnEl.addClass('is-loading');
		}

		if (!this.contentElWrapper) return;
		this.contentElWrapper.empty();

		// Indicateur de chargement / réflexion
		const thinkingBox = this.contentElWrapper.createEl('div', { cls: 'sbm-thinking-box sbm-briefing-loading' });
		const spinnerIcon = thinkingBox.createEl('div', { cls: 'sbm-thinking-spinner' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });

		thinkingBox.createEl('span', {
			cls: 'sbm-thinking-label',
			text: '🌙 Synthèse des accomplissements et préparation du bilan de soirée...'
		});

		const textDisplayEl = this.contentElWrapper.createEl('div', { cls: 'sbm-briefing-text-display sbm-msg-streaming' });

		this.currentAbortController = new AbortController();

		try {
			const result = await EveningReviewService.generateEveningReview(
				this.app,
				this.plugin,
				this.currentAbortController.signal,
				(_chunk, fullText) => {
					thinkingBox.remove();
					const clean = fullText.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
					textDisplayEl.setText(clean);
				}
			);

			this.generatedReviewText = result.text;
			this.eveningVaultData = result.data;
			this.vaultTasks = result.allTasks;
			this.renderHeaderBadges();

			thinkingBox.remove();
			textDisplayEl.removeClass('sbm-msg-streaming');
			textDisplayEl.empty();

			// 1. Barre d'actions d'application directe (Daily note + Reporter à demain)
			const reviewActionBar = textDisplayEl.createDiv({ cls: 'sbm-briefing-document-actions' });

			const saveDailyBtn = reviewActionBar.createEl('button', {
				cls: 'sbm-doc-action-btn',
				text: '📝 Enregistrer dans ma Daily Note'
			});
			saveDailyBtn.title = 'Inscrire le bilan de la soirée dans la note quotidienne du jour';
			saveDailyBtn.addEventListener('click', async () => {
				const path = await EveningReviewService.saveReviewToDailyNote(
					this.app,
					this.plugin,
					this.generatedReviewText,
					result.data.dateStr
				);
				new Notice(`Revue du soir enregistrée dans [[${path}]] !`);
			});

			if (result.data.unfinishedTodayTasks.length > 0) {
				const deferAllBtn = reviewActionBar.createEl('button', {
					cls: 'sbm-doc-action-btn',
					text: '⏩ Reporter les tâches restantes à demain'
				});
				deferAllBtn.title = 'Appliquer la date de demain aux tâches non terminées d\'aujourd\'hui';
				deferAllBtn.addEventListener('click', async () => {
					const count = await EveningReviewService.deferUnfinishedTasksToTomorrow(
						this.app,
						this.plugin,
						result.data.unfinishedTodayTasks
					);
					new Notice(`${count} tâche(s) reportée(s) à demain !`);
				});
			}

			// 2. Rendu du corps Markdown
			const cleanedText = result.text.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
			const textBodyContainer = textDisplayEl.createDiv({ cls: 'sbm-briefing-rendered-body' });
			await MarkdownRenderer.render(this.app, cleanedText, textBodyContainer, '', this);

			// 3. Remplacement des tâches markdown par des widgets interactifs in-place
			await this.upgradeTaskElementsInPlace(textBodyContainer, cleanedText, this.vaultTasks);

		} catch (err: unknown) {
			thinkingBox.remove();
			textDisplayEl.remove();

			const errorMsg = err instanceof Error ? err.message : String(err);
			const isAborted = err instanceof DOMException && err.name === 'AbortError';

			if (isAborted) {
				this.contentElWrapper.createEl('p', { cls: 'sbm-empty-text', text: 'Génération interrompue.' });
				return;
			}

			// Carte d'erreur stylisée
			const errorCard = this.contentElWrapper.createDiv({ cls: 'sbm-msg-bubble sbm-msg-error-bubble' });
			const errorHeader = errorCard.createDiv({ cls: 'sbm-error-card-header' });
			const titleLeft = errorHeader.createDiv({ cls: 'sbm-error-title-left' });
			const warnIcon = titleLeft.createSpan({ cls: 'sbm-error-warn-icon' });
			setIcon(warnIcon, 'alert-triangle');
			titleLeft.createEl('span', { text: `Erreur IA (${this.plugin.settings.llmProvider.toUpperCase()})` });

			const errorBody = errorCard.createDiv({ cls: 'sbm-error-message-box' });
			errorBody.setText(errorMsg);

			const actionsBar = errorCard.createDiv({ cls: 'sbm-error-actions-bar' });

			const retryBtn = actionsBar.createEl('button', { cls: 'sbm-error-action-btn mod-cta', text: '🔄 Réessayer' });
			retryBtn.addEventListener('click', async () => {
				await this.triggerReviewGeneration();
			});

			const secretsBtn = actionsBar.createEl('button', { cls: 'sbm-error-action-btn', text: '🔑 Gérer les clés d\'API' });
			secretsBtn.addEventListener('click', () => {
				new SecretsManagementModal(
					this.app,
					this.plugin,
					() => this.triggerReviewGeneration(),
					this.plugin.settings.llmProvider
				).open();
			});

			new Notice(`Erreur lors de la génération de la revue : ${errorMsg.slice(0, 80)}`);
		} finally {
			this.isGenerating = false;
			this.currentAbortController = null;
			if (this.regenBtnEl) {
				this.regenBtnEl.disabled = false;
				this.regenBtnEl.removeClass('is-loading');
			}
		}
	}

	private renderResponseArea(): void {
		if (!this.responseAreaEl) return;
		this.responseAreaEl.empty();

		const footerCard = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-chat-dock-card' });

		// 1. Boutons de réponses rapides suggérées (Chips)
		const chipsRow = footerCard.createDiv({ cls: 'sbm-briefing-chips-row' });
		
		const suggestions = [
			{ label: '🌙 Clôturer ma journée', prompt: 'Merci pour ce bilan ! Aide-moi à clôturer sereinement ma journée et à déconnecter l\'esprit tranquille.' },
			{ label: '⏩ Reporter tout à demain', prompt: 'Peux-tu reporter à demain toutes les tâches ouvertes restantes sans culpabilité ?' },
			{ label: '🧹 Classer mes notes Inbox', prompt: 'Aide-moi à trier et classer les notes prises en vrac dans ma boîte de réception aujourd\'hui.' },
			{ label: '📝 Noter dans mon journal', prompt: 'Enregistre le résumé de mes accomplissements dans le journal de ma note quotidienne.' },
			{ label: '💭 Débriefer de ma journée', prompt: 'J\'aimerais débriefer rapidement de ce qui a bien marché et de ce qui a été bloquant aujourd\'hui.' }
		];

		suggestions.forEach(s => {
			const chipBtn = chipsRow.createEl('button', { cls: 'sbm-briefing-chip-btn', text: s.label });
			chipBtn.addEventListener('click', async () => {
				await this.continueInChat(s.prompt);
			});
		});

		// 2. Champ de saisie fluide Copilot-style
		const inputCard = footerCard.createDiv({ cls: 'sbm-briefing-input-card' });
		
		const textarea = inputCard.createEl('textarea', {
			cls: 'sbm-briefing-textarea',
			placeholder: 'Répondre au bilan du soir, poser une question ou débriefer de votre journée...'
		});

		const submitBtn = inputCard.createEl('button', {
			cls: 'sbm-briefing-send-btn mod-cta'
		});
		setIcon(submitBtn, 'arrow-up');
		submitBtn.title = 'Poursuivre la discussion dans le Chat (Entrée)';

		const handleSubmit = async () => {
			const userText = textarea.value.trim();
			if (!userText) return;
			await this.continueInChat(userText);
		};

		submitBtn.addEventListener('click', handleSubmit);

		textarea.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				handleSubmit();
			}
		});
	}

	private async continueInChat(userMessage: string): Promise<void> {
		const conversation: ChatMessage[] = [];

		if (this.generatedReviewText) {
			conversation.push({
				role: 'assistant',
				content: this.generatedReviewText,
				timestamp: new Date().toISOString()
			});
		} else {
			conversation.push({
				role: 'assistant',
				content: 'Bonsoir ! Je suis à votre écoute pour faire le bilan de votre journée.',
				timestamp: new Date().toISOString()
			});
		}

		conversation.push({
			role: 'user',
			content: userMessage,
			timestamp: new Date().toISOString()
		});

		await this.plugin.openChatWithConversation(conversation, true);
		new Notice('Transition vers l\'Assistant IA...');
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

		if (wordsA.length > 25 && wordsA.length > wordsB.length * 3) return false;

		if (cleanText.includes(cleanVault) || cleanVault.includes(cleanText)) return true;

		const common = wordsA.filter(w => wordsB.includes(w));
		const matchRatio = common.length / wordsB.length;

		return matchRatio >= 0.6 || (common.length >= 2 && wordsB.length <= 3 && matchRatio >= 0.5);
	}

	private async upgradeTaskElementsInPlace(
		textContentEl: HTMLElement,
		content: string,
		vaultTasks: ObsidianTask[]
	): Promise<void> {
		const usedTaskIds = new Set<string>();

		// A. Blocs de code <pre> contenant des tâches Markdown
		const preElements = Array.from(textContentEl.querySelectorAll('pre'));
		preElements.forEach(pre => {
			if (pre.closest('.sbm-inline-task-wrapper') || pre.closest('.sbm-chat-task-card') || pre.closest('.sbm-chat-tasks-container')) return;
			const rawText = pre.textContent || '';
			const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

			const taskLines: ObsidianTask[] = [];
			lines.forEach(line => {
				const matched = vaultTasks.find(vt => {
					const taskId = `${vt.filePath}:${vt.lineNumber}`;
					if (usedTaskIds.has(taskId)) return false;
					return this.isTaskMatch(line, vt.title);
				});

				if (matched) {
					usedTaskIds.add(`${matched.filePath}:${matched.lineNumber}`);
					taskLines.push(matched);
				} else if (/^\[[ xX/]\]|^[-*0-9.]+\s*\[[ xX/]\]/.test(line) || (line.includes('📅') && line.includes('#tm/'))) {
					const cleanLine = line.replace(/^[-*0-9.\s]+/, '').replace(/^\[[ xX/]\]\s*/, '');
					const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
					if (parsed) taskLines.push(parsed);
				}
			});

			if (taskLines.length > 0) {
				const tasksContainer = document.createElement('div');
				tasksContainer.className = 'sbm-chat-tasks-container';
				taskLines.forEach(t => {
					TaskCardWidget.render(tasksContainer, t, this.plugin, () => {});
				});
				pre.replaceWith(tasksContainer);
			}
		});

		// B. Tableaux markdown <table>
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

			if (rowTasks.length > 0) {
				const tasksContainer = document.createElement('div');
				tasksContainer.className = 'sbm-chat-tasks-container';
				rowTasks.forEach(t => {
					TaskCardWidget.render(tasksContainer, t, this.plugin, () => {});
				});
				table.replaceWith(tasksContainer);
			}
		});

		// C. Éléments <li> et <p>
		const candidateElements = Array.from(textContentEl.querySelectorAll('li, p'));

		candidateElements.forEach(el => {
			if (el.closest('.sbm-inline-task-wrapper') || el.closest('.sbm-chat-task-card') || el.closest('.sbm-chat-tasks-container')) return;

			if (el.tagName.toLowerCase() === 'li' && el.querySelector('li') !== null) return;

			const text = el.textContent || '';
			if (!text.trim()) return;

			if (el.tagName.toLowerCase() === 'p') {
				const isTaskLike =
					/^[-*0-9.]+\s*\[[ xX/]\]/.test(text.trim()) ||
					text.includes('📅') ||
					text.includes('⚡') ||
					text.includes('#tm/') ||
					text.includes('#energie/');
				if (!isTaskLike) return;
			}

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
				TaskCardWidget.render(wrapper, matched, this.plugin, () => {});
				
				if (el.parentElement && (el.parentElement.tagName.toLowerCase() === 'ul' || el.parentElement.tagName.toLowerCase() === 'ol')) {
					el.parentElement.style.listStyle = 'none';
					el.parentElement.style.paddingLeft = '0';
				}
				el.replaceWith(wrapper);
			} else if (
				/^\[[ xX/]\]/.test(text.trim()) ||
				el.classList.contains('task-list-item') ||
				el.querySelector('input[type="checkbox"]') !== null ||
				(text.includes('📅') && (text.includes('⚡') || text.includes('#tm/')))
			) {
				const cleanLine = text.replace(/^[-*0-9.\s]+/, '').replace(/^\[[ xX/]\]\s*/, '');
				const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
				if (parsed) {
					const wrapper = document.createElement('div');
					wrapper.className = 'sbm-inline-task-wrapper';
					TaskCardWidget.render(wrapper, parsed, this.plugin, () => {});
					
					if (el.parentElement && (el.parentElement.tagName.toLowerCase() === 'ul' || el.parentElement.tagName.toLowerCase() === 'ol')) {
						el.parentElement.style.listStyle = 'none';
						el.parentElement.style.paddingLeft = '0';
					}
					el.replaceWith(wrapper);
				}
			}
		});
	}
}
