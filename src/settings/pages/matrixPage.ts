import { Setting } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';

export class MatrixPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.renderHeader();

		const matrixGroup = new SettingGroup(this.containerEl).setHeading('Configuration de la Matrice Eisenhower');

		matrixGroup.addSetting((setting: Setting) => {
			setting
				.setName('Fournisseur de Matrice')
				.setDesc('Sélectionnez la convention de tags utilisée pour classer les tâches')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('task-matrix', 'TaskMatrix (#tm/qN)')
						.addOption('focus-first', 'Focus First (#focus, #qN)')
						.addOption('custom', 'Tags Personnalisés (#q1, #q2...)')
						.setValue(this.plugin.settings.matrixProvider)
						.onChange(async (value: 'focus-first' | 'task-matrix' | 'quad-tasks' | '4d-matrix' | 'custom') => {
							this.plugin.settings.matrixProvider = value;
							await this.plugin.saveSettings();
						});
				});
		});
	}
}
