import { App, Modal, Notice } from 'obsidian';
import { formatClock, parseClock } from '../services/dailyEntriesService';
import { LinkTagSuggest } from '../suggesters/linkTagSuggest';

export interface DailyEntryDraft {
	date: string;
	start: number;
	end: number | null;
	text: string;
}

export interface DailyEntryModalOptions {
	title: string;
	draft: DailyEntryDraft;
	/** Libellé du fichier (affiché sous le titre) */
	fileLabel?: string;
	/** Chemin de la note quotidienne : liens [[…]] proposés au plus court depuis cette note */
	sourcePath?: string;
	onSubmit: (draft: DailyEntryDraft) => unknown;
	onDelete?: () => unknown;
	onOpenNote?: () => void;
}

/** Saisie d'une entrée horodatée de note quotidienne (création ou modification). */
export class DailyEntryModal extends Modal {
	private suggest: LinkTagSuggest | null = null;

	constructor(app: App, private opts: DailyEntryModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, opts } = this;
		contentEl.empty();
		contentEl.addClass('sbm-entry-modal');
		this.titleEl.setText(opts.title);
		if (opts.fileLabel) contentEl.createDiv({ cls: 'sbm-entry-modal-file', text: `📄 ${opts.fileLabel}` });

		const form = contentEl.createEl('form', { cls: 'sbm-entry-form' });

		const textRow = form.createDiv({ cls: 'sbm-entry-field is-wide' });
		textRow.createEl('label', { text: 'Texte' });
		const text = textRow.createEl('input', { type: 'text', value: opts.draft.text });
		text.placeholder = 'Ex. Rendez-vous dentiste, [[Projet]] #tag…';
		// Autocomplétion : [[ propose les notes, # propose les tags du coffre
		const suggest = new LinkTagSuggest(this.app, text, opts.sourcePath || '');
		this.suggest = suggest;

		const row = form.createDiv({ cls: 'sbm-entry-row' });
		const dateField = row.createDiv({ cls: 'sbm-entry-field' });
		dateField.createEl('label', { text: 'Jour' });
		const date = dateField.createEl('input', { type: 'date', value: opts.draft.date });

		const startField = row.createDiv({ cls: 'sbm-entry-field' });
		startField.createEl('label', { text: 'Début' });
		const start = startField.createEl('input', { type: 'time', value: formatClock(opts.draft.start) });

		const endField = row.createDiv({ cls: 'sbm-entry-field' });
		const endLabel = endField.createEl('label');
		const hasEnd = endLabel.createEl('input', { type: 'checkbox' });
		hasEnd.checked = opts.draft.end !== null;
		endLabel.appendText(' Fin');
		const end = endField.createEl('input', { type: 'time', value: formatClock(opts.draft.end ?? Math.min(1440, opts.draft.start + 60)) });
		end.disabled = !hasEnd.checked;
		hasEnd.addEventListener('change', () => {
			end.disabled = !hasEnd.checked;
			if (hasEnd.checked) end.focus();
		});

		const actions = form.createDiv({ cls: 'modal-button-container' });
		if (opts.onOpenNote) {
			const openBtn = actions.createEl('button', { type: 'button', text: 'Ouvrir la note' });
			openBtn.addClass('sbm-entry-open');
			openBtn.addEventListener('click', () => {
				this.close();
				opts.onOpenNote?.();
			});
		}
		if (opts.onDelete) {
			const del = actions.createEl('button', { type: 'button', text: 'Supprimer', cls: 'mod-warning' });
			del.addEventListener('click', () => {
				this.close();
				void opts.onDelete?.();
			});
		}
		const cancel = actions.createEl('button', { type: 'button', text: 'Annuler' });
		cancel.addEventListener('click', () => this.close());
		const saveBtn = actions.createEl('button', { type: 'submit', text: 'Enregistrer', cls: 'mod-cta' });
		saveBtn.title = 'Enregistrer (Ctrl+Entrée)';

		let saved = false;
		const save = () => {
			if (saved) return;
			const value = text.value.trim();
			if (!value) {
				new Notice('Le texte de l’entrée est vide.');
				text.focus();
				return;
			}
			const s = parseClock(start.value);
			if (s === null || !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
				new Notice('Jour ou heure de début invalide.');
				return;
			}
			const en = hasEnd.checked ? parseClock(end.value) : null;
			saved = true;
			this.close();
			void opts.onSubmit({ date: date.value, start: s, end: en, text: value });
		};

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			// Entrée sert à choisir une suggestion, pas à enregistrer
			if (suggest.isBusy()) return;
			save();
		});

		// Ctrl+Entrée (Cmd+Entrée sur Mac) enregistre depuis n'importe quel champ, suggestions ouvertes ou non
		form.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.isComposing) return;
			e.preventDefault();
			e.stopPropagation();
			suggest.close();
			save();
		}, true);
		this.scope.register(['Mod'], 'Enter', () => {
			suggest.close();
			save();
			return false;
		});

		window.setTimeout(() => {
			text.focus();
			text.setSelectionRange(text.value.length, text.value.length);
		}, 30);
	}

	onClose(): void {
		this.suggest?.close();
		this.suggest = null;
		this.contentEl.empty();
	}
}
