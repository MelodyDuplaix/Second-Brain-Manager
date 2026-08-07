import { Setting, Notice } from 'obsidian';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';

export class RewardsPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.renderHeader();

		const catalogGroup = new SettingGroup(this.containerEl).setHeading('Catalogue des Récompenses');

		if (this.plugin.pluginData.rewards.length === 0) {
			catalogGroup.addSetting((setting: Setting) => {
				setting.setName('Aucune récompense configurée.')
					.setDesc('Créez votre première récompense ci-dessous.');
			});
		} else {
			this.plugin.pluginData.rewards.forEach((reward, index) => {
				catalogGroup.addSetting((setting: Setting) => {
					setting
						.setName(reward.name)
						.setDesc(reward.description)
						.addText((costText) => {
							costText.inputEl.type = 'number';
							costText.inputEl.min = '1';
							costText.setValue(reward.cost.toString());
							costText.onChange(async (val) => {
								const num = parseInt(val, 10);
								if (!isNaN(num)) {
									reward.cost = num;
									await this.plugin.savePluginData();
								}
							});
						})
						.addToggle((toggle) => {
							toggle
								.setValue(reward.enabled)
								.onChange(async (val) => {
									reward.enabled = val;
									await this.plugin.savePluginData();
								});
						})
						.addButton((deleteBtn) => {
							deleteBtn
								.setIcon('trash')
								.setWarning()
								.setTooltip('Supprimer cette récompense')
								.onClick(async () => {
									this.plugin.pluginData.rewards.splice(index, 1);
									await this.plugin.savePluginData();
									this.render();
								});
						});
				});
			});
		}

		// Formulaire d'ajout
		const addGroup = new SettingGroup(this.containerEl).setHeading('Ajouter une Nouvelle Récompense');

		let newName = '';
		let newDesc = '';
		let newCost = 10;

		addGroup.addSetting((setting: Setting) => {
			setting
				.setName('Nom de la récompense')
				.setDesc('Intitulé de la pause ou du privilège débloqué')
				.addText((text) => {
					text.setPlaceholder('Ex: Épisode de série').onChange((val) => {
						newName = val.trim();
					});
				});
		});

		addGroup.addSetting((setting: Setting) => {
			setting
				.setName('Description')
				.setDesc('Contexte de la récompense')
				.addText((text) => {
					text.setPlaceholder('Ex: 45 min sans culpabilité').onChange((val) => {
						newDesc = val.trim();
					});
				});
		});

		addGroup.addSetting((setting: Setting) => {
			setting
				.setName('Coût en pièces')
				.setDesc('Nombre de pièces d\'or requises pour acheter')
				.addText((text) => {
					text.inputEl.type = 'number';
					text.setValue('10');
					text.onChange((val) => {
						const parsed = parseInt(val, 10);
						if (!isNaN(parsed)) newCost = parsed;
					});
				})
				.addButton((btn) => {
					btn
						.setButtonText('Créer la récompense')
						.setCta()
						.onClick(async () => {
							if (!newName) {
								new Notice('Veuillez renseigner un nom de récompense.');
								return;
							}

							const id = `reward-${Date.now()}`;
							this.plugin.pluginData.rewards.push({
								id,
								name: newName,
								description: newDesc,
								cost: newCost,
								enabled: true
							});

							await this.plugin.savePluginData();
							new Notice(`Récompense "${newName}" ajoutée avec succès !`);
							this.render();
						});
				});
		});
	}
}
