import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { TaskCardWidget } from './taskCardWidget';
import { ActionPreviewWidget } from './actionPreviewWidget';
import { ActionExecutor } from '../services/actionExecutor';
import { ActionProposal, ActionResult } from '../models/actions';
import { RecoveryService, RecoveryVaultData } from '../services/recoveryService';
import { SecretsManagementModal } from '../modals/secretsManagementModal';
import { ChatMessage } from '../models/llm';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_RECOVERY = 'sbm-recovery-view';

export class RecoveryView extends ItemView {
	private plugin: SecondBrainPlugin;
	private isGenerating = false;
	private currentAbortController: AbortController | null = null;
	private generatedRecoveryText = '';
	private recoveryVaultData: RecoveryVaultData | null = null;
	private vaultTasks: ObsidianTask[] = [];
	private proposals: ActionProposal[] = [];

	private contentElWrapper: HTMLElement | null = null;
	private responseAreaEl: HTMLElement | null = null;
	private badgesContainerEl: HTMLElement | null = null;
	private energyContainerEl: HTMLElement | null = null;
	private regenBtnEl: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RECOVERY;
	}

	getDisplayText(): string {
		return 'Reprise après pause';
	}

	getIcon(): string {
		return 'coffee';
	}

	async onOpen(): Promise<void> {
		await this.render();
		// Lancement automatique de la reprise en tâche de fond immédiate (non-bloquant pour l'ouverture de la vue)
		if (!this.generatedRecoveryText) {
			window.setTimeout(() => {
				void this.triggerRecoveryGeneration();
			}, 50);
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
		container.addClass('sbm-recovery-view-container');

		const todayFormatted = new Date().toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
		const capDate = todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

		// 1. Header fixe en haut
		const headerEl = container.createEl('div', { cls: 'sbm-briefing-view-header sbm-recovery-view-header' });

		const titleRow = headerEl.createEl('div', { cls: 'sbm-briefing-title-row' });
		const titleLeft = titleRow.createEl('div', { cls: 'sbm-briefing-title-left' });

		const titleIcon = titleLeft.createSpan({ cls: 'sbm-briefing-header-icon sbm-recovery-header-icon' });
		setIcon(titleIcon, 'coffee');

		const titleTextGroup = titleLeft.createDiv({ cls: 'sbm-briefing-title-group' });
		titleTextGroup.createEl('h2', { text: 'Reprise en douceur', cls: 'sbm-briefing-main-title' });
		titleTextGroup.createEl('span', { text: `📅 ${capDate}`, cls: 'sbm-briefing-date-sub' });

		// Actions & Badges en haut à droite
		const headerActions = titleRow.createEl('div', { cls: 'sbm-briefing-header-actions' });

		this.badgesContainerEl = headerActions.createDiv({ cls: 'sbm-evening-stats-badges' });
		this.renderHeaderBadges();

		this.regenBtnEl = headerActions.createEl('button', { cls: 'sbm-briefing-regen-btn' });
		setIcon(this.regenBtnEl, 'rotate-cw');
		this.regenBtnEl.createSpan({ text: 'Actualiser' });
		this.regenBtnEl.title = 'Relancer l\'analyse de reprise';
		this.regenBtnEl.addEventListener('click', async () => {
			await this.triggerRecoveryGeneration();
		});

		// Barre de réglages rapides (Énergie)
		const controlsBar = headerEl.createEl('div', { cls: 'sbm-briefing-controls-bar' });
		this.energyContainerEl = controlsBar.createEl('div', { cls: 'sbm-briefing-energy-box' });
		this.renderEnergySelector();

		// 2. Corps central scrollable
		const scrollBody = container.createEl('div', { cls: 'sbm-briefing-scroll-body' });
		this.contentElWrapper = scrollBody.createEl('div', { cls: 'sbm-briefing-content-flow' });

		// Délégation globale de clics : résout les wikilinks dans le plan de reprise
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
					href = href.replace(/^`+|`+$/g, '').trim();
					if (href.startsWith('[[') && href.endsWith(']]')) {
						href = href.slice(2, -2).trim();
					}
					const dest = this.app.metadataCache.getFirstLinkpathDest(href, '');
					if (dest) {
						e.preventDefault();
						e.stopPropagation();
						await this.app.workspace.getLeaf(false).openFile(dest);
					}
				}
			}
		});

		this.renderContentFlow();

		// 3. Footer fixe d'interaction & transition vers le chat
		this.renderFooterDock();
	}

	private renderHeaderBadges(): void {
		if (!this.badgesContainerEl) return;
		this.badgesContainerEl.empty();

		const text = this.recoveryVaultData?.inactivityText || 'Reprise de session';
		const badge = this.badgesContainerEl.createDiv({ cls: 'sbm-evening-stat-pill sbm-evening-stat-coins' });
		badge.createSpan({ text: `☕ ${text}` });

		if (this.recoveryVaultData && this.recoveryVaultData.overdueTasks.length > 0) {
			const overdueBadge = this.badgesContainerEl.createDiv({ cls: 'sbm-evening-stat-pill sbm-evening-stat-remaining' });
			overdueBadge.createSpan({ text: `⏳ ${this.recoveryVaultData.overdueTasks.length} en retard` });
		}
	}

	private renderEnergySelector(): void {
		if (!this.energyContainerEl) return;
		this.energyContainerEl.empty();

		const label = this.energyContainerEl.createEl('span', {
			cls: 'sbm-briefing-energy-label',
			text: `Énergie actuelle : ${this.plugin.settings.energyLevel}/10`
		});
		label.title = 'Ajustez votre niveau d\'énergie pour recalculer le plan de reprise';

		const slider = this.energyContainerEl.createEl('input', {
			type: 'range',
			cls: 'sbm-briefing-energy-slider'
		});
		slider.min = '1';
		slider.max = '10';
		slider.value = String(this.plugin.settings.energyLevel);

		slider.addEventListener('change', async () => {
			const val = parseInt(slider.value, 10);
			this.plugin.settings.energyLevel = val;
			await this.plugin.saveSettings();
			label.setText(`Énergie actuelle : ${val}/10`);
			new Notice(`Niveau d'énergie mis à jour : ${val}/10`);
			await this.triggerRecoveryGeneration();
		});
	}

	private renderContentFlow(): void {
		if (!this.contentElWrapper) return;
		this.contentElWrapper.empty();

		this.responseAreaEl = this.contentElWrapper.createEl('div', { cls: 'sbm-briefing-ai-response' });

		if (this.generatedRecoveryText) {
			this.renderRenderedResponse(this.generatedRecoveryText);
		}
	}

	private async renderRenderedResponse(text: string): Promise<void> {
		if (!this.responseAreaEl) return;
		this.responseAreaEl.empty();

		// 1. Barre d'actions directes
		const actionsRow = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-document-actions' });

		const copyBtn = actionsRow.createEl('button', {
			cls: 'sbm-doc-action-btn',
			text: '📋 Copier la réponse'
		});
		copyBtn.title = 'Copier l\'intégralité du texte de la reprise dans le presse-papier';
		copyBtn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(this.generatedRecoveryText);
				new Notice('Plan de reprise copié dans le presse-papier !');
			} catch {
				new Notice('Impossible de copier dans le presse-papier.');
			}
		});

		const saveDailyBtn = actionsRow.createEl('button', {
			cls: 'sbm-doc-action-btn',
			text: '📝 Enregistrer dans ma Daily Note'
		});
		saveDailyBtn.title = 'Consigner ce plan de reprise dans la note quotidienne du jour';
		saveDailyBtn.addEventListener('click', async () => {
			try {
				const path = await RecoveryService.saveRecoveryToDailyNote(
					this.app,
					this.plugin,
					this.generatedRecoveryText,
					this.recoveryVaultData?.dateStr
				);
				new Notice(`Plan de reprise enregistré dans [[${path}]] !`);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				new Notice(`Erreur lors de l'enregistrement : ${message}`);
			}
		});

		// Bouton d'application directe de tout le plan d'allègement
		if (this.proposals.length > 0) {
			const applyAllBtn = actionsRow.createEl('button', {
				cls: 'sbm-doc-action-btn mod-cta',
				text: `⚡ Appliquer tout le plan d'allègement (${this.proposals.length})`
			});
			applyAllBtn.title = 'Exécuter toutes les modifications d\'allègement (reports, annulations, suppressions d\'échéances)';
			applyAllBtn.addEventListener('click', async () => {
				applyAllBtn.disabled = true;
				applyAllBtn.setText('Application du plan...');
				const executor = new ActionExecutor(this.app, this.plugin.settings);
				const results = await executor.executeProposals(this.proposals);
				const successes = results.filter(r => r.success).length;
				new Notice(`Second Brain : ${successes}/${results.length} action(s) appliquée(s) avec succès !`);
				await this.triggerRecoveryGeneration();
			});
		}

		// 2. Widget interactif de prévisualisation et sélection des actions d'allègement
		if (this.proposals.length > 0) {
			const executor = new ActionExecutor(this.app, this.plugin.settings);
			ActionPreviewWidget.render(
				this.responseAreaEl,
				this.proposals,
				executor,
				this.app,
				async (_results: ActionResult[]) => {
					await this.triggerRecoveryGeneration();
				}
			);
		}

		// 3. Rendu du corps Markdown
		const cleanedText = text.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
		const textBodyContainer = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-rendered-body' });
		await MarkdownRenderer.render(this.app, cleanedText, textBodyContainer, '', this);

		// 4. Remplacement des tâches markdown par des widgets interactifs
		await this.upgradeTaskElementsInPlace(textBodyContainer, cleanedText, this.vaultTasks);
	}

	private renderFooterDock(): void {
		if (!this.responseAreaEl) return;

		const footerCard = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-chat-dock-card' });

		// Suggestions rapides en chips
		const chipsRow = footerCard.createDiv({ cls: 'sbm-briefing-chips-row' });

		const suggestions = [
			{ label: '🚀 Démarrer le Quick Win', prompt: 'Je vais commencer tout de suite par le Quick Win. Donne-moi des instructions très concrètes pour le boucler en 5 minutes chrono.' },
			{ label: '🎯 Se concentrer sur The One Thing', prompt: 'Je choisis de consacrer toute mon énergie disponible à ma tâche majeure aujourd\'hui. Aide-moi à la découper.' },
			{ label: '⏩ Reporter tout le reste à demain', prompt: 'Peux-tu reporter à demain toutes les tâches en retard sans culpabilité ?' },
			{ label: '📥 Classer mon Inbox', prompt: 'Aide-moi à trier et classer les notes prises en vrac dans ma boîte de réception.' }
		];

		suggestions.forEach(s => {
			const chipBtn = chipsRow.createEl('button', { cls: 'sbm-briefing-chip-btn', text: s.label });
			chipBtn.addEventListener('click', async () => {
				await this.continueInChat(s.prompt);
			});
		});

		// Champ de saisie Copilot-style
		const inputCard = footerCard.createDiv({ cls: 'sbm-briefing-input-card' });
		const textarea = inputCard.createEl('textarea', {
			cls: 'sbm-briefing-textarea',
			placeholder: 'Répondre au plan de reprise, poser une question ou ajuster vos priorités...'
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

	public async triggerRecoveryGeneration(): Promise<void> {
		if (this.isGenerating || !this.contentElWrapper) return;

		this.cancelCurrentGeneration();
		this.isGenerating = true;
		this.generatedRecoveryText = '';
		this.proposals = [];

		if (this.regenBtnEl) {
			this.regenBtnEl.disabled = true;
			this.regenBtnEl.addClass('is-loading');
		}

		this.contentElWrapper.empty();

		// Indicateur de réflexion discret
		const thinkingBox = this.contentElWrapper.createDiv({ cls: 'sbm-briefing-thinking-card' });
		const thinkingSpinner = thinkingBox.createDiv({ cls: 'sbm-briefing-thinking-dots' });
		thinkingSpinner.createSpan();
		thinkingSpinner.createSpan();
		thinkingSpinner.createSpan();
		const thinkingText = thinkingBox.createSpan({ cls: 'sbm-briefing-thinking-text' });
		thinkingText.setText('Analyse du coffre et préparation du plan de reprise et d\'allègement...');

		// Conteneur de streaming
		const textDisplayEl = this.contentElWrapper.createDiv({ cls: 'sbm-briefing-streaming-text sbm-msg-streaming' });

		this.currentAbortController = new AbortController();

		try {
			const result = await RecoveryService.generateRecovery(
				this.app,
				this.plugin,
				this.currentAbortController.signal,
				(_chunk, full) => {
					this.generatedRecoveryText = full;
					textDisplayEl.setText(full);
					this.contentElWrapper?.scrollTo({ top: this.contentElWrapper.scrollHeight, behavior: 'smooth' });
				}
			);

			this.generatedRecoveryText = result.text;
			this.recoveryVaultData = result.data;
			this.vaultTasks = result.allTasks;
			this.proposals = result.proposals;
			this.renderHeaderBadges();

			thinkingBox.remove();
			textDisplayEl.remove();

			// Mise à jour de la session active
			if (this.plugin.pluginData) {
				this.plugin.pluginData.lastActiveSession = new Date().toISOString();
				await this.plugin.savePluginData();
			}

			// Rendu propre
			this.renderContentFlow();
			this.renderFooterDock();

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
				await this.triggerRecoveryGeneration();
			});

			const secretsBtn = actionsBar.createEl('button', { cls: 'sbm-error-action-btn', text: '🔑 Gérer les clés d\'API' });
			secretsBtn.addEventListener('click', () => {
				new SecretsManagementModal(
					this.app,
					this.plugin,
					this.plugin.settings.llmProvider
				).open();
			});
		} finally {
			this.isGenerating = false;
			this.currentAbortController = null;
			if (this.regenBtnEl) {
				this.regenBtnEl.disabled = false;
				this.regenBtnEl.removeClass('is-loading');
			}
		}
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
			if (pre.closest('.sbm-inline-task-wrapper') || pre.closest('.sbm-chat-task-card') || pre.closest('.sbm-chat-tasks-container') || pre.closest('.sbm-action-preview-card')) return;
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
					const cleanLine = TaskMutator.cleanTaskPrefix(line);
					const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
					if (parsed) taskLines.push(parsed);
				}
			});

			if (taskLines.length > 0 && taskLines.length === lines.length) {
				const container = document.createElement('div');
				container.addClass('sbm-chat-tasks-container');
				taskLines.forEach(task => {
					const widget = new TaskCardWidget(task, this.plugin);
					container.appendChild(widget.render());
				});
				pre.replaceWith(container);
			}
		});

		// B. Tableaux <table> contenant des tâches
		const tableElements = Array.from(textContentEl.querySelectorAll('table'));
		tableElements.forEach(table => {
			if (table.closest('.sbm-inline-task-wrapper') || table.closest('.sbm-chat-task-card') || table.closest('.sbm-chat-tasks-container') || table.closest('.sbm-action-preview-card')) return;
			const rows = Array.from(table.querySelectorAll('tr'));
			const taskLines: ObsidianTask[] = [];
			let totalDataRows = 0;

			rows.forEach(tr => {
				const tds = Array.from(tr.querySelectorAll('td'));
				if (tds.length === 0) return;
				totalDataRows++;
				const rowText = tr.textContent || '';

				const matched = vaultTasks.find(vt => {
					const taskId = `${vt.filePath}:${vt.lineNumber}`;
					if (usedTaskIds.has(taskId)) return false;
					return this.isTaskMatch(rowText, vt.title);
				});

				if (matched) {
					usedTaskIds.add(`${matched.filePath}:${matched.lineNumber}`);
					taskLines.push(matched);
				} else if (/^\[[ xX/]\]|^[-*0-9.]+\s*\[[ xX/]\]/.test(rowText.trim()) || (rowText.includes('📅') && rowText.includes('#tm/'))) {
					const cleanLine = TaskMutator.cleanTaskPrefix(rowText);
					const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
					if (parsed) taskLines.push(parsed);
				}
			});

			if (taskLines.length > 0 && taskLines.length >= totalDataRows * 0.7) {
				const container = document.createElement('div');
				container.addClass('sbm-chat-tasks-container');
				taskLines.forEach(task => {
					const widget = new TaskCardWidget(task, this.plugin);
					container.appendChild(widget.render());
				});
				table.replaceWith(container);
			}
		});

		// C. Éléments de liste <li> et paragraphes <p>
		const elements = Array.from(textContentEl.querySelectorAll('li, p'));
		elements.forEach(el => {
			if (el.closest('.sbm-inline-task-wrapper') || el.closest('.sbm-chat-task-card') || el.closest('.sbm-chat-tasks-container') || el.closest('.sbm-action-preview-card')) return;
			if (el.tagName === 'LI' && el.querySelector('li')) return;

			const rawText = el.textContent || '';
			const isTaskSyntax = /^\[[ xX/]\]|^[-*0-9.]+\s*\[[ xX/]\]/.test(rawText.trim()) ||
				el.querySelector('input[type="checkbox"]') !== null ||
				(rawText.includes('📅') && (rawText.includes('⚡') || rawText.includes('#tm/')));

			if (!isTaskSyntax) return;

			const matched = vaultTasks.find(vt => {
				const taskId = `${vt.filePath}:${vt.lineNumber}`;
				if (usedTaskIds.has(taskId)) return false;
				return this.isTaskMatch(rawText, vt.title);
			});

			if (matched) {
				usedTaskIds.add(`${matched.filePath}:${matched.lineNumber}`);
				const widget = new TaskCardWidget(matched, this.plugin);
				const wrapper = document.createElement('div');
				wrapper.addClass('sbm-inline-task-wrapper');
				wrapper.appendChild(widget.render());
				el.replaceWith(wrapper);
			} else {
				const cleanLine = TaskMutator.cleanTaskPrefix(rawText);
				const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
				if (parsed) {
					const widget = new TaskCardWidget(parsed, this.plugin);
					const wrapper = document.createElement('div');
					wrapper.addClass('sbm-inline-task-wrapper');
					wrapper.appendChild(widget.render());
					el.replaceWith(wrapper);
				}
			}
		});
	}

	private async continueInChat(userMessage: string): Promise<void> {
		const conversation: ChatMessage[] = [];

		if (this.generatedRecoveryText) {
			conversation.push({
				role: 'assistant',
				content: this.generatedRecoveryText,
				timestamp: new Date().toISOString()
			});
		} else {
			conversation.push({
				role: 'assistant',
				content: 'Bon retour ! Je suis à votre écoute pour vous accompagner dans votre reprise en douceur.',
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
}
