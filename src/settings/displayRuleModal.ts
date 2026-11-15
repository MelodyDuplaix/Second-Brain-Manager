import { App, Modal, Setting } from 'obsidian';
import {
	CONDITION_FIELDS,
	ColorRule,
	ConditionField,
	DATE_OPTIONS,
	DisplayRuleBase,
	KIND_OPTIONS,
	PRIORITY_LEVELS,
	PriorityLevel,
	PriorityRule,
	RuleCondition,
	STATUS_OPTIONS,
	describeConditions
} from '../services/displayRules';

type EditableRule = ColorRule | PriorityRule;

/** Valeur proposée quand on choisit un champ à liste fermée. */
const DEFAULT_VALUE: Partial<Record<ConditionField, string>> = {
	kind: 'task',
	date: 'today',
	status: 'open'
};

const CHOICES: Partial<Record<ConditionField, Array<{ value: string; label: string }>>> = {
	kind: KIND_OPTIONS,
	date: DATE_OPTIONS,
	status: STATUS_OPTIONS
};

const PLACEHOLDER: Partial<Record<ConditionField, string>> = {
	text: '@Melody',
	tag: '#projet',
	path: 'Projets/Acme',
	calendar: 'Travail'
};

/**
 * Fenêtre de modification d'une règle de couleur ou de priorité.
 * Travaille sur une copie : rien n'est enregistré avant « Enregistrer ».
 */
export class DisplayRuleModal extends Modal {
	private draft: EditableRule;

	constructor(
		app: App,
		rule: EditableRule,
		private readonly onSave: (rule: EditableRule) => void | Promise<void>
	) {
		super(app);
		this.draft = JSON.parse(JSON.stringify(rule)) as EditableRule;
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private get isColor(): boolean {
		return 'color' in this.draft;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('sbm-rule-modal');
		this.titleEl.setText(this.isColor ? 'Règle de couleur' : 'Règle de priorité');

		new Setting(contentEl)
			.setName('Nom')
			.addText(text => text
				.setPlaceholder('Ex. Rendez-vous avec Melody')
				.setValue(this.draft.name)
				.onChange(v => { this.draft.name = v; }));

		if (this.isColor) {
			const rule = this.draft as ColorRule;
			new Setting(contentEl)
				.setName('Couleur')
				.setDesc('Remplace la couleur de l’agenda, du quadrant ou des entrées.')
				.addColorPicker(picker => picker
					.setValue(rule.color || '#e11d48')
					.onChange(v => { rule.color = v; }));
		} else {
			const rule = this.draft as PriorityRule;
			new Setting(contentEl)
				.setName('Place dans les listes')
				.setDesc('Journée, sans date, en retard, mois et agenda. La grille horaire garde l’ordre des heures.')
				.addDropdown(dd => {
					PRIORITY_LEVELS.forEach(l => dd.addOption(l.value, l.label));
					dd.setValue(rule.priority).onChange(v => { rule.priority = v as PriorityLevel; });
				});
		}

		new Setting(contentEl)
			.setName('S’applique si')
			.addDropdown(dd => dd
				.addOption('all', 'toutes les conditions sont remplies')
				.addOption('any', 'au moins une condition est remplie')
				.setValue(this.draft.match)
				.onChange(v => {
					this.draft.match = v as DisplayRuleBase['match'];
					this.refreshSummary();
				}));

		contentEl.createEl('h4', { text: 'Conditions', cls: 'sbm-rule-modal-heading' });
		this.draft.conditions.forEach((condition, index) => this.renderCondition(contentEl, condition, index));

		new Setting(contentEl).addButton(btn => btn
			.setButtonText('Ajouter une condition')
			.onClick(() => {
				this.draft.conditions.push({ field: 'text', value: '' });
				this.render();
			}));

		contentEl.createDiv({ cls: 'sbm-rule-modal-summary setting-item-description' });
		this.refreshSummary();

		new Setting(contentEl)
			.addButton(btn => btn.setButtonText('Annuler').onClick(() => this.close()))
			.addButton(btn => btn
				.setButtonText('Enregistrer')
				.setCta()
				.onClick(async () => {
					this.draft.name = this.draft.name.trim() || 'Règle sans nom';
					// Une condition texte vide ne filtre rien : on ne la garde pas
					this.draft.conditions = this.draft.conditions.filter(c => c.value.trim() !== '');
					await this.onSave(this.draft);
					this.close();
				}));
	}

	private renderCondition(container: HTMLElement, condition: RuleCondition, index: number): void {
		const choices = CHOICES[condition.field];
		const row = new Setting(container).setClass('sbm-rule-condition');

		row.addDropdown(dd => {
			CONDITION_FIELDS.forEach(f => dd.addOption(f.value, f.label));
			dd.setValue(condition.field).onChange(v => {
				condition.field = v as ConditionField;
				condition.value = DEFAULT_VALUE[condition.field] ?? '';
				this.render();
			});
		});

		row.addDropdown(dd => {
			const listed = Boolean(choices);
			dd.addOption('is', listed ? 'est' : 'contient');
			dd.addOption('not', listed ? 'n’est pas' : 'ne contient pas');
			dd.setValue(condition.negate ? 'not' : 'is').onChange(v => {
				condition.negate = v === 'not';
				this.refreshSummary();
			});
		});

		if (choices) {
			row.addDropdown(dd => {
				choices.forEach(c => dd.addOption(c.value, c.label));
				dd.setValue(condition.value || choices[0].value).onChange(v => {
					condition.value = v;
					this.refreshSummary();
				});
				if (!condition.value) condition.value = choices[0].value;
			});
		} else {
			row.addText(text => text
				.setPlaceholder(PLACEHOLDER[condition.field] || '')
				.setValue(condition.value)
				.onChange(v => {
					condition.value = v;
					this.refreshSummary();
				}));
		}

		row.addExtraButton(btn => btn
			.setIcon('trash-2')
			.setTooltip('Retirer cette condition')
			.onClick(() => {
				this.draft.conditions.splice(index, 1);
				this.render();
			}));
	}

	private refreshSummary(): void {
		const el = this.contentEl.querySelector('.sbm-rule-modal-summary');
		if (!el) return;
		const usable = { ...this.draft, conditions: this.draft.conditions.filter(c => c.value.trim() !== '') };
		el.setText(`Résumé : ${describeConditions(usable)}.`);
	}
}
