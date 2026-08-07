import { App, Modal, Setting } from 'obsidian';

export type ModalInputType = 'text' | 'date' | 'number' | 'select';

export interface SelectOption {
	label: string;
	value: string;
}

export class EditMetaModal extends Modal {
	private value: string;
	private onSubmit: (value: string) => void;
	private title: string;
	private inputType: ModalInputType;
	private selectOptions?: SelectOption[];
	private min?: number;
	private max?: number;

	constructor(
		app: App,
		title: string,
		initialValue: string,
		inputType: ModalInputType,
		onSubmit: (value: string) => void,
		selectOptions?: SelectOption[],
		min?: number,
		max?: number
	) {
		super(app);
		this.title = title;
		this.value = initialValue;
		this.inputType = inputType;
		this.onSubmit = onSubmit;
		this.selectOptions = selectOptions;
		this.min = min;
		this.max = max;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: this.title });

		const setting = new Setting(contentEl);

		if (this.inputType === 'select' && this.selectOptions) {
			setting.addDropdown(dropdown => {
				this.selectOptions?.forEach(opt => dropdown.addOption(opt.value, opt.label));
				dropdown.setValue(this.value);
				dropdown.onChange(val => {
					this.value = val;
				});
			});
		} else if (this.inputType === 'date') {
			setting.addText(text => {
				text.inputEl.type = 'date';
				text.setValue(this.value);
				text.onChange(val => {
					this.value = val;
				});
			});
		} else if (this.inputType === 'number') {
			setting.addText(text => {
				text.inputEl.type = 'number';
				if (this.min !== undefined) text.inputEl.min = this.min.toString();
				if (this.max !== undefined) text.inputEl.max = this.max.toString();
				text.setValue(this.value);
				text.onChange(val => {
					this.value = val;
				});
			});
		} else {
			setting.addText(text => {
				text.setValue(this.value);
				text.onChange(val => {
					this.value = val;
				});
			});
		}

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Enregistrer')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.value);
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
