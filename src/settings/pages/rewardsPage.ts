import { Setting, Notice } from 'obsidian';
import type SecondBrainPlugin from '../../main';
import { BaseSettingsPage } from '../baseSettingsPage';
import { SettingGroup } from '../settingGroup';

/** Catalogue et formulaire d'ajout des récompenses (page dédiée ou section Gamification). */
export function renderRewardsGroups(containerEl: HTMLElement, plugin: SecondBrainPlugin, rerender: () => void): void {
	const catalogGroup = new SettingGroup(containerEl).setHeading('Catalogue des récompenses', 'gift', 'Récompenses achetables avec les pièces gagnées : coût, activation, suppression.');

	if (plugin.pluginData.rewards.length === 0) {
		catalogGroup.addSetting((setting: Setting) => {
			setting.setName('Aucune récompense configurée.')
				.setDesc('Créez votre première récompense ci-dessous.');
		});
	} else {
		plugin.pluginData.rewards.forEach((reward, index) => {
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
								await plugin.savePluginData();
							}
						});
					})
					.addToggle((toggle) => {
						toggle
							.setValue(reward.enabled)
							.onChange(async (val) => {
								reward.enabled = val;
								await plugin.savePluginData();
							});
					})
					.addButton((deleteBtn) => {
						deleteBtn
							.setIcon('trash')
							.setWarning()
							.setTooltip('Supprimer cette récompense')
							.onClick(async () => {
								plugin.pluginData.rewards.splice(index, 1);
								await plugin.savePluginData();
								rerender();
							});
					});
			});
		});
	}

	// Formulaire d'ajout
	const addGroup = new SettingGroup(containerEl).setHeading('Ajouter une récompense', 'plus-circle');

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
						plugin.pluginData.rewards.push({
							id,
							name: newName,
							description: newDesc,
							cost: newCost,
							enabled: true
						});

						await plugin.savePluginData();
						new Notice(`Récompense "${newName}" ajoutée avec succès !`);
						rerender();
					});
			});
	});
}

export class RewardsPage extends BaseSettingsPage {
	render(): void {
		this.containerEl.empty();
		this.renderHeader();
		renderRewardsGroups(this.containerEl, this.plugin, () => this.rerender());
	}
}
