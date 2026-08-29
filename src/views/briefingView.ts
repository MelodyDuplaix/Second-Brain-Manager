import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ObsidianTask } from '../models/task';
import { TaskParser } from '../parsers/taskParser';
import { TaskMutator } from '../mutators/taskMutator';
import { TaskCardWidget } from './taskCardWidget';
import { ActionPreviewWidget } from './actionPreviewWidget';
import { ActionExecutor } from '../services/actionExecutor';
import { MorningBriefingService, BriefingVaultData } from '../services/morningBriefingService';
import { SecretsManagementModal } from '../modals/secretsManagementModal';
import { ContextPickerModal, ContextItem } from '../modals/contextPickerModal';
import { VaultContextService } from '../services/vaultContextService';
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
	private selectedProject = 'all';

	private selectedEnergy = 5;
	private selectedPriorityFolders: string[] = [];
	private selectedPriorityFiles: string[] = [];
	private selectedPriorityTags: string[] = [];
	private customAdhocPriority = '';

	private contentElWrapper: HTMLElement | null = null;
	private responseAreaEl: HTMLElement | null = null;
	private energySelectEl: HTMLSelectElement | null = null;
	private modeBadgeEl: HTMLElement | null = null;
	private projectSelectEl: HTMLSelectElement | null = null;
	private regenBtnEl: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SecondBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.selectedEnergy = plugin.settings.energyLevel || 5;
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
		this.selectedEnergy = this.plugin.settings.energyLevel || 5;
		await this.render();
	}

	public async launchBriefingWithEnergy(energy: number): Promise<void> {
		this.selectedEnergy = energy;
		this.plugin.settings.energyLevel = energy;
		await this.plugin.saveSettings();
		this.cancelCurrentGeneration();
		this.generatedBriefingText = '';
		await this.render();
		void this.triggerBriefingGeneration();
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

		const currentEnergy = this.selectedEnergy;
		const todayFormatted = new Date().toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
		const capDate = todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

		// 1. Header fixe en haut
		const headerEl = container.createEl('div', { cls: 'sbm-briefing-view-header' });
		
		const titleRow = headerEl.createEl('div', { cls: 'sbm-briefing-title-row' });
		const titleLeft = titleRow.createEl('div', { cls: 'sbm-briefing-title-left' });
		
		const titleIcon = titleLeft.createSpan({ cls: 'sbm-briefing-header-icon' });
		setIcon(titleIcon, 'sun');
		
		const titleTextGroup = titleLeft.createDiv({ cls: 'sbm-briefing-title-group' });
		titleTextGroup.createEl('h2', { text: 'Briefing du matin', cls: 'sbm-briefing-main-title' });
		titleTextGroup.createEl('span', { text: `📅 ${capDate}`, cls: 'sbm-briefing-date-sub' });

		// Actions en haut à droite : Focus Projet + Énergie compacte + Bouton actualiser
		const headerActions = titleRow.createEl('div', { cls: 'sbm-briefing-header-actions' });

		// Sélecteur de Projet Prioritaire du Jour
		const projectGroup = headerActions.createDiv({ cls: 'sbm-briefing-project-compact' });
		const projectIconSpan = projectGroup.createSpan({ cls: 'sbm-project-icon-span' });
		setIcon(projectIconSpan, 'target');

		this.projectSelectEl = projectGroup.createEl('select', { cls: 'dropdown sbm-project-dropdown' });
		const allOpt = this.projectSelectEl.createEl('option', { value: 'all', text: '🎯 Tous les projets' });
		if (this.selectedProject === 'all') allOpt.selected = true;

		const vaultContext = new VaultContextService(this.app, this.plugin.settings);
		const vaultStructure = vaultContext.getVaultStructure();
		vaultStructure.projects.forEach(p => {
			const opt = this.projectSelectEl?.createEl('option', { value: p, text: `📁 ${p}` });
			if (opt && this.selectedProject === p) opt.selected = true;
		});

		this.projectSelectEl.addEventListener('change', async () => {
			this.selectedProject = this.projectSelectEl?.value || 'all';
			new Notice(this.selectedProject === 'all'
				? 'Focus global activé.'
				: `Focus projet activé : [[${this.selectedProject}]]`
			);
			if (this.generatedBriefingText) {
				await this.triggerBriefingGeneration();
			}
		});

		// Jauge d'énergie compacte
		const energyGroup = headerActions.createDiv({ cls: 'sbm-briefing-energy-compact' });
		const energyIconSpan = energyGroup.createSpan({ cls: 'sbm-energy-icon-span' });
		setIcon(energyIconSpan, 'zap');

		this.energySelectEl = energyGroup.createEl('select', { cls: 'dropdown sbm-energy-dropdown' });
		for (let i = 1; i <= 10; i++) {
			const opt = this.energySelectEl.createEl('option', { value: i.toString(), text: `${i}/10` });
			if (i === currentEnergy) opt.selected = true;
		}

		this.modeBadgeEl = energyGroup.createDiv({
			cls: `sbm-mode-badge ${currentEnergy <= 3 ? 'economy' : currentEnergy <= 7 ? 'balanced' : 'full'}`,
			text: currentEnergy <= 3
				? 'Économie'
				: currentEnergy <= 7
					? 'Équilibré'
					: 'Plein Potentiel'
		});

		this.energySelectEl.addEventListener('change', async () => {
			const val = parseInt(this.energySelectEl?.value || '5', 10);
			this.selectedEnergy = val;
			this.plugin.settings.energyLevel = val;
			await this.plugin.saveSettings();

			if (this.modeBadgeEl) {
				this.modeBadgeEl.className = `sbm-mode-badge ${val <= 3 ? 'economy' : val <= 7 ? 'balanced' : 'full'}`;
				this.modeBadgeEl.setText(
					val <= 3 ? 'Économie' : val <= 7 ? 'Équilibré' : 'Plein Potentiel'
				);
			}

			if (this.generatedBriefingText) {
				new Notice(`Énergie : ${val}/10. Actualisation du briefing...`);
				await this.triggerBriefingGeneration();
			}
		});

		this.regenBtnEl = headerActions.createEl('button', { cls: 'sbm-briefing-regen-btn' });
		setIcon(this.regenBtnEl, 'rotate-cw');
		this.regenBtnEl.createSpan({ text: 'Actualiser' });
		this.regenBtnEl.title = 'Relancer la génération du briefing';
		this.regenBtnEl.addEventListener('click', async () => {
			await this.triggerBriefingGeneration();
		});

		// 2. Corps central scrollable du Briefing (Document fluide et aéré)
		const scrollBody = container.createEl('div', { cls: 'sbm-briefing-scroll-body' });
		this.contentElWrapper = scrollBody.createEl('div', { cls: 'sbm-briefing-content-flow' });

		if (!this.generatedBriefingText) {
			this.renderPreflightCard();
		}

		// Délégation globale de clics : résout les wikilinks dans le briefing
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

		// 3. Footer fixe en bas pour la transition fluide vers le Chat
		this.responseAreaEl = container.createEl('div', { cls: 'sbm-briefing-footer-dock' });
		this.renderResponseArea();
	}

	private renderPreflightCard(): void {
		if (!this.contentElWrapper) return;
		this.contentElWrapper.empty();

		const preflightCard = this.contentElWrapper.createDiv({ cls: 'sbm-briefing-preflight-card' });

		// 1. Titre & Présentation Ultra-Compact
		const heroSection = preflightCard.createDiv({ cls: 'sbm-preflight-hero' });
		const heroTitleRow = heroSection.createDiv({ cls: 'sbm-preflight-hero-title-row' });
		const heroIcon = heroTitleRow.createSpan({ cls: 'sbm-preflight-hero-icon' });
		setIcon(heroIcon, 'sun');
		heroTitleRow.createEl('span', { text: 'Préparation du Briefing', cls: 'sbm-preflight-hero-title' });

		// 2. Section Niveau d'Énergie Compact
		const energySection = preflightCard.createDiv({ cls: 'sbm-preflight-section' });
		const energyHeader = energySection.createDiv({ cls: 'sbm-preflight-section-header' });
		
		const energyLeft = energyHeader.createDiv({ cls: 'sbm-preflight-section-header-left' });
		const energyIcon = energyLeft.createSpan({ cls: 'sbm-preflight-icon' });
		setIcon(energyIcon, 'zap');
		energyLeft.createEl('span', { text: 'Énergie', cls: 'sbm-preflight-section-title' });

		const modeBadgeSpan = energyHeader.createSpan({
			cls: `sbm-mode-badge ${this.selectedEnergy <= 3 ? 'economy' : this.selectedEnergy <= 7 ? 'balanced' : 'full'}`,
			text: this.selectedEnergy <= 3 ? 'Économie' : this.selectedEnergy <= 7 ? 'Équilibré' : 'Plein Potentiel'
		});

		const buttonsRow = energySection.createDiv({ cls: 'sbm-preflight-energy-buttons' });
		const energyButtons: HTMLElement[] = [];

		const updateEnergyUI = (val: number) => {
			this.selectedEnergy = val;
			this.plugin.settings.energyLevel = val;
			void this.plugin.saveSettings();

			if (this.energySelectEl) this.energySelectEl.value = val.toString();
			if (this.modeBadgeEl) {
				this.modeBadgeEl.className = `sbm-mode-badge ${val <= 3 ? 'economy' : val <= 7 ? 'balanced' : 'full'}`;
				this.modeBadgeEl.setText(val <= 3 ? 'Économie' : val <= 7 ? 'Équilibré' : 'Plein Potentiel');
			}

			modeBadgeSpan.className = `sbm-mode-badge ${val <= 3 ? 'economy' : val <= 7 ? 'balanced' : 'full'}`;
			modeBadgeSpan.setText(val <= 3 ? 'Économie' : val <= 7 ? 'Équilibré' : 'Plein Potentiel');

			energyButtons.forEach((b, idx) => {
				if (idx + 1 === val) b.addClass('is-selected');
				else b.removeClass('is-selected');
			});
		};

		for (let i = 1; i <= 10; i++) {
			const btn = buttonsRow.createEl('button', {
				cls: `sbm-preflight-energy-btn ${i === this.selectedEnergy ? 'is-selected' : ''}`,
				text: `${i}`
			});
			btn.addEventListener('click', () => updateEnergyUI(i));
			energyButtons.push(btn);
		}

		updateEnergyUI(this.selectedEnergy);

		// 3. Section Dossiers & Fichiers Prioritaires Compacte
		const prioritySection = preflightCard.createDiv({ cls: 'sbm-preflight-section' });
		const priorityHeader = prioritySection.createDiv({ cls: 'sbm-preflight-section-header' });
		
		const priorityLeft = priorityHeader.createDiv({ cls: 'sbm-preflight-section-header-left' });
		const priorityIcon = priorityLeft.createSpan({ cls: 'sbm-preflight-icon' });
		setIcon(priorityIcon, 'target');
		priorityLeft.createEl('span', { text: 'Focus & Priorités (Dossiers, Fichiers, Tags)', cls: 'sbm-preflight-section-title' });

		const addContextBtn = priorityHeader.createEl('button', {
			cls: 'sbm-preflight-add-btn',
			text: '+ Ajouter...'
		});
		addContextBtn.addEventListener('click', () => {
			new ContextPickerModal(this.app, (item: ContextItem) => {
				if (item.type === 'folder') {
					if (!this.selectedPriorityFolders.includes(item.path)) {
						this.selectedPriorityFolders.push(item.path);
					}
				} else if (item.type === 'tag') {
					const cleanTag = item.path.replace(/^#/, '');
					if (!this.selectedPriorityTags.includes(cleanTag)) {
						this.selectedPriorityTags.push(cleanTag);
					}
				} else {
					if (!this.selectedPriorityFiles.includes(item.path)) {
						this.selectedPriorityFiles.push(item.path);
					}
				}
				renderChips();
			}, this.plugin.settings).open();
		});

		const chipsContainer = prioritySection.createDiv({ cls: 'sbm-preflight-chips-container' });

		const renderChips = () => {
			chipsContainer.empty();
			const hasNoContext = this.selectedPriorityFolders.length === 0 &&
				this.selectedPriorityFiles.length === 0 &&
				this.selectedPriorityTags.length === 0;

			if (hasNoContext) {
				chipsContainer.createSpan({ cls: 'sbm-preflight-empty-chips', text: 'Aucun focus spécifique sélectionné (analyse globale du coffre).' });
			} else {
				this.selectedPriorityFolders.forEach((folderPath) => {
					const chip = chipsContainer.createDiv({ cls: 'sbm-preflight-chip is-folder' });
					const iconSpan = chip.createSpan({ cls: 'sbm-chip-icon' });
					setIcon(iconSpan, 'folder');
					chip.createSpan({ cls: 'sbm-chip-text', text: folderPath });
					const delBtn = chip.createSpan({ cls: 'sbm-chip-remove', text: '×' });
					delBtn.title = 'Retirer ce dossier';
					delBtn.addEventListener('click', () => {
						this.selectedPriorityFolders = this.selectedPriorityFolders.filter(f => f !== folderPath);
						renderChips();
					});
				});

				this.selectedPriorityFiles.forEach((filePath) => {
					const chip = chipsContainer.createDiv({ cls: 'sbm-preflight-chip is-file' });
					const iconSpan = chip.createSpan({ cls: 'sbm-chip-icon' });
					setIcon(iconSpan, 'file-text');
					chip.createSpan({ cls: 'sbm-chip-text', text: filePath.split('/').pop() || filePath });
					const delBtn = chip.createSpan({ cls: 'sbm-chip-remove', text: '×' });
					delBtn.title = 'Retirer ce fichier';
					delBtn.addEventListener('click', () => {
						this.selectedPriorityFiles = this.selectedPriorityFiles.filter(f => f !== filePath);
						renderChips();
					});
				});

				this.selectedPriorityTags.forEach((tag) => {
					const chip = chipsContainer.createDiv({ cls: 'sbm-preflight-chip is-tag' });
					const iconSpan = chip.createSpan({ cls: 'sbm-chip-icon' });
					setIcon(iconSpan, 'tag');
					chip.createSpan({ cls: 'sbm-chip-text', text: `#${tag}` });
					const delBtn = chip.createSpan({ cls: 'sbm-chip-remove', text: '×' });
					delBtn.title = 'Retirer ce tag';
					delBtn.addEventListener('click', () => {
						this.selectedPriorityTags = this.selectedPriorityTags.filter(t => t !== tag);
						renderChips();
					});
				});
			}
		};

		renderChips();

		// 4. Section Priorité ou Consigne Spécifique (Hors Note)
		const adhocSection = preflightCard.createDiv({ cls: 'sbm-preflight-section' });
		const adhocHeader = adhocSection.createDiv({ cls: 'sbm-preflight-section-header' });
		const adhocLeft = adhocHeader.createDiv({ cls: 'sbm-preflight-section-header-left' });
		const adhocIcon = adhocLeft.createSpan({ cls: 'sbm-preflight-icon' });
		setIcon(adhocIcon, 'sparkles');
		adhocLeft.createEl('span', { text: 'Priorité ou consigne spécifique (hors note)', cls: 'sbm-preflight-section-title' });

		const adhocInputWrapper = adhocSection.createDiv({ cls: 'sbm-preflight-adhoc-wrapper' });
		const adhocInput = adhocInputWrapper.createEl('textarea', {
			cls: 'sbm-preflight-adhoc-textarea',
			placeholder: 'Ex: Préparer l\'intervention de 14h, finaliser la release avant midi, appeler le comptable...'
		});
		adhocInput.value = this.customAdhocPriority;
		adhocInput.rows = 2;
		adhocInput.addEventListener('input', () => {
			this.customAdhocPriority = adhocInput.value;
		});

		// 5. Bouton Principal de Démarrage
		const startActionSection = preflightCard.createDiv({ cls: 'sbm-preflight-cta-section' });
		const startBtn = startActionSection.createEl('button', {
			cls: 'sbm-preflight-start-btn',
			text: '🚀 Lancer le Briefing'
		});
		startBtn.addEventListener('click', async () => {
			await this.triggerBriefingGeneration();
		});
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

		// Indicateur de chargement / réflexion animé
		const thinkingBox = this.contentElWrapper.createEl('div', { cls: 'sbm-thinking-box sbm-briefing-loading' });
		const spinnerIcon = thinkingBox.createEl('div', { cls: 'sbm-thinking-spinner' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });
		spinnerIcon.createSpan({ cls: 'sbm-dot' });

		const focusText = this.selectedProject !== 'all' ? ` (Focus : ${this.selectedProject})` : '';
		thinkingBox.createEl('span', {
			cls: 'sbm-thinking-label',
			text: `🧠 Analyse du coffre et préparation de votre programme du jour${focusText}...`
		});

		const textDisplayEl = this.contentElWrapper.createEl('div', { cls: 'sbm-briefing-text-display sbm-msg-streaming' });

		// 0. Ouverture et création immédiate de la note quotidienne du jour si configurée
		if (this.plugin.settings.autoOpenDailyNoteOnBriefing !== false) {
			try {
				const vaultContext = new VaultContextService(this.app, this.plugin.settings);
				const todayStr = new Date().toISOString().split('T')[0];
				const dailyRes = await vaultContext.getOrCreateDailyNote(todayStr, this.plugin.settings.dailyNoteTemplatePath);
				if (dailyRes.file) {
					await vaultContext.openDailyNoteInWorkspace(dailyRes.file);
				}
			} catch (e) {
				console.warn('[Second Brain Manager] Impossible de créer ou d\'ouvrir la note quotidienne:', e);
			}
		}

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
				},
				{
					focusProject: this.selectedProject,
					priorityFolders: this.selectedPriorityFolders,
					priorityFiles: this.selectedPriorityFiles,
					priorityTags: this.selectedPriorityTags,
					adhocPriority: this.customAdhocPriority,
					energy: this.selectedEnergy
				}
			);

			// 1. Extraction des propositions d'actions structurées et nettoyage du texte markdown
			const { cleanText, proposals } = MorningBriefingService.extractProposalsFromResponse(
				result.text,
				this.vaultTasks,
				result.data.dateStr
			);

			this.generatedBriefingText = cleanText;
			this.briefingVaultData = result.data;
			this.vaultTasks = result.allTasks;

			thinkingBox.remove();
			textDisplayEl.removeClass('sbm-msg-streaming');
			textDisplayEl.empty();

			// 0. Bannière d'encombrement & mode reprise
			if (result.data.isRecoveryMode || result.data.isCluttered) {
				const clutterBanner = textDisplayEl.createDiv({ cls: 'sbm-clutter-alert-banner is-recovery-active' });
				const infoBox = clutterBanner.createDiv({ cls: 'sbm-clutter-info' });
				infoBox.createSpan({ cls: 'sbm-clutter-title', text: '🧹 Mode Reprise & Décongestion activé (Tri Large)' });
				infoBox.createSpan({
					cls: 'sbm-clutter-desc',
					text: `${result.data.overdueTasks.length} tâches en retard et ${result.data.inboxNotePreviews.length} notes non classées détectées (${result.data.inactivityText}). Un tri large et déculpabilisant a été préparé ci-dessous.`
				});
			}

			// 1. Barre d'actions du document (Copier + Daily note + Planification)
			const briefingActionBar = textDisplayEl.createDiv({ cls: 'sbm-briefing-document-actions' });

			const copyBtn = briefingActionBar.createEl('button', {
				cls: 'sbm-doc-action-btn',
				text: '📋 Copier la réponse'
			});
			copyBtn.title = 'Copier l\'intégralité du texte du briefing dans le presse-papier';
			copyBtn.addEventListener('click', async () => {
				try {
					await navigator.clipboard.writeText(cleanText);
					new Notice('Briefing copié dans le presse-papier !');
				} catch {
					new Notice('Impossible de copier automatiquement dans le presse-papier.');
				}
			});

			const saveDailyBtn = briefingActionBar.createEl('button', {
				cls: 'sbm-doc-action-btn',
				text: '📝 Enregistrer dans ma Daily Note'
			});
			saveDailyBtn.title = 'Inscrire ce plan dans la note quotidienne du jour';
			saveDailyBtn.addEventListener('click', async () => {
				const path = await MorningBriefingService.saveBriefingToDailyNote(
					this.app,
					this.plugin,
					cleanText,
					result.data.dateStr
				);
				new Notice(`Briefing enregistré dans [[${path}]] !`);
				saveDailyBtn.setText('📄 Ouvrir la Daily Note');
				saveDailyBtn.addClass('is-saved');
				saveDailyBtn.onclick = async () => {
					await this.app.workspace.openLinkText(path, '', false);
				};
			});

			const planTasksBtn = briefingActionBar.createEl('button', {
				cls: 'sbm-doc-action-btn',
				text: '📅 Planifier ces tâches pour aujourd\'hui'
			});
			planTasksBtn.title = 'Appliquer la date du jour aux tâches recommandées dans leurs fichiers sources';
			planTasksBtn.addEventListener('click', async () => {
				const count = await MorningBriefingService.planTasksForToday(
					this.app,
					this.plugin,
					this.vaultTasks,
					result.data.dateStr
				);
				new Notice(`${count} tâche(s) planifiée(s) pour aujourd'hui !`);
			});

			// 2. Widget interactif des propositions d'actions avec boutons Approuver / Rejeter
			if (proposals.length > 0) {
				const executor = new ActionExecutor(this.app, this.plugin.settings);
				ActionPreviewWidget.render(
					textDisplayEl,
					proposals,
					executor,
					this.app,
					() => {
						new Notice('Modifications du briefing appliquées avec succès !');
					}
				);
			}

			// 3. Rendu du corps Markdown
			const cleanedText = cleanText.replace(/`(\[\[[^`\]]+\]\])`/g, '$1');
			const textBodyContainer = textDisplayEl.createDiv({ cls: 'sbm-briefing-rendered-body' });
			await MarkdownRenderer.render(this.app, cleanedText, textBodyContainer, '', this);

			// 4. Remplacement des tâches markdown par des widgets interactifs in-place
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

		const footerCard = this.responseAreaEl.createDiv({ cls: 'sbm-briefing-chat-dock-card' });

		// 1. Boutons de réponses rapides suggérées (Chips)
		const chipsRow = footerCard.createDiv({ cls: 'sbm-briefing-chips-row' });
		
		const suggestions = [
			{ label: '🎯 Valider ce plan', prompt: 'Ce plan me convient parfaitement ! Aide-moi à démarrer la toute première tâche prioritaire.' },
			{ label: '⚡ Alléger mon planning', prompt: 'Je me sens plus fatigué que prévu, allège mon planning pour ne garder que le strict minimum vital.' },
			{ label: '⏩ Reporter le non urgent', prompt: 'Peux-tu me proposer de reporter à demain toutes les tâches non urgentes (Q3/Q4) ?' },
			{ label: '📝 Noter dans mon journal', prompt: 'Résume mon focus et mes tâches principales dans le journal de ma note quotidienne du jour.' },
			{ label: '🧩 Décomposer la priorité', prompt: 'Peux-tu décomposer la tâche prioritaire du jour en sous-tâches simples et rapides ?' }
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
			placeholder: 'Répondre au briefing, demander un ajustement ou affiner votre programme...'
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
					const cleanLine = TaskMutator.cleanTaskPrefix(line);
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

		// B. Tableaux markdown <table> contenant des tâches
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
				const cleanLine = TaskMutator.cleanTaskPrefix(text);
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
