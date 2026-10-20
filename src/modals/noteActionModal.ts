import { App, Modal, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';
import { NoteActionType, NoteActionsService } from '../services/noteActionsService';

export interface NoteActionModalOptions {
	title: string;
	icon: string;
	actionType: NoteActionType | string;
	sourceText: string;
	overrideModel?: string;
	generateInitial: () => Promise<string>;
	onApplyReplace: (result: string) => void;
	onApplyInsert: (result: string) => void;
}

export class NoteActionModal extends Modal {
	private plugin: SecondBrainPlugin;
	private options: NoteActionModalOptions;
	private currentResult = '';
	private isLoading = false;

	private resultTextareaEl!: HTMLTextAreaElement;
	private loadingEl!: HTMLElement;
	private followupInputEl!: HTMLInputElement;
	private followupBtnEl!: HTMLButtonElement;
	private copyBtnEl!: HTMLButtonElement;
	private insertBtnEl!: HTMLButtonElement;
	private replaceBtnEl!: HTMLButtonElement;
	private errorEl!: HTMLElement;

	constructor(app: App, plugin: SecondBrainPlugin, options: NoteActionModalOptions) {
		super(app);
		this.plugin = plugin;
		this.options = options;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('sbm-note-action-modal');

		// 1. En-tête personnalisé (Icône + Titre + Bouton de fermeture)
		const header = contentEl.createDiv({ cls: 'sbm-note-action-header' });
		const titleGroup = header.createDiv({ cls: 'sbm-note-action-title-group' });
		const iconSpan = titleGroup.createSpan({ cls: 'sbm-note-action-title-icon' });
		setIcon(iconSpan, this.options.icon || 'sparkles');
		titleGroup.createSpan({ text: this.options.title, cls: 'sbm-note-action-title-text' });

		if (this.options.overrideModel) {
			titleGroup.createSpan({
				text: `⚡ ${this.options.overrideModel}`,
				cls: 'sbm-note-action-model-badge'
			});
		}

		const closeBtn = header.createEl('button', {
			cls: 'sbm-note-action-close-btn',
			attr: { 'aria-label': 'Fermer' }
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		// 2. Zone de prévisualisation / Résultat éditable
		const contentBox = contentEl.createDiv({ cls: 'sbm-note-action-content-box' });

		this.loadingEl = contentBox.createDiv({ cls: 'sbm-note-action-loading' });
		this.loadingEl.createDiv({ cls: 'sbm-note-action-spinner' });
		this.loadingEl.createSpan({ text: 'Génération en cours...' });

		this.errorEl = contentBox.createDiv({ cls: 'sbm-note-action-error sbm-hidden' });
		this.errorEl.style.display = 'none';

		this.resultTextareaEl = contentBox.createEl('textarea', {
			cls: 'sbm-note-action-textarea sbm-hidden',
			attr: {
				placeholder: 'Le résultat généré apparaîtra ici...',
				spellcheck: 'false'
			}
		});
		this.resultTextareaEl.style.display = 'none';

		this.resultTextareaEl.addEventListener('input', () => {
			this.currentResult = this.resultTextareaEl.value;
		});

		// 3. Zone de suivi / affinage (Enter follow-up instructions...)
		const followupRow = contentEl.createDiv({ cls: 'sbm-note-action-followup-row' });
		this.followupInputEl = followupRow.createEl('input', {
			cls: 'sbm-note-action-followup-input',
			attr: {
				type: 'text',
				placeholder: 'Enter follow-up instructions... (ex: plus concis, ton formel...)'
			}
		});

		this.followupBtnEl = followupRow.createEl('button', {
			cls: 'sbm-note-action-followup-btn',
			attr: { 'aria-label': 'Envoyer la consigne' }
		});
		setIcon(this.followupBtnEl, 'corner-down-left');

		const triggerFollowup = async () => {
			const instruction = this.followupInputEl.value.trim();
			if (!instruction || this.isLoading) return;
			await this.executeFollowUp(instruction);
		};

		this.followupBtnEl.addEventListener('click', triggerFollowup);
		this.followupInputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				triggerFollowup();
			}
		});

		// 4. Barre d'action inférieure (Modèle à gauche, boutons à droite)
		const footer = contentEl.createDiv({ cls: 'sbm-note-action-footer' });

		const modelBadge = footer.createDiv({ cls: 'sbm-note-action-model-badge' });
		const modelIcon = modelBadge.createSpan({ cls: 'sbm-model-badge-icon' });
		setIcon(modelIcon, 'bot');
		const activeModel = this.plugin.settings.llmModel || 'LLM';
		modelBadge.createSpan({ text: activeModel });

		const buttonsGroup = footer.createDiv({ cls: 'sbm-note-action-buttons-group' });

		// Bouton Copier
		this.copyBtnEl = buttonsGroup.createEl('button', {
			cls: 'sbm-note-action-btn',
			text: 'Copy'
		});
		this.copyBtnEl.addEventListener('click', () => this.handleCopy());

		// Bouton Insérer (Ctrl + Shift + Enter)
		this.insertBtnEl = buttonsGroup.createEl('button', {
			cls: 'sbm-note-action-btn'
		});
		this.insertBtnEl.createSpan({ text: 'Insert' });
		this.insertBtnEl.createSpan({ text: 'Ctrl ⇧ ↵', cls: 'sbm-note-action-shortcut-hint' });
		this.insertBtnEl.addEventListener('click', () => this.handleInsert());

		// Bouton Remplacer (Ctrl + Enter) - Primaire
		this.replaceBtnEl = buttonsGroup.createEl('button', {
			cls: 'sbm-note-action-btn primary'
		});
		this.replaceBtnEl.createSpan({ text: 'Replace' });
		this.replaceBtnEl.createSpan({ text: 'Ctrl ↵', cls: 'sbm-note-action-shortcut-hint' });
		this.replaceBtnEl.addEventListener('click', () => this.handleReplace());

		// Raccourcis clavier de la modale
		this.scope.register(['Mod'], 'Enter', () => {
			if (!this.isLoading && this.currentResult.trim()) {
				this.handleReplace();
			}
			return false;
		});

		this.scope.register(['Mod', 'Shift'], 'Enter', () => {
			if (!this.isLoading && this.currentResult.trim()) {
				this.handleInsert();
			}
			return false;
		});

		// 5. Lancement de la génération initiale
		this.readyPromise = this.executeInitialGeneration();
	}

	public readyPromise: Promise<void> | null = null;

	private setButtonsDisabled(disabled: boolean): void {
		if (this.copyBtnEl) this.copyBtnEl.disabled = disabled;
		if (this.insertBtnEl) this.insertBtnEl.disabled = disabled;
		if (this.replaceBtnEl) this.replaceBtnEl.disabled = disabled;
		if (this.followupBtnEl) this.followupBtnEl.disabled = disabled;
		if (this.followupInputEl) this.followupInputEl.disabled = disabled;
	}

	private showLoadingState(): void {
		this.setButtonsDisabled(true);
		if (this.loadingEl) {
			this.loadingEl.removeClass('sbm-hidden');
			this.loadingEl.style.display = 'flex';
		}
		if (this.resultTextareaEl) {
			this.resultTextareaEl.addClass('sbm-hidden');
			this.resultTextareaEl.style.display = 'none';
		}
		if (this.errorEl) {
			this.errorEl.addClass('sbm-hidden');
			this.errorEl.style.display = 'none';
		}
	}

	private showResultState(): void {
		this.setButtonsDisabled(false);
		if (this.loadingEl) {
			this.loadingEl.addClass('sbm-hidden');
			this.loadingEl.style.display = 'none';
		}
		if (this.resultTextareaEl) {
			this.resultTextareaEl.removeClass('sbm-hidden');
			this.resultTextareaEl.style.display = 'block';
		}
		if (this.errorEl) {
			this.errorEl.addClass('sbm-hidden');
			this.errorEl.style.display = 'none';
		}
	}

	private showErrorState(message: string, onRetry: () => void): void {
		this.setButtonsDisabled(false);
		if (this.loadingEl) {
			this.loadingEl.addClass('sbm-hidden');
			this.loadingEl.style.display = 'none';
		}
		if (this.resultTextareaEl) {
			this.resultTextareaEl.addClass('sbm-hidden');
			this.resultTextareaEl.style.display = 'none';
		}
		if (this.errorEl) {
			this.errorEl.empty();
			this.errorEl.removeClass('sbm-hidden');
			this.errorEl.style.display = 'flex';

			const msgRow = this.errorEl.createDiv({ cls: 'sbm-note-action-error-msg' });
			const warnIcon = msgRow.createSpan();
			setIcon(warnIcon, 'alert-triangle');
			msgRow.createSpan({ text: `Erreur : ${message}` });

			const retryBtn = this.errorEl.createEl('button', {
				cls: 'sbm-note-action-btn',
				text: 'Réessayer'
			});
			retryBtn.addEventListener('click', onRetry);
		}
	}

	public async executeInitialGeneration(): Promise<void> {
		this.isLoading = true;
		this.showLoadingState();

		try {
			const result = await this.options.generateInitial();
			this.currentResult = result;
			if (this.resultTextareaEl) this.resultTextareaEl.value = result;

			this.showResultState();
			this.followupInputEl?.focus();
		} catch (err: unknown) {
			this.showErrorState(err instanceof Error ? err.message : String(err), () => this.executeInitialGeneration());
		} finally {
			this.isLoading = false;
		}
	}

	public async executeFollowUp(instruction: string): Promise<void> {
		this.isLoading = true;
		this.showLoadingState();

		try {
			const refined = await NoteActionsService.refineResult(
				this.options.sourceText,
				this.currentResult,
				instruction,
				this.options.actionType,
				this.plugin,
				this.options.overrideModel
			);
			this.currentResult = refined;
			if (this.resultTextareaEl) this.resultTextareaEl.value = refined;
			if (this.followupInputEl) this.followupInputEl.value = '';

			this.showResultState();
			this.resultTextareaEl?.focus();
		} catch (err: unknown) {
			this.showErrorState(err instanceof Error ? err.message : String(err), () => this.executeFollowUp(instruction));
		} finally {
			this.isLoading = false;
		}
	}

	public async handleCopy(): Promise<void> {
		if (!this.currentResult) return;
		try {
			await navigator.clipboard.writeText(this.currentResult);
			const originalText = this.copyBtnEl.innerText;
			this.copyBtnEl.innerText = '✓ Copied!';
			setTimeout(() => {
				if (this.copyBtnEl) this.copyBtnEl.innerText = originalText;
			}, 1500);
		} catch {
			new Notice('Erreur lors de la copie dans le presse-papier.');
		}
	}

	public handleReplace(): void {
		if (!this.currentResult.trim()) return;
		this.options.onApplyReplace(this.currentResult);
		this.close();
		new Notice('✅ Remplacé avec succès !');
	}

	public handleInsert(): void {
		if (!this.currentResult.trim()) return;
		this.options.onApplyInsert(this.currentResult);
		this.close();
		new Notice('✅ Inséré avec succès !');
	}
}
