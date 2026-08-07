import { Setting } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';

export class SyntaxPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.renderHeader();

		const priorityGroup = new SettingGroup(this.containerEl).setHeading('Format des Priorités');

		priorityGroup.addSetting((setting: Setting) => {
			setting
				.setName('Mode de Priorité')
				.setDesc('Format des priorités (Emojis Tasks ou Tags hiérarchiques)')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('emoji', 'Emojis Obsidian Tasks (🔺 ⏫ 🔼 🔽 ⏬)')
						.addOption('tag', 'Tags (#priorite/haute, #priority/high...)')
						.setValue(this.plugin.settings.priorityMode)
						.onChange(async (value: 'emoji' | 'tag') => {
							this.plugin.settings.priorityMode = value;
							await this.plugin.saveSettings();
						});
				});
		});

		const tagGroup = new SettingGroup(this.containerEl).setHeading('Préfixes & Tags de Gamification');

		tagGroup.addSetting((setting: Setting) => {
			setting
				.setName('Préfixe Tag Énergie')
				.setDesc('Préfixe utilisé pour les points d\'énergie (#energie/4)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.energyTagPrefix)
						.onChange(async (value) => {
							this.plugin.settings.energyTagPrefix = value.trim() || 'energie';
							await this.plugin.saveSettings();
						});
				});
		});

		tagGroup.addSetting((setting: Setting) => {
			setting
				.setName('Préfixe Tag Pièces')
				.setDesc('Préfixe utilisé pour les pièces (#pieces/5)')
				.addText((text) => {
					text
						.setValue(this.plugin.settings.piecesTagPrefix)
						.onChange(async (value) => {
							this.plugin.settings.piecesTagPrefix = value.trim() || 'pieces';
							await this.plugin.saveSettings();
						});
				});
		});

		const dateGroup = new SettingGroup(this.containerEl).setHeading('Dates & Liens');

		dateGroup.addSetting((setting: Setting) => {
			setting
				.setName('Format des Dates')
				.setDesc('Format Moment.js pour les échéances')
				.addText((text) => {
					text
						.setPlaceholder('YYYY-MM-DD')
						.setValue(this.plugin.settings.dateFormat)
						.onChange(async (value) => {
							this.plugin.settings.dateFormat = value.trim() || 'YYYY-MM-DD';
							await this.plugin.saveSettings();
						});
				});
		});

		dateGroup.addSetting((setting: Setting) => {
			setting
				.setName('Wikilinks pour les dates')
				.setDesc('Encadrer les dates dans [[YYYY-MM-DD]] pour lier au journal')
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.useWikilinks)
						.onChange(async (value) => {
							this.plugin.settings.useWikilinks = value;
							await this.plugin.saveSettings();
						});
				});
		});
	}
}
