import { App, Modal, Notice, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';
import { NoteActionType, NoteActionsService } from '../services/noteActionsService';
import { ModelPickerModal } from './modelPickerModal';
import { LLMProvider } from '../models/llm';

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
	private currentModel: string;
	private currentProvider?: LLMProvider;

	private headerModelBadgeEl?: HTMLElement;
	private modelBtnEl?: HTMLButtonElement;
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
		this.currentModel = (options.overrideModel && options.overrideModel.trim())
			? options.overrideModel.trim()
			: (plugin.settings.llmModel || 'LLM');
		this.currentProvider = plugin.settings.llmProvider;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('sbm-note-action-modal');
		// Fenêtre non bloquante : pas de voile, la note en dessous reste cliquable et sélectionnable
		(this.containerEl as HTMLElement | undefined)?.addClass('sbm-note-action-container');

		// 1. En-tête personnalisé (Icône + Titre + Bouton de fermeture)
		const header = contentEl.createDiv({ cls: 'sbm-note-action-header' });
		const titleGroup = header.createDiv({ cls: 'sbm-note-action-title-group' });
		const iconSpan = titleGroup.createSpan({ cls: 'sbm-note-action-title-icon' });
		setIcon(iconSpan, this.options.icon || 'sparkles');
		titleGroup.createSpan({ text: this.options.title, cls: 'sbm-note-action-title-text' });

		this.headerModelBadgeEl = titleGroup.createSpan({
			cls: 'sbm-note-action-model-header-badge'
		});
		this.updateHeaderModelBadge();

		this.makeDraggable(header);
		if (NoteActionModal.lastPosition) this.placeAt(NoteActionModal.lastPosition.left, NoteActionModal.lastPosition.top);

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

		this.modelBtnEl = footer.createEl('button', {
			cls: 'sbm-note-action-model-btn',
			attr: {
				type: 'button',
				title: 'Cliquer pour changer de modèle IA pour la réponse'
			}
		});
		this.updateModelBtn();
		this.modelBtnEl.addEventListener('click', (e) => {
			e.preventDefault();
			this.openModelPicker();
		});

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
		// Les raccourcis ne valent que si le focus est dans la fenêtre (la note reste éditable en dessous)
		this.scope.register(['Mod'], 'Enter', () => {
			if (!this.hasFocusInside()) return true;
			if (!this.isLoading && this.currentResult.trim()) {
				this.handleReplace();
			}
			return false;
		});

		this.scope.register(['Mod', 'Shift'], 'Enter', () => {
			if (!this.hasFocusInside()) return true;
			if (!this.isLoading && this.currentResult.trim()) {
				this.handleInsert();
			}
			return false;
		});

		// 5. Lancement de la génération initiale
		this.readyPromise = this.executeInitialGeneration();
	}

	public readyPromise: Promise<void> | null = null;

	private floating = false;
	private scopePushed = false;

	private get keymap(): { pushScope(s: unknown): void; popScope(s: unknown): void } | undefined {
		return (this.app as unknown as { keymap?: { pushScope(s: unknown): void; popScope(s: unknown): void } })?.keymap;
	}

	private pushScope(): void {
		if (this.scopePushed || !this.keymap) return;
		this.keymap.pushScope(this.scope);
		this.scopePushed = true;
	}

	private popScope(): void {
		if (!this.scopePushed || !this.keymap) return;
		this.keymap.popScope(this.scope);
		this.scopePushed = false;
	}

	/**
	 * Ouverture en fenêtre flottante non modale : la `Modal` d'Obsidian ramène le focus dans la fenêtre
	 * dès qu'on clique ailleurs, ce qui rend la sélection dans la note impossible (scintillement).
	 * On attache donc nous-mêmes la fenêtre, et ses raccourcis ne sont actifs que si le focus y est.
	 */
	open(): void {
		if (!this.keymap || !this.containerEl) {
			super.open();
			return;
		}
		if (this.floating) return;
		this.floating = true;
		document.body.appendChild(this.containerEl);
		this.modalEl.addEventListener('focusin', () => this.pushScope());
		this.modalEl.addEventListener('focusout', (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (!next || !this.modalEl.contains(next)) this.popScope();
		});
		this.modalEl.querySelector('.modal-close-button')?.addEventListener('click', () => this.close());
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});
		this.modalEl.tabIndex = -1;
		this.onOpen();
		if (!this.modalEl.contains(document.activeElement)) this.modalEl.focus();
	}

	close(): void {
		if (!this.floating) {
			super.close();
			return;
		}
		this.floating = false;
		this.popScope();
		this.containerEl.detach();
		this.onClose();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private hasFocusInside(): boolean {
		const active = document.activeElement;
		return !active || active === document.body || this.modalEl.contains(active);
	}

	/** Dernière position choisie par glisser-déposer, réutilisée à la prochaine ouverture (durée de la session). */
	private static lastPosition: { left: number; top: number } | null = null;

	/** Positionne la fenêtre en coordonnées écran, en la gardant au moins en partie visible. */
	private placeAt(left: number, top: number): void {
		const { modalEl } = this;
		const width = modalEl.offsetWidth || 300;
		const margin = 40;
		const x = Math.min(Math.max(left, margin - width), window.innerWidth - margin);
		const y = Math.min(Math.max(top, 0), window.innerHeight - margin);
		modalEl.addClass('sbm-note-action-modal--moved');
		modalEl.style.left = `${x}px`;
		modalEl.style.top = `${y}px`;
	}

	/** Permet de déplacer la fenêtre en tirant son en-tête ; double-clic pour la recentrer. */
	private makeDraggable(handle: HTMLElement): void {
		const { modalEl } = this;
		handle.addClass('sbm-note-action-drag-handle');
		handle.setAttribute('title','Glisser pour déplacer · double-clic pour recentrer');
		handle.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, textarea, a')) return;
			e.preventDefault();
			const rect = modalEl.getBoundingClientRect();
			const offsetX = e.clientX - rect.left;
			const offsetY = e.clientY - rect.top;
			this.placeAt(rect.left, rect.top);
			modalEl.addClass('is-dragging');
			handle.setPointerCapture(e.pointerId);
			const onMove = (ev: PointerEvent) => this.placeAt(ev.clientX - offsetX, ev.clientY - offsetY);
			const onUp = () => {
				handle.removeEventListener('pointermove', onMove);
				handle.removeEventListener('pointerup', onUp);
				handle.removeEventListener('pointercancel', onUp);
				modalEl.removeClass('is-dragging');
				const r = modalEl.getBoundingClientRect();
				NoteActionModal.lastPosition = { left: r.left, top: r.top };
			};
			handle.addEventListener('pointermove', onMove);
			handle.addEventListener('pointerup', onUp);
			handle.addEventListener('pointercancel', onUp);
		});
		handle.addEventListener('dblclick', () => {
			NoteActionModal.lastPosition = null;
			modalEl.removeClass('sbm-note-action-modal--moved');
			modalEl.style.left = '';
			modalEl.style.top = '';
		});
	}

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
				this.currentModel,
				this.currentProvider
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
	private updateModelBtn(): void {
		if (!this.modelBtnEl) return;
		this.modelBtnEl.empty();
		const modelIcon = this.modelBtnEl.createSpan({ cls: 'sbm-model-badge-icon' });
		setIcon(modelIcon, 'bot');
		const nameSpan = this.modelBtnEl.createSpan({ cls: 'sbm-model-btn-name' });
		nameSpan.textContent = this.currentModel;
		const chevronSpan = this.modelBtnEl.createSpan({ cls: 'sbm-model-btn-chevron' });
		chevronSpan.textContent = ' ▾';
	}

	private updateHeaderModelBadge(): void {
		if (!this.headerModelBadgeEl) return;
		this.headerModelBadgeEl.textContent = `⚡ ${this.currentModel}`;
	}

	private openModelPicker(): void {
		new ModelPickerModal(
			this.app,
			this.plugin,
			(selected) => {
				this.currentModel = selected.name;
				this.currentProvider = selected.provider;
				this.updateModelBtn();
				this.updateHeaderModelBadge();
			},
			false
		).open();
	}

}
