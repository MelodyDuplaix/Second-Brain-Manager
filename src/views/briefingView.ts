import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskCardWidget } from './taskCardWidget';
import { MorningBriefingService, BriefingVaultData } from '../services/morningBriefingService';
import { SecretsManagementModal } from '../modals/secretsManagementModal';
import { ChatMessage } from '../models/llm';
import SecondBrainPlugin from '../main';

export const VIEW_TYPE_BRIEFING = 'sbm-briefing-view';

export class BriefingView extends ItemView {
	private plugin: SecondBrainPlugin;
	private isGenerating = false;
	private currentAbortController: AbortController | null = null;
	private generatedBriefingText = '';
	private briefingVaultData: BriefingVaultData | null = null;
	private vaultTasks: ObsidianTask[] = [];

	private contentElWrapper: HTMLElement | null = null;
	private responseAreaEl: HTMLElement | null = null;
	private energySelectEl: HTMLSelectElement | null = null;
	private modeBadgeEl: HTMLElement | null = null;
	private regenBtnEl: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_BRIEFING;
	}

	getDisplayText(): string {
		return 'Briefing du matin';
	}

	getIcon(): string {
		return 'sun';
	}

	async onOpen(): Promise<void> {
		await this.render();
		// Lancement automatique du briefing à l'ouverture si pas encore généré
		if (!this.generatedBriefingText) {
			await this.triggerBriefingGeneration();
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

		const currentEnergy = this.plugin.settings.energyLevel;
		const todayFormatted = new Date().toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
		const capDate = todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

		// 1. Header du Briefing
		const headerEl = container.createEl('div', { cls: 'sbm-briefing-view-header' });
		
		const titleRow = headerEl.createEl('div', { cls: 'sbm-briefing-title-row' });
		const titleLeft = titleRow.createEl('div', { cls: 'sbm-briefing-title-left' });
		
		const titleIcon = titleLeft.createSpan({ cls: 'sbm-briefing-header-icon' });
		setIcon(titleIcon, 'sun');
		
		const titleTextGroup = titleLeft.createDiv();
		titleTextGroup.createEl('h2', { text: 'Briefing du matin', cls: 'sbm-briefing-main-title' });
		titleTextGroup.createEl('span', { text: `📅 ${capDate}`, cls: 'sbm-briefing-date-sub' });

		// Bouton Régénérer en haut à droite
		this.regenBtnEl = titleRow.createEl('button', { cls: 'sbm-briefing-regen-btn' });
		setIcon(this.regenBtnEl, 'rotate-cw');
		this.regenBtnEl.createSpan({ text: 'Actualiser' });
		this.regenBtnEl.title = 'Relancer la génération du briefing';
		this.regenBtnEl.addEventListener('click', async () => {
			await this.triggerBriefingGeneration();
		});

		// 2. Barre d'Énergie Interactive
		const energyBar = headerEl.createEl('div', { cls: 'sbm-briefing-energy-bar' });
		const energyLeft = energyBar.createDiv({ cls: 'sbm-briefing-energy-left' });
		
		const energyLabel = energyLeft.createEl('label', { cls: 'sbm-briefing-energy-label' });
		setIcon(energyLabel.createSpan({ cls: 'sbm-energy-icon' }), 'zap');
		energyLabel.createSpan({ text: 'Votre énergie ce matin :' });

		this.energySelectEl = energyLeft.createEl('select', { cls: 'dropdown sbm-energy-dropdown' });
		for (let i = 1; i <= 10; i++) {
			const opt = this.energySelectEl.createEl('option', { value: i.toString(), text: `${i} / 10` });
			if (i === currentEnergy) opt.selected = true;
		}

		this.modeBadgeEl = energyBar.createDiv({
			cls: `sbm-mode-badge ${currentEnergy <= 3 ? 'economy' : currentEnergy <= 7 ? 'balanced' : 'full'}`,
			text: currentEnergy <= 3
				? '⚡ Mode Économie'
				: currentEnergy <= 7
					? '🌱 Mode Équilibré'
					: '🔥 Plein Potentiel'
		});

		this.energySelectEl.addEventListener('change', async () => {
			const val = parseInt(this.energySelectEl?.value || '5', 10);
			this.plugin.settings.energyLevel = val;
			await this.plugin.saveSettings();

			if (this.modeBadgeEl) {
				this.modeBadgeEl.className = `sbm-mode-badge ${val <= 3 ? 'economy' : val <= 7 ? 'balanced' : 'full'}`;
				this.modeBadgeEl.setText(
					val <= 3 ? '⚡ Mode Économie' : val <= 7 ? '🌱 Mode Équilibré' : '🔥 Plein Potentiel'
				);
			}

			new Notice(`Énergie mise à jour : ${val}/10. Actualisation du briefing...`);
			await this.triggerBriefingGeneration();
		});

		// 3. Zone de Contenu du Briefing (Carte Principale)
		this.contentElWrapper = container.createEl('div', { cls: 'sbm-briefing-card' });

		// 4. Zone de Réponse et de Transition vers le Chat
		this.responseAreaEl = container.createEl('div', { cls: 'sbm-briefing-chat-transition-card' });
		this.renderResponseArea();
	}

	private async triggerBriefingGeneration(): Promise<void> {
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
		const thinkingBox = this.contentElWrapper.createEl('div', { cls: 'sbm-thinking-box' });
		const spinnerIcon = thinkingBox.createEl('div', { cls: 'sbm-thinking-spinner' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });

		thinkingBox.createEl('span', {
			cls: 'sbm-thinking-label',
			text: '🧠 Analyse de votre coffre et préparation du programme du jour...'
		});

		const textDisplayEl = this.contentElWrapper.createEl('div', { cls: 'sbm-briefing-text-display sbm-msg-streaming' });

		this.currentAbortController = new AbortController();

		try {
			const result = await MorningBriefingService.generateBriefing(
				this.app,
				this.plugin,
				this.currentAbortController.signal,
				(_chunk, fullText) => {
					thinkingBox.remove();
					const clean = fullText.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
					textDisplayEl.setText(clean);
				}
			);

			this.generatedBriefingText = result.text;
			this.briefingVaultData = result.data;
			this.vaultTasks = result.allTasks;

			thinkingBox.remove();
			textDisplayEl.removeClass('sbm-msg-streaming');
			textDisplayEl.empty();

			const cleanedText = result.text.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
			await MarkdownRenderer.render(this.app, cleanedText, textDisplayEl, '', this);

			// Remplacement des tâches markdown par des widgets interactifs in-place
			await this.upgradeTaskElementsInPlace(textDisplayEl, cleanedText, this.vaultTasks);

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
				await this.triggerBriefingGeneration();
			});

			const secretsBtn = actionsBar.createEl('button', { cls: 'sbm-error-action-btn', text: '🔑 Gérer les clés d\'API' });
			secretsBtn.addEventListener('click', () => {
				new SecretsManagementModal(
					this.app,
					this.plugin,
					() => this.triggerBriefingGeneration(),
					this.plugin.settings.llmProvider
				).open();
			});

			new Notice(`Erreur lors de la génération du briefing : ${errorMsg.slice(0, 80)}`);
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

		const sectionTitleRow = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-chat-title-row' });
		const iconSpan = sectionTitleRow.createSpan({ cls: 'sbm-briefing-chat-icon' });
		setIcon(iconSpan, 'message-square');
		sectionTitleRow.createEl('h3', { text: 'Poursuivre la discussion ou ajuster le plan', cls: 'sbm-briefing-chat-title' });

		// 1. Boutons de réponses rapides suggérées (Chips)
		const chipsRow = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-chips-row' });
		
		const suggestions = [
			{ label: '🎯 Valider ce plan et commencer', prompt: 'Ce plan me convient parfaitement ! Aide-moi à démarrer la toute première tâche prioritaire.' },
			{ label: '⚡ Alléger mon planning aujourd\'hui', prompt: 'Je me sens plus fatigué que prévu, allège mon planning pour ne garder que le strict minimum vital.' },
			{ label: '⏩ Reporter les tâches non urgentes', prompt: 'Peux-tu me proposer de reporter à demain toutes les tâches non urgentes (Q3/Q4) ?' },
			{ label: '📝 Inscrire ce focus dans mon journal', prompt: 'Résume mon focus et mes tâches principales dans le journal de ma note quotidienne du jour.' },
			{ label: '🧩 Décomposer la tâche prioritaire', prompt: 'Peux-tu décomposer la tâche prioritaire du jour en sous-tâches simples et rapides ?' }
		];

		suggestions.forEach(s => {
			const chipBtn = chipsRow.createEl('button', { cls: 'sbm-briefing-chip-btn', text: s.label });
			chipBtn.addEventListener('click', async () => {
				await this.continueInChat(s.prompt);
			});
		});

		// 2. Champ de saisie fluide
		const inputForm = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-input-form' });
		const textarea = inputForm.createEl('textarea', {
			cls: 'sbm-briefing-textarea',
			placeholder: 'Poser une question sur ce plan, demander un ajustement ou affiner les priorités...'
		});

		const bottomActions = inputForm.createDiv({ cls: 'sbm-briefing-input-actions' });
		const submitBtn = bottomActions.createEl('button', {
			cls: 'sbm-briefing-submit-btn mod-cta',
			text: '💬 Continuer dans le Chat'
		});

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

	/**
	 * Transfère la conversation générée et la réponse de l'utilisateur directement dans la ChatView.
	 */
	private async continueInChat(userMessage: string): Promise<void> {
		const conversation: ChatMessage[] = [];

		// 1. Message assistant du Briefing du Matin
		if (this.generatedBriefingText) {
			conversation.push({
				role: 'assistant',
				content: this.generatedBriefingText,
				timestamp: new Date().toISOString()
			});
		} else {
			conversation.push({
				role: 'assistant',
				content: 'Bonjour ! Voici votre espace de travail Second Brain.',
				timestamp: new Date().toISOString()
			});
		}

		// 2. Message utilisateur
		conversation.push({
			role: 'user',
			content: userMessage,
			timestamp: new Date().toISOString()
		});

		// 3. Bascule instantanée vers la vue Chat et déclenchement automatique de l'IA
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
				TaskCardWidget.render(wrapper, matched, this.plugin, () => {
					// Actualisation visuelle au besoin
				});
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
					TaskCardWidget.render(wrapper, parsed, this.plugin, () => {
						// Actualisation visuelle au besoin
					});
					el.replaceWith(wrapper);
				}
			}
		});
	}
}
