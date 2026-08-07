import { Setting, setIcon } from 'obsidian';
import SecondBrainPlugin from '../main';
import { SettingsPageType, getPageName, getPageIcon } from './settingsPageManager';

export abstract class BaseSettingsPage {
	protected containerEl: HTMLElement;
	protected plugin: SecondBrainPlugin;
	protected pageType: SettingsPageType;
	protected display: () => void;
	protected openPage: (pageType: SettingsPageType) => void;

	constructor(
		containerEl: HTMLElement,
		plugin: SecondBrainPlugin,
		pageType: SettingsPageType,
		display: () => void,
		openPage: (pageType: SettingsPageType) => void
	) {
		this.containerEl = containerEl;
		this.plugin = plugin;
		this.pageType = pageType;
		this.display = display;
		this.openPage = openPage;
	}

	getPageType(): SettingsPageType {
		return this.pageType;
	}

	show(): void {
		this.containerEl.show();
	}

	hide(): void {
		this.containerEl.hide();
	}

	scrollTo(pos: number): void {
		this.containerEl.scrollTop = pos;
	}

	destroy(): void {
		this.containerEl.empty();
	}

	abstract render(): void;

	protected renderHeader(): void {
		if (this.pageType === 'main-page') return;

		const backSetting = new Setting(this.containerEl)
			.setClass('sbm-settings-back-header')
			.addButton((button) => {
				button
					.setIcon('arrow-left')
					.setTooltip('Retour au menu principal')
					.onClick(() => {
						this.openPage('main-page');
					});
				button.buttonEl.addClass('clickable-icon');
			});

		const titleIcon = activeDocument.createElement('span');
		titleIcon.addClass('sbm-settings-page-title-icon');
		setIcon(titleIcon, getPageIcon(this.pageType));

		backSetting.nameEl.empty();
		backSetting.nameEl.appendChild(titleIcon);
		const titleText = activeDocument.createElement('span');
		titleText.setText(getPageName(this.pageType));
		backSetting.nameEl.appendChild(titleText);
		backSetting.nameEl.addClass('sbm-settings-page-title');

		backSetting.settingEl.setAttribute('tabindex', '0');
		backSetting.settingEl.setAttribute('role', 'button');
		backSetting.settingEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.openPage('main-page');
			}
		});

		this.containerEl.createDiv({ cls: 'sbm-subpage-divider' });
	}
}
