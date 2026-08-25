import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { TaskCardWidget } from './taskCardWidget';
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

	private contentElWrapper: HTMLElement | null = null;
	private responseAreaEl: HTMLElement | null = null;
	private inactivityBadgeEl: HTMLElement | null = null;
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
		if (!this.generatedRecoveryText) {
			await this.triggerRecoveryGeneration();
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

		this.inactivityBadgeEl = headerActions.createDiv({ cls: 'sbm-evening-stats-badges' });
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
		this.renderFooterDock(container);
	}

	private renderHeaderBadges(): void {
		if (!this.inactivityBadgeEl) return;
		this.inactivityBadgeEl.empty();

		const text = this.recoveryVaultData?.inactivityText || 'Reprise de session';
		const badge = this.inactivityBadgeEl.createDiv({ cls: 'sbm-evening-stat-pill sbm-evening-stat-coins' });
		badge.createSpan({ text: `☕ ${text}` });

		if (this.recoveryVaultData && this.recoveryVaultData.overdueTasks.length > 0) {
			const overdueBadge = this.inactivityBadgeEl.createDiv({ cls: 'sbm-evening-stat-pill sbm-evening-stat-remaining' });
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

		// Zone de génération du plan de reprise
		this.responseAreaEl = this.contentElWrapper.createEl('div', { cls: 'sbm-briefing-ai-response' });

		if (this.generatedRecoveryText) {
			this.renderMarkdownWithTaskCards(this.responseAreaEl, this.generatedRecoveryText);
			this.renderDirectActionsBar(this.contentElWrapper);
		} else if (this.isGenerating) {
			this.renderLoadingPlaceholder(this.responseAreaEl);
		}
	}

	private renderDirectActionsBar(parentEl: HTMLElement): void {
		const actionsRow = parentEl.createEl('div', { cls: 'sbm-briefing-direct-actions-row' });

		// Bouton : Enregistrer dans la Daily Note
		const saveNoteBtn = actionsRow.createEl('button', { cls: 'sbm-briefing-action-btn sbm-action-primary' });
		setIcon(saveNoteBtn, 'calendar');
		saveNoteBtn.createSpan({ text: 'Enregistrer dans ma Daily Note' });
		saveNoteBtn.addEventListener('click', async () => {
			try {
				await RecoveryService.saveRecoveryToDailyNote(this.app, this.plugin, this.generatedRecoveryText);
				new Notice('Plan de reprise consigné avec succès dans votre Daily Note !');
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				new Notice(`Erreur lors de l'enregistrement : ${message}`);
			}
		});

		// Bouton : Reporter les tâches en retard à aujourd'hui
		if (this.recoveryVaultData && this.recoveryVaultData.overdueTasks.length > 0) {
			const postponeBtn = actionsRow.createEl('button', { cls: 'sbm-briefing-action-btn' });
			setIcon(postponeBtn, 'fast-forward');
			postponeBtn.createSpan({ text: `Reporter les retards (${this.recoveryVaultData.overdueTasks.length}) à aujourd'hui` });
			postponeBtn.addEventListener('click', async () => {
				try {
					const count = await RecoveryService.postponeOverdueTasks(
						this.app,
						this.recoveryVaultData?.overdueTasks || []
					);
					new Notice(`${count} tâche(s) reportée(s) avec succès à aujourd'hui !`);
					await this.triggerRecoveryGeneration();
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					new Notice(`Erreur lors du report : ${message}`);
				}
			});
		}
	}

	private renderLoadingPlaceholder(container: HTMLElement): void {
		container.empty();
		const loader = container.createEl('div', { cls: 'sbm-briefing-loader' });
		const spinner = loader.createDiv({ cls: 'sbm-briefing-spinner' });
		setIcon(spinner, 'coffee');
		loader.createEl('p', {
			cls: 'sbm-briefing-loading-text',
			text: 'Préparation bienveillante de votre reprise en douceur...'
		});
	}

	private renderFooterDock(container: HTMLElement): void {
		const dockEl = container.createEl('div', { cls: 'sbm-briefing-footer-dock' });

		// Suggestions rapides en puces cliquables
		const chipsRow = dockEl.createEl('div', { cls: 'sbm-briefing-chips-row' });

		const chips = [
			{ text: '🚀 Démarrer le Quick Win', prompt: 'Je vais commencer tout de suite par le Quick Win. Donne-moi des instructions très concrètes pour le boucler en 5 minutes chrono.' },
			{ text: '🎯 Se concentrer sur The One Thing', prompt: 'Je choisis de consacrer toute mon énergie disponible à ma tâche majeure aujourd\'hui. Aide-moi à la découper.' },
			{ text: '⏩ Reporter tout le reste à demain', prompt: 'Je souhaite reporter en masse toutes mes autres tâches en retard à demain pour garder l\'esprit léger.' },
			{ text: '📥 Classer mon Inbox', prompt: 'Aide-moi à trier rapidement les notes de ma boîte de réception.' }
		];

		chips.forEach(chip => {
			const chipBtn = chipsRow.createEl('button', {
				cls: 'sbm-briefing-chip',
				text: chip.text
			});
			chipBtn.addEventListener('click', async () => {
				await this.continueInChat(chip.prompt);
			});
		});

		// Zone de saisie pour poser une question / ajuster la reprise
		const inputRow = dockEl.createEl('div', { cls: 'sbm-briefing-input-row' });
		const textInput = inputRow.createEl('input', {
			type: 'text',
			cls: 'sbm-briefing-input-field',
			placeholder: 'Une question, un blocage ou un ajustement sur votre reprise...'
		});

		const sendBtn = inputRow.createEl('button', { cls: 'sbm-briefing-send-btn' });
		setIcon(sendBtn, 'send');
		sendBtn.title = 'Discuter avec l\'assistant IA dans le Chat';

		const submitAction = async () => {
			const query = textInput.value.trim();
			if (!query) return;
			textInput.value = '';
			await this.continueInChat(query);
		};

		sendBtn.addEventListener('click', submitAction);
		textInput.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				await submitAction();
			}
		});
	}

	public async triggerRecoveryGeneration(): Promise<void> {
		if (this.isGenerating) return;

		this.cancelCurrentGeneration();
		this.isGenerating = true;
		this.generatedRecoveryText = '';

		if (this.regenBtnEl) {
			this.regenBtnEl.disabled = true;
			this.regenBtnEl.addClass('is-loading');
		}

		if (this.responseAreaEl) {
			this.renderLoadingPlaceholder(this.responseAreaEl);
		}

		try {
			// 1. Collecter les données
			this.recoveryVaultData = await RecoveryService.collectRecoveryData(this.app, this.plugin);
			this.renderHeaderBadges();

			// Lecture de toutes les tâches pour les widgets in-place
			const files = this.app.vault.getMarkdownFiles();
			this.vaultTasks = [];
			for (const file of files) {
				const content = await this.app.vault.read(file);
				this.vaultTasks.push(...TaskParser.parseFile(content, file.path, this.plugin.settings));
			}

			// 2. Préparer les messages
			const messages = RecoveryService.buildRecoveryMessages(this.recoveryVaultData);

			// 3. Diffuser le streaming
			this.currentAbortController = new AbortController();

			let accumulatedText = '';
			let lastRenderTime = 0;

			await RecoveryService.streamRecovery(
				this.app,
				this.plugin,
				messages,
				(chunk: string) => {
					accumulatedText += chunk;
					this.generatedRecoveryText = accumulatedText;

					const now = Date.now();
					if (now - lastRenderTime > 80 && this.responseAreaEl) {
						lastRenderTime = now;
						this.responseAreaEl.empty();
						this.renderMarkdownWithTaskCards(this.responseAreaEl, accumulatedText);
					}
				},
				this.currentAbortController.signal
			);

			// Rendu final propre
			if (this.responseAreaEl) {
				this.responseAreaEl.empty();
				this.renderMarkdownWithTaskCards(this.responseAreaEl, this.generatedRecoveryText);
			}

			// Mise à jour de la session active
			if (this.plugin.pluginData) {
				this.plugin.pluginData.lastActiveSession = new Date().toISOString();
				await this.plugin.savePluginData();
			}

			if (this.contentElWrapper) {
				this.renderDirectActionsBar(this.contentElWrapper);
			}
		} catch (err: unknown) {
			if (this.currentAbortController?.signal.aborted) {
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			this.renderErrorCard(message);
		} finally {
			this.isGenerating = false;
			this.currentAbortController = null;
			if (this.regenBtnEl) {
				this.regenBtnEl.disabled = false;
				this.regenBtnEl.removeClass('is-loading');
			}
		}
	}

	private renderMarkdownWithTaskCards(container: HTMLElement, markdownText: string): void {
		container.empty();

		const tempDiv = document.createElement('div');
		tempDiv.addClass('sbm-briefing-rendered-markdown');

		MarkdownRenderer.render(
			this.app,
			markdownText,
			tempDiv,
			'',
			this
		);

		this.enrichTasksWithWidgets(tempDiv);
		container.appendChild(tempDiv);
	}

	private enrichTasksWithWidgets(renderedContainer: HTMLElement): void {
		const usedTaskIds = new Set<string>();

		const matchTaskFromVault = (text: string): ObsidianTask | null => {
			const cleanText = text
				.replace(/^[-*0-9.\s]+/, '')
				.replace(/^\[[ xX/]\]\s*/, '')
				.replace(/📅\s*\d{4}-\d{2}-\d{2}/, '')
				.replace(/⏳\s*\d{4}-\d{2}-\d{2}/, '')
				.replace(/🛫\s*\d{4}-\d{2}-\d{2}/, '')
				.replace(/#\S+/g, '')
				.replace(/\[\[.*?\]\]/g, '')
				.trim()
				.toLowerCase();

			if (!cleanText || cleanText.length < 3) return null;

			for (const task of this.vaultTasks) {
				const taskKey = `${task.filePath}:${task.lineNumber}`;
				if (usedTaskIds.has(taskKey)) continue;

				const cleanVaultTitle = task.title.trim().toLowerCase();
				if (cleanVaultTitle === cleanText || cleanVaultTitle.includes(cleanText) || cleanText.includes(cleanVaultTitle)) {
					return task;
				}
			}
			return null;
		};

		// 1. Traitement des listes
		const listItems = renderedContainer.querySelectorAll('li');
		listItems.forEach((li) => {
			const text = li.textContent || '';
			const isCheckbox = li.querySelector('input[type="checkbox"]') !== null || /^\[[ xX/]\]/.test(text.trim());

			if (isCheckbox || (text.includes('📅') && text.includes('#'))) {
				const matched = matchTaskFromVault(text);
				if (matched) {
					usedTaskIds.add(`${matched.filePath}:${matched.lineNumber}`);
					const card = new TaskCardWidget(matched, this.plugin, () => {
						// Rechargement après action si nécessaire
					});
					const cardEl = card.render();
					li.empty();
					li.appendChild(cardEl);
					li.addClass('sbm-briefing-injected-task');
				} else {
					const cleanLine = TaskMutator.cleanTaskPrefix(text);
					const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
					if (parsed) {
						const card = new TaskCardWidget(parsed, this.plugin);
						const cardEl = card.render();
						li.empty();
						li.appendChild(cardEl);
						li.addClass('sbm-briefing-injected-task');
					}
				}
			}
		});

		// 2. Traitement des blocs de code et tableaux contenant des tâches
		const inlineElements = renderedContainer.querySelectorAll('p, pre code, td');
		inlineElements.forEach((el) => {
			const text = el.textContent || '';
			if (
				el.querySelector('input[type="checkbox"]') !== null ||
				(text.includes('📅') && (text.includes('⚡') || text.includes('#tm/')))
			) {
				const cleanLine = TaskMutator.cleanTaskPrefix(text);
				const parsed = TaskParser.parseLine(`- [ ] ${cleanLine}`, 'Coffre', 1, this.plugin.settings);
				if (parsed) {
					const wrapper = document.createElement('div');
					const card = new TaskCardWidget(parsed, this.plugin);
					wrapper.appendChild(card.render());
					el.replaceWith(wrapper);
				}
			}
		});
	}

	private renderErrorCard(errorMessage: string): void {
		if (!this.responseAreaEl) return;
		this.responseAreaEl.empty();

		const errorBox = this.responseAreaEl.createEl('div', { cls: 'sbm-msg-error-bubble' });
		const header = errorBox.createEl('div', { cls: 'sbm-msg-error-header' });
		const titleGroup = header.createEl('div', { cls: 'sbm-msg-error-title' });
		const iconSpan = titleGroup.createSpan({ cls: 'sbm-msg-error-icon' });
		setIcon(iconSpan, 'alert-triangle');
		titleGroup.createSpan({ text: 'Erreur lors de la préparation de votre reprise' });

		const errorTextEl = errorBox.createEl('div', { cls: 'sbm-msg-error-text', text: errorMessage });

		const actionsRow = errorBox.createEl('div', { cls: 'sbm-msg-error-actions' });

		const retryBtn = actionsRow.createEl('button', { cls: 'sbm-msg-error-btn sbm-btn-retry' });
		setIcon(retryBtn, 'rotate-cw');
		retryBtn.createSpan({ text: 'Réessayer' });
		retryBtn.addEventListener('click', async () => {
			await this.triggerRecoveryGeneration();
		});

		const copyBtn = actionsRow.createEl('button', { cls: 'sbm-msg-error-btn' });
		setIcon(copyBtn, 'copy');
		copyBtn.createSpan({ text: 'Copier l\'erreur' });
		copyBtn.addEventListener('click', () => {
			navigator.clipboard.writeText(errorTextEl.innerText);
			new Notice('Erreur copiée dans le presse-papiers');
		});

		const secretsBtn = actionsRow.createEl('button', { cls: 'sbm-msg-error-btn' });
		setIcon(secretsBtn, 'key');
		secretsBtn.createSpan({ text: 'Gérer les clés d\'API' });
		secretsBtn.addEventListener('click', () => {
			new SecretsManagementModal(this.app, this.plugin, this.plugin.settings.llmProvider).open();
		});
	}

	private async continueInChat(userMessage: string): Promise<void> {
		const history: ChatMessage[] = [];

		if (this.generatedRecoveryText) {
			history.push({
				role: 'assistant',
				content: `### ☕ Reprise en Douceur\n\n${this.generatedRecoveryText}`
			});
		}

		history.push({
			role: 'user',
			content: userMessage
		});

		await this.plugin.openChatWithConversation(history);
	}
}
