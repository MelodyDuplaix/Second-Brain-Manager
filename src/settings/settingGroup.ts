import { Setting, setIcon } from 'obsidian';

export class SettingGroup {
	private containerEl: HTMLElement;
	private groupEl: HTMLElement;

	constructor(containerEl: HTMLElement, customClass?: string) {
		this.containerEl = containerEl;
		this.groupEl = this.containerEl.createDiv({ cls: `sbm-setting-group ${customClass || ''}`.trim() });
	}

	setHeading(headingText: string, iconName?: string, description?: string): this {
		const setting = new Setting(this.groupEl).setName(headingText).setHeading();
		if (description) {
			setting.setDesc(description);
		}
		if (iconName) {
			const iconEl = activeDocument.createElement('span');
			iconEl.addClass('sbm-group-heading-icon');
			setIcon(iconEl, iconName);
			setting.nameEl.insertBefore(iconEl, setting.nameEl.firstChild);
		}
		return this;
	}

	addSetting(cb: (setting: Setting) => void): this {
		const setting = new Setting(this.groupEl);
		cb(setting);
		return this;
	}

	getGroupEl(): HTMLElement {
		return this.groupEl;
	}
}
