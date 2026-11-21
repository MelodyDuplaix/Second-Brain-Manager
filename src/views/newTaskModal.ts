import { App, Modal, Notice } from 'obsidian';
import { TaskPriority } from '../models/task';
import { LinkTagSuggest } from '../suggesters/linkTagSuggest';

export type NewTaskDateField = 'due' | 'scheduled';

export interface NewTaskDraft {
	text: string;
	/** Jour visé (AAAA-MM-JJ) */
	date: string;
	dateField: NewTaskDateField;
	priority: TaskPriority | null;
}

export interface NewTaskModalOptions {
	draft: Omit<NewTaskDraft, 'text' | 'priority'> & Partial<Pick<NewTaskDraft, 'text' | 'priority'>>;
	/** Où la tâche sera écrite (affiché sous le titre) */
	destination?: string;
	onSubmit: (draft: NewTaskDraft) => unknown;
}

const PRIORITIES: Array<{ value: TaskPriority | ''; label: string }> = [
	{ value: '', label: 'Aucune' },
	{ value: 'highest', label: '🔺 La plus haute' },
	{ value: 'high', label: '⏫ Haute' },
	{ value: 'medium', label: '🔼 Moyenne' },
	{ value: 'low', label: '🔽 Basse' },
	{ value: 'lowest', label: '⏬ La plus basse' }
];

/** Jour à `days` jours (et `months` mois) d'aujourd'hui, en AAAA-MM-JJ. */
function isoDay(days: number, months = 0): string {
	const d = new Date();
	if (months) {
		// Même quantième le mois suivant, ramené au dernier jour si le mois est plus court
		const day = d.getDate();
		d.setDate(1);
		d.setMonth(d.getMonth() + months);
		d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
	}
	d.setDate(d.getDate() + days);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Création d'une tâche depuis le calendrier. Même présentation que la fenêtre d'entrée de note
 * quotidienne : texte avec autocomplétion, jour, type de date et priorité.
 */
export class NewTaskModal extends Modal {
	private suggest: LinkTagSuggest | null = null;

	constructor(app: App, private opts: NewTaskModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, opts } = this;
		contentEl.empty();
		this.modalEl.addClass('sbm-new-task-modal');
		contentEl.addClass('sbm-entry-modal');
		this.titleEl.setText('Nouvelle tâche');
		if (opts.destination) contentEl.createDiv({ cls: 'sbm-entry-modal-file', text: `📄 ${opts.destination}` });

		const form = contentEl.createEl('form', { cls: 'sbm-entry-form' });

		const textRow = form.createDiv({ cls: 'sbm-entry-field is-wide' });
		textRow.createEl('label', { text: 'Tâche' });
		const text = textRow.createEl('input', { type: 'text', cls: 'sbm-new-task-text', value: opts.draft.text ?? '' });
		text.placeholder = 'Que faut-il faire ? [[note]] #tag';
		// Autocomplétion : [[ propose les notes, # propose les tags du coffre
		const suggest = new LinkTagSuggest(this.app, text);
		this.suggest = suggest;

		const row = form.createDiv({ cls: 'sbm-entry-row' });

		const dateField = row.createDiv({ cls: 'sbm-entry-field' });
		dateField.createEl('label', { text: 'Jour' });
		const date = dateField.createEl('input', { type: 'date', value: opts.draft.date });

		const kindField = row.createDiv({ cls: 'sbm-entry-field' });
		kindField.createEl('label', { text: 'Date' });
		const kind = kindField.createEl('select', { cls: 'dropdown' });
		kind.createEl('option', { value: 'due', text: '📅 Échéance' });
		kind.createEl('option', { value: 'scheduled', text: '⏳ Prévue' });
		kind.value = opts.draft.dateField;

		const prioField = row.createDiv({ cls: 'sbm-entry-field' });
		prioField.createEl('label', { text: 'Priorité' });
		const prio = prioField.createEl('select', { cls: 'dropdown' });
		PRIORITIES.forEach(p => prio.createEl('option', { value: p.value, text: p.label }));
		prio.value = opts.draft.priority ?? '';

		// Raccourcis de jour, comme dans le reste du calendrier
		const quick = form.createDiv({ cls: 'sbm-new-task-quick' });
		const shortcuts: Array<[string, number, number?]> = [
			['Aujourd’hui', 0],
			['Demain', 1],
			['Dans 2 jours', 2],
			['Dans 1 semaine', 7],
			['Dans 2 semaines', 14],
			['Dans 1 mois', 0, 1]
		];
		const syncQuick = () => quick.querySelectorAll<HTMLElement>('button').forEach(b =>
			b.toggleClass('is-active', b.dataset.day === date.value));
		for (const [label, days, months] of shortcuts) {
			const btn = quick.createEl('button', { type: 'button', cls: 'sbm-new-task-chip', text: label });
			btn.dataset.day = isoDay(days, months);
			btn.addEventListener('click', () => {
				date.value = btn.dataset.day as string;
				syncQuick();
			});
		}
		date.addEventListener('change', syncQuick);
		syncQuick();

		const actions = form.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { type: 'button', text: 'Annuler' });
		cancel.addEventListener('click', () => this.close());
		const saveBtn = actions.createEl('button', { type: 'submit', text: 'Créer la tâche', cls: 'mod-cta' });
		saveBtn.title = 'Créer (Entrée)';

		let saved = false;
		const save = () => {
			if (saved) return;
			const value = text.value.trim();
			if (!value) {
				new Notice('Le texte de la tâche est vide.');
				text.focus();
				return;
			}
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
				new Notice('Jour invalide.');
				return;
			}
			saved = true;
			this.close();
			void opts.onSubmit({
				text: value,
				date: date.value,
				dateField: kind.value === 'scheduled' ? 'scheduled' : 'due',
				priority: (prio.value || null) as TaskPriority | null
			});
		};

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			if (suggest.isBusy()) return;
			save();
		});
		// Entrée enregistre depuis n'importe quel champ ; pendant les suggestions, elle en choisit une
		form.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key !== 'Enter' || e.isComposing) return;
			const mod = e.ctrlKey || e.metaKey;
			if (!mod && (e.target instanceof HTMLButtonElement || suggest.isBusy())) return;
			e.preventDefault();
			e.stopPropagation();
			suggest.close();
			save();
		}, true);

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
