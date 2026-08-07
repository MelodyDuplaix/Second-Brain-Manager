import { Setting } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';
import { FolderSuggest } from '../../suggesters/folderSuggest';

export class GeneralPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.renderHeader();

		const energyGroup = new SettingGroup(this.containerEl).setHeading('Énergie & Rythme');

		energyGroup.addSetting((setting: Setting) => {
			setting
				.setName('Niveau d\'énergie initial')
				.setDesc('Votre jauge d\'énergie de base par défaut (de 1 à 10)')
				.addSlider((slider) => {
					slider
						.setLimits(1, 10, 1)
						.setValue(this.plugin.settings.energyLevel)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.energyLevel = value;
							await this.plugin.saveSettings();
						});
				});
		});

		const folderGroup = new SettingGroup(this.containerEl).setHeading('Dossiers du Coffre');

		folderGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier Inbox')
				.setDesc('Dossier dans lequel les nouvelles notes brutes sont capturées')
				.addText((text) => {
					text
						.setPlaceholder('00 - Inbox')
						.setValue(this.plugin.settings.inboxFolder)
						.onChange(async (value) => {
							this.plugin.settings.inboxFolder = value.trim();
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});

		folderGroup.addSetting((setting: Setting) => {
			setting
				.setName('Dossier Journal (Daily Notes)')
				.setDesc('Dossier des notes quotidiennes du journal')
				.addText((text) => {
					text
						.setPlaceholder('04 - Journal')
						.setValue(this.plugin.settings.dailyNotesFolder)
						.onChange(async (value) => {
							this.plugin.settings.dailyNotesFolder = value.trim();
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.plugin.app, text.inputEl);
				});
		});
	}
}
