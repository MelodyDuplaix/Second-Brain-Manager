import { Setting } from 'obsidian';

export class SettingGroup {
	private containerEl: HTMLElement;
	private groupEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.containerEl = containerEl;
		this.groupEl = this.containerEl.createDiv({ cls: 'sbm-setting-group' });
	}

	setHeading(headingText: string): this {
		new Setting(this.groupEl).setName(headingText).setHeading();
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
